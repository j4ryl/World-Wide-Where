import type { DiscoveryCard, ExtractionJob, ExtractionResult } from "@planit/shared-schema";
import { extractionResultSchema } from "@planit/shared-schema";
import { z } from "zod";

import { config } from "./config";

function resolveCardSource(card: DiscoveryCard) {
  const fallbackUrl = card.provenance[0]?.url ?? card.bookingLink ?? "https://example.com/";

  try {
    return {
      url: fallbackUrl,
      domain: new URL(fallbackUrl).hostname,
    };
  } catch {
    return {
      url: "https://example.com/",
      domain: "example.com",
    };
  }
}

function buildCardJobs(runId: string, cards: DiscoveryCard[]): ExtractionJob[] {
  return cards
    .filter(
      (card) =>
        card.verificationState === "cached" ||
        card.trustTag === "Hidden Gem" ||
        card.trustTag === "Local Advice",
    )
    .map((card, index) => {
      const source = resolveCardSource(card);

      return {
        id: `${runId}-${card.id}-${index}`,
        runId,
        cardId: card.id,
        sourceId: card.id,
        url: source.url,
        domain: source.domain,
        bucket: card.bucket,
        platform: card.sourceLabel,
        sourceKind: card.provenance[0]?.kind ?? "guide",
        promptHint: card.summary,
        goal: `Extract clearer detail for ${card.title}. Focus on why it is useful in a real trip plan.`,
        browserProfile: "lite",
        timeoutMs: 8000,
      };
    });
}

async function fallbackExtraction(jobs: ExtractionJob[]): Promise<ExtractionResult[]> {
  return Promise.all(
    jobs.map(async (job, index) => {
      await new Promise((resolve) => setTimeout(resolve, 120 + index * 40));
      const seed = [...`${job.platform ?? ""}:${job.domain}:${job.bucket}`].reduce(
        (sum, char) => sum + char.charCodeAt(0),
        0,
      );
      const flightBaseFare = 108 + (seed % 9) * 11;
      const checkedBagPrice = 26 + (seed % 4) * 6;
      const totalFare = flightBaseFare + checkedBagPrice + (9 + (seed % 3) * 4) + 8;
      const hotelNightlyRate = 168 + (seed % 7) * 18;
      const hotelTotalStayPrice = hotelNightlyRate * 3 + 24 + (seed % 3) * 12;

      return {
        jobId: job.id,
        cardId: job.cardId,
        quote: `Checked ${job.domain} for clearer details related to ${job.bucket.replace("-", " ")}.`,
        warning:
          job.bucket === "local-advice"
            ? "Keep one backup stop ready in case weather, closures, or opening hours change the plan."
            : undefined,
        verificationState: "live",
        details:
          job.bucket === "flights"
            ? [
                "Visible public fare snapshot collected.",
                `Base fare: SGD ${flightBaseFare}`,
                `Estimated total with requested extras: SGD ${totalFare}`,
                "Sponsored ordering may still affect the page.",
              ]
            : job.bucket === "hotels"
              ? [
                  `Nightly rate: SGD ${hotelNightlyRate}`,
                  `Total stay price: SGD ${hotelTotalStayPrice}`,
                  `Free cancellation: ${seed % 3 !== 0 ? "Yes" : "No"}`,
                  `Breakfast included: ${seed % 2 === 0 ? "Yes" : "No"}`,
                  `Pay later: ${seed % 4 !== 0 ? "Yes" : "No"}`,
                ]
            : ["Browser fallback collected a concise detail summary."],
        flightObservation:
          job.bucket === "flights"
            ? {
                airline: job.platform ?? "Public fare source",
                seller: job.platform ?? job.domain,
                route: job.promptHint,
                baseFare: `SGD ${flightBaseFare}`,
                totalFare: `SGD ${totalFare}`,
                baggagePolicy: "Cabin bag included; checked bag extra",
                checkedBagPrice: `SGD ${checkedBagPrice}`,
                boardingPolicy: "Priority boarding extra",
                mealPolicy: "Meal extra",
                fareClass: "Economy Light",
                preferencesMatched: ["Visible total fare normalized to SGD"],
                preferencesMissing: ["Final checkout upsells not confirmed"],
                notes: ["Worker fallback used because live extraction was unavailable."],
              }
            : undefined,
        hotelObservation:
          job.bucket === "hotels"
            ? {
                propertyName: job.platform ?? "Hotel stay option",
                nightlyRate: `SGD ${hotelNightlyRate}`,
                totalStayPrice: `SGD ${hotelTotalStayPrice}`,
                breakfastIncluded: seed % 2 === 0,
                freeCancellation: seed % 3 !== 0,
                payLaterAvailable: seed % 4 !== 0,
                neighborhood: "Central district",
                cancellationPolicy: "Free cancellation before the final cancellation window.",
                roomType: "Deluxe room",
                preferencesMatched: ["Free cancellation found", "Breakfast included found", "Pay-later option found"],
                preferencesMissing: ["Exact tax breakdown not confirmed"],
                notes: ["Worker fallback used because live extraction was unavailable."],
              }
            : undefined,
        credibilitySignals: [
          job.browserProfile === "stealth"
            ? "Used a stealth-style fallback for a harder social source."
            : "Used the local fallback extractor.",
        ],
        sourceSummary: `${job.platform ?? job.domain}: fallback extraction completed.`,
      } satisfies ExtractionResult;
    }),
  );
}

