import type { DiscoveryCard, DiscoverRequest, ExtractionResult } from "@planit/shared-schema";

import { prepareCardsForUi } from "./card-ui";
import {
  discoverLiveSources,
  planAgentJobs,
  synthesizeAgentCards,
  synthesizeLiveSearchCards,
} from "./discovery-agent";
import { enrichCardImages } from "./place-image-agent";
import { createParsedSummary, createSearchPlan } from "./planner";
import { runsStore } from "./runs-store";
import { loadSourceRegistry, matchSeedDestination } from "./source-registry";
import { extractCardEnrichment, type ExtractionProgressEvent } from "./worker-client";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeExtraction(cards: DiscoveryCard[], results: ExtractionResult[]) {
  const resultMap = new Map(results.map((result) => [result.cardId, result] as const));

  return cards.map((card) => {
    const result = resultMap.get(card.id);

    if (!result) {
      return card;
    }

    return {
      ...card,
      verificationState: result.verificationState,
      quotes: [...new Set([...card.quotes, result.quote])],
      warnings: result.warning ? [...new Set([...card.warnings, result.warning])] : card.warnings,
    };
  });
}

function chooseCardsForPlan(seedCards: DiscoveryCard[], requestedBuckets: DiscoveryCard["bucket"][]) {
  return seedCards.filter((card) => requestedBuckets.includes(card.bucket));
}

function dedupeCards(cards: DiscoveryCard[]) {
  const seen = new Map<string, DiscoveryCard>();

  function cardScore(card: DiscoveryCard) {
    const genericPlacePenalty =
      card.bucket === "food-hidden-gems" &&
      /\b(things to do|experiences and attractions|tours and attractions|destination guide)\b/i.test(card.title)
        ? -6
        : 0;

    return (
      (card.quotes.length > 0 ? 4 : 0) +
      (card.warnings.length > 0 ? 2 : 0) +
      (card.imageUrls.length > 0 ? 2 : 0) +
      (card.credibilityNotes.length > 1 ? 1 : 0) +
      (card.summary.length > 100 ? 1 : 0) +
      genericPlacePenalty
    );
  }

  function dedupeKey(card: DiscoveryCard) {
    const booking = card.bookingLink?.trim().toLowerCase();
    const provenanceUrl = card.provenance[0]?.url?.trim().toLowerCase();

    if (booking) {
      return `booking:${booking}`;
    }

    if (provenanceUrl) {
      return `prov:${provenanceUrl}`;
    }

    return `id:${card.id}`;
  }

  for (const card of cards) {
    const key = dedupeKey(card);
    const existing = seen.get(key);

    if (!existing || cardScore(card) >= cardScore(existing)) {
      seen.set(key, card);
    }
  }

  return [...seen.values()];
}

function scopedSourceMessage(bucket: DiscoveryCard["bucket"]) {
  switch (bucket) {
    case "flights":
      return "Comparing public flight options for the requested route.";
    case "hotels":
      return "Checking hotels that work well as the trip base.";
    case "car-rental":
      return "Comparing rental options and driving tradeoffs.";
    case "local-transport":
      return "Checking official transport pages for reliable timing.";
    case "food-hidden-gems":
      return "Turning your request into actual attractions and food stops.";
    case "local-advice":
      return "Collecting practical local warnings that can change the plan.";
  }
}

function agentProgressMessage(bucket: DiscoveryCard["bucket"]) {
  switch (bucket) {
    case "flights":
      return "Checking a few better fare sources so one sponsored listing does not decide the answer.";
    case "hotels":
      return "Checking a few hotel sources so rates and stay terms can be compared cleanly.";
    case "car-rental":
      return "Checking a few rental sources so the practical tradeoffs are easier to compare.";
    case "local-transport":
      return "Checking a few stronger transport sources to confirm the access details.";
    case "food-hidden-gems":
      return "Checking a few better place sources to pull out concrete stops, not broad listings.";
    case "local-advice":
      return "Checking a few stronger advice sources so warnings are easier to trust.";
  }
}

function isForegroundConversationBucket(bucket: DiscoveryCard["bucket"]) {
  return bucket === "food-hidden-gems";
}

function shouldFastTrackOpenAiPlaces(bucket: DiscoveryCard["bucket"]) {
  return bucket === "food-hidden-gems";
}