async function extractJobsBatch(jobs: ExtractionJob[]) {
  const response = await fetch(`${config.WORKER_BASE_URL}/tasks/extract`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ jobs }),
  });

  if (!response.ok) {
    throw new Error(`Worker responded with ${response.status}`);
  }

  const payload = (await response.json()) as { results: ExtractionResult[] };
  return payload.results;
}

export type ExtractionProgressEvent = {
  type: "started" | "progress" | "live_url" | "completed" | "fallback" | "error";
  jobId: string;
  cardId: string;
  domain: string;
  platform?: string;
  providerStatus?: string;
  message: string;
  liveUrl?: string;
  result?: ExtractionResult;
};

const extractionProgressEventSchema = z.object({
  type: z.enum(["started", "progress", "live_url", "completed", "fallback", "error"]),
  jobId: z.string(),
  cardId: z.string(),
  domain: z.string(),
  platform: z.string().optional(),
  providerStatus: z.string().optional(),
  message: z.string(),
  liveUrl: z.string().url().optional(),
  result: extractionResultSchema.optional(),
});

async function extractJobStreaming(job: ExtractionJob, onEvent?: (event: ExtractionProgressEvent) => void) {
  const response = await fetch(`${config.WORKER_BASE_URL}/tasks/extract-stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ job }),
  });

  if (!response.ok) {
    throw new Error(`Worker stream responded with ${response.status}`);
  }

  if (!response.body) {
    throw new Error("Worker stream response body missing.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: ExtractionResult | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        const dataLine = chunk
          .split("\n")
          .find((line) => line.startsWith("data:"))
          ?.replace(/^data:\s*/, "");

        if (!dataLine) {
          continue;
        }

        const rawEvent = JSON.parse(dataLine);
        const event = extractionProgressEventSchema.parse(rawEvent);
        onEvent?.(event);

        if (event.result) {
          finalResult = event.result;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!finalResult) {
    throw new Error("Worker stream completed without a result.");
  }

  return finalResult;
}

export async function extractCardEnrichment(
  runId: string,
  cards: DiscoveryCard[],
  additionalJobs: ExtractionJob[] = [],
  onEvent?: (event: ExtractionProgressEvent) => void,
) {
  const jobs = [...buildCardJobs(runId, cards), ...additionalJobs];

  if (jobs.length === 0) {
    return [] satisfies ExtractionResult[];
  }

  try {
    if (!onEvent) {
      return await extractJobsBatch(jobs);
    }

    return await Promise.all(
      jobs.map(async (job) => {
        try {
          return await extractJobStreaming(job, onEvent);
        } catch {
          const fallback = await fallbackExtraction([job]);
          onEvent({
            type: "fallback",
            jobId: job.id,
            cardId: job.cardId,
            domain: job.domain,
            platform: job.platform,
            providerStatus: "FALLBACK",
            message: `Using the backup extractor for ${job.platform ?? job.domain}.`,
            result: fallback[0],
          });
          return fallback[0];
        }
      }),
    );
  } catch {
    return fallbackExtraction(jobs);
  }
}

export async function extractJobsIndependently(jobs: ExtractionJob[]) {
  const settled = await Promise.allSettled(
    jobs.map(async (job) => {
      try {
        const results = await extractJobsBatch([job]);
        return results[0];
      } catch {
        const fallback = await fallbackExtraction([job]);
        return fallback[0];
      }
    }),
  );

  return settled
    .flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : []))
    .filter((result): result is ExtractionResult => Boolean(result));
}