function backgroundLayerMessage(bucket: DiscoveryCard["bucket"], resultCount: number) {
  if (bucket === "local-advice") {
    return resultCount > 0
      ? "Added a few practical warnings in the background so they do not interrupt place picking."
      : "Checking a few practical warnings in the background.";
  }

  return resultCount > 0
    ? "Prepared more logistics options in the background so they are ready after the places are pinned."
    : "Preparing hotels, flights, and transport in the background so they unlock after the places are pinned.";
}

function bucketLabel(bucket: DiscoveryCard["bucket"]) {
  return bucket.replace("-", " ");
}

function workerProgressMessage(event: ExtractionProgressEvent) {
  switch (event.type) {
    case "started":
      return `Opening ${event.platform ?? event.domain} in a live browser session.`;
    case "live_url":
      return `Live browser view is ready for ${event.platform ?? event.domain}. You can watch the search now.`;
    case "progress":
      return `Still checking ${event.platform ?? event.domain} for cleaner trip details.`;
    case "completed":
      return `Finished checking ${event.platform ?? event.domain}.`;
    case "fallback":
      return `Live browser extraction stalled on ${event.platform ?? event.domain}, so the backup extractor took over.`;
    case "error":
      return event.message;
  }
}

type BucketExecutionContext = {
  runId: string;
  request: DiscoverRequest;
  bucket: DiscoveryCard["bucket"];
  index: number;
  seedCards: DiscoveryCard[];
  registryCandidates: Awaited<ReturnType<typeof loadSourceRegistry>>;
  showDetailedProgress: boolean;
  allowFastTrackOpenAi: boolean;
  announceBackgroundLayer: boolean;
};

async function executeBucket({
  runId,
  request,
  bucket,
  index,
  seedCards,
  registryCandidates,
  showDetailedProgress,
  allowFastTrackOpenAi,
  announceBackgroundLayer,
}: BucketExecutionContext) {
  const bucketCards = seedCards.filter((card) => card.bucket === bucket);
  const matchingRegistryCandidates = registryCandidates.filter((candidate) => candidate.bucket === bucket);
  const shouldFastTrack = allowFastTrackOpenAi && shouldFastTrackOpenAiPlaces(bucket);
  const bucketCandidates =
    request.mode === "cache" || shouldFastTrack ? [] : await discoverLiveSources(bucket, request, matchingRegistryCandidates);

  if (bucketCards.length === 0 && bucketCandidates.length === 0 && !shouldFastTrack) {
    return { cards: [] as DiscoveryCard[], imageTask: null as Promise<void> | null, announcedBackgroundLayer: false };
  }

  if (showDetailedProgress) {
    runsStore.appendEvent(runId, {
      type: "scout",
      bucket,
      progress: 22 + index * 11,
      message: scopedSourceMessage(bucket),
    });
  } else if (announceBackgroundLayer) {
    runsStore.appendEvent(runId, {
      type: "scout",
      progress: 22 + index * 11,
      message: backgroundLayerMessage(bucket, 0),
    });
  }

  await sleep(180);

  if (showDetailedProgress) {
    runsStore.appendEvent(runId, {
      type: "verify",
      bucket,
      progress: 28 + index * 11,
      message:
        bucket === "food-hidden-gems"
          ? "Turning your request into a short list of real attractions and food stops."
          : `Verifying the strongest ${bucketLabel(bucket)} sources.`,
    });
  }

  const agentPlan = await planAgentJobs(runId, bucket, request, bucketCandidates, bucketCards);

  if (agentPlan.overview && showDetailedProgress) {
    runsStore.appendEvent(runId, {
      type: "scout",
      bucket,
      progress: 31 + index * 11,
      message: agentProgressMessage(bucket),
    });
  }

  const shouldRunAgentExtraction = agentPlan.jobs.length > 0 && !shouldFastTrack;

  if (shouldRunAgentExtraction && showDetailedProgress) {
    runsStore.appendEvent(runId, {
      type: "extract",
      bucket,
      progress: 33 + index * 11,
      message:
        bucket === "food-hidden-gems"
          ? "Opening the strongest place pages in a live browser to pull out concrete stops."
          : bucket === "flights"
            ? "Opening live fare pages so the shortlist is based on actual fare packages."
            : bucket === "hotels"
              ? "Opening hotel booking pages to compare cancellation terms and breakfast properly."
              : "Checking the most relevant place pages for cleaner itinerary detail.",
    });
  }

  const extractionResults = shouldRunAgentExtraction
    ? await extractCardEnrichment(runId, bucketCards, agentPlan.jobs, (event) => {
        runsStore.appendEvent(runId, {
          type: event.type === "error" ? "fallback" : "extract",
          bucket,
          progress:
            event.type === "live_url"
              ? Math.min(89, 35 + index * 11)
              : event.type === "completed"
                ? Math.min(92, 36 + index * 11)
                : event.type === "fallback"
                  ? Math.min(90, 35 + index * 11)
                  : Math.min(88, 34 + index * 11),
          message: workerProgressMessage(event),
          meta: {
            jobId: event.jobId,
            cardId: event.cardId,
            domain: event.domain,
            platform: event.platform,
            liveUrl: event.liveUrl,
            providerStatus: event.providerStatus,
          },
        });
      })
    : [];
  const enrichedSeedCards = shouldRunAgentExtraction
    ? mergeExtraction(
        bucketCards,
        extractionResults.filter((result) => bucketCards.some((card) => card.id === result.cardId)),
      )
    : bucketCards;
  const agentCards = shouldRunAgentExtraction
    ? await synthesizeAgentCards(bucket, request, agentPlan.jobs, extractionResults, bucketCandidates)
    : [];
  const liveCards = await synthesizeLiveSearchCards(bucket, request, bucketCandidates);
  const preparedCards = await prepareCardsForUi(dedupeCards([...enrichedSeedCards, ...agentCards, ...liveCards]));
  runsStore.upsertCards(runId, preparedCards);

  if (["food-hidden-gems", "local-transport", "hotels"].includes(bucket) && showDetailedProgress) {
    runsStore.appendEvent(runId, {
      type: "verify",
      bucket,
      progress: Math.min(92, 37 + index * 11),
      message: "Looking for real photos of the exact places, not generic destination shots.",
    });
  }

  const imageTask = enrichCardImages(preparedCards)
    .then(async (imageReadyCards) => {
      const preparedImageCards = await prepareCardsForUi(imageReadyCards);
      const previousById = new Map(preparedCards.map((card) => [card.id, card] as const));
      const gainedImages = preparedImageCards.filter((card) => {
        const previous = previousById.get(card.id);
        return card.imageUrls.length > 0 && (previous?.imageUrls.length ?? 0) === 0;
      });

      runsStore.upsertCards(runId, preparedImageCards);

      if (gainedImages.length > 0) {
        runsStore.appendEvent(runId, {
          type: "partial_board",
          bucket,
          progress: Math.min(97, 40 + index * 11),
          message: `Added real photos for ${gainedImages.length} ${bucketLabel(bucket)} result${gainedImages.length === 1 ? "" : "s"}.`,
        });
      }
    })
    .catch(() => {
      runsStore.appendEvent(runId, {
        type: "fallback",
        bucket,
        progress: Math.min(96, 39 + index * 11),
        message: `Image enrichment failed for ${bucketLabel(bucket)}. Keeping the text results.`,
      });
    });

  runsStore.appendEvent(runId, {
    type: "partial_board",
    bucket: showDetailedProgress ? bucket : undefined,
    progress: 35 + index * 11,
    message: showDetailedProgress
      ? `Added ${preparedCards.length} result${preparedCards.length === 1 ? "" : "s"} for ${bucketLabel(bucket)}.`
      : backgroundLayerMessage(bucket, preparedCards.length),
  });

  return {
    cards: preparedCards,
    imageTask,
    announcedBackgroundLayer: !showDetailedProgress && announceBackgroundLayer,
  };
}

export async function expandDiscoveryRun(
  runId: string,
  buckets: DiscoveryCard["bucket"][],
  _selectedCardIds: string[] = [],
) {
  const run = runsStore.get(runId);

  if (!run) {
    throw new Error("Run not found");
  }

  const request = run.request;
  const seed = await matchSeedDestination(request.prompt, request.destination);
  const registry = await loadSourceRegistry();
  const currentPlan = run.plan ?? createSearchPlan(request);
  const expandedPlan = {
    ...currentPlan,
    buckets: [...new Set([...currentPlan.buckets, ...buckets])],
  };
  const parsedSummary = createParsedSummary(request, expandedPlan);

  runsStore.updatePlan(runId, expandedPlan, parsedSummary);
  runsStore.appendEvent(runId, {
    type: "planner",
    progress: 36,
    message:
      buckets.length === 1 && buckets[0] === "flights"
        ? "Using the places you saved to unlock live flight options."
        : buckets.length === 1 && buckets[0] === "hotels"
          ? "Using the saved places and chosen flight to narrow better hotel bases."
          : "Unlocking the next planning layer from the trip choices you already made.",
  });

  const seedCards = seed ? chooseCardsForPlan(seed.cards, buckets) : [];
  const imageEnrichmentTasks: Promise<void>[] = [];

  for (const [index, bucket] of buckets.entries()) {
    const result = await executeBucket({
      runId,
      request,
      bucket,
      index,
      seedCards,
      registryCandidates: registry,
      showDetailedProgress: true,
      allowFastTrackOpenAi: false,
      announceBackgroundLayer: false,
    });

    if (result.imageTask) {
      imageEnrichmentTasks.push(result.imageTask);
    }
  }

  if (imageEnrichmentTasks.length > 0) {
    await Promise.allSettled(imageEnrichmentTasks);
  }

  runsStore.appendEvent(runId, {
    type: "synthesize",
    progress: 95,
    message:
      buckets.length === 1 && buckets[0] === "flights"
        ? "Organizing the fare shortlist around your current trip shape."
        : buckets.length === 1 && buckets[0] === "hotels"
          ? "Organizing the hotel shortlist around your saved places."
          : "Organizing the next layer so it stays easy to compare.",
  });

  runsStore.markCompleted(runId);
  runsStore.appendEvent(runId, {
    type: "done",
    progress: 100,
    message:
      buckets.length === 1 && buckets[0] === "flights"
        ? "Flight options are ready."
        : buckets.length === 1 && buckets[0] === "hotels"
          ? "Hotel options are ready."
          : "More options are ready.",
  });
}

export async function executeDiscoveryRun(runId: string, request: DiscoverRequest) {
  try {
    const plan = createSearchPlan(request);
    const parsedSummary = createParsedSummary(request, plan);
    const seed = await matchSeedDestination(request.prompt, request.destination);
    const registry = await loadSourceRegistry();
    const seedCards = seed ? chooseCardsForPlan(seed.cards, plan.buckets) : [];

    runsStore.updatePlan(runId, plan, parsedSummary);
    runsStore.appendEvent(runId, {
      type: "planner",
      progress: 8,
      message: `Understood the request. ${parsedSummary}`,
    });

    await sleep(220);

    runsStore.appendEvent(runId, {
      type: "scout",
      progress: 16,
      message:
        request.mode === "cache"
          ? "Loading saved trip research for this request."
          : plan.buckets[0] === "food-hidden-gems"
            ? "Building the first attractions pass from your request."
          : "Finding live sources for the actual trip request.",
    });

    const imageEnrichmentTasks: Promise<void>[] = [];
    let backgroundLayerAnnounced = false;

    for (const [index, bucket] of plan.buckets.entries()) {
      const result = await executeBucket({
        runId,
        request,
        bucket,
        index,
        seedCards,
        registryCandidates: registry,
        showDetailedProgress: isForegroundConversationBucket(bucket),
        allowFastTrackOpenAi: true,
        announceBackgroundLayer: !backgroundLayerAnnounced,
      });

      if (result.announcedBackgroundLayer) {
        backgroundLayerAnnounced = true;
      }

      if (result.imageTask) {
        imageEnrichmentTasks.push(result.imageTask);
      }
    }

    if (imageEnrichmentTasks.length > 0) {
      await Promise.allSettled(imageEnrichmentTasks);
    }

    if (request.mode !== "live") {
      runsStore.appendEvent(runId, {
        type: "fallback",
        progress: 85,
        message:
          seed && request.mode !== "cache"
            ? "Using live research, with a saved backup ready if a source slows down."
            : "Using live research for this trip.",
      });
    }

    await sleep(120);

    runsStore.appendEvent(runId, {
      type: "synthesize",
      progress: 95,
      message: "Organizing the results so the trip board and schedule stay easy to scan.",
    });

    runsStore.markCompleted(runId);
    runsStore.appendEvent(runId, {
      type: "done",
      progress: 100,
      message: "Results are ready. You can now build the trip schedule.",
    });
  } catch (error) {
    runsStore.markFailed(runId);
    runsStore.appendEvent(runId, {
      type: "error",
      progress: 100,
      message: error instanceof Error ? error.message : "The discovery run failed.",
    });
  }
}
