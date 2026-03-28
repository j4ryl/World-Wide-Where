import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import type {
  DiscoverRequest,
  DiscoveryCard,
  DiscoveryRunSnapshot,
  FlightPreferences,
  FlightWatchDemoResult,
  RunStreamMessage,
} from "@planit/shared-schema";
import {
  CalendarRange,
  Compass,
  Send,
  Sparkles,
} from "lucide-react";

import { ChatLayout } from "./components/ChatLayout";
import { HybridGlassboxPanel } from "./components/HybridGlassboxPanel";
import { LocalAdvicePanel } from "./components/LocalAdvicePanel";
import { MapPanel } from "./components/MapPanel";
import { ResultsBoard } from "./components/ResultsBoard";
import { SuggestedLogisticsPanel } from "./components/SuggestedLogisticsPanel";
import { TimelineBoard } from "./components/TimelineBoard";
import {
  buildTimelineRequest,
  createRun,
  expandRun,
  fetchRun,
  recalculateTimelineRequest,
  startFlightWatchDemo,
  subscribeToRun,
} from "./lib/api";
import { usePlannerStore } from "./store/usePlannerStore";

const initialRequest: DiscoverRequest = {
  prompt: "",
  origin: "Singapore",
  destination: "",
  dates: undefined,
  travelers: {
    adults: 2,
    children: 0,
  },
  busyWindows: [],
  mode: "hybrid",
  pricingMode: "public",
};

const demoDestinations = ["Bangkok", "Kuala Lumpur", "Korea", "Japan", "Shanghai"] as const;
const dummyMessageHistory = [
  {
    id: "intro",
    role: "assistant" as const,
    title: "Assistant",
    body: "You’re starting from Singapore. Tell me where you want to go and what kind of trip you want, and I’ll help shape it from there.",
  },
];

const placeBuckets: DiscoveryCard["bucket"][] = ["food-hidden-gems"];
const minimumPinnedPlaces = 2;

type ConversationStep = "places" | "flights" | "hotels" | "schedule";

function mentionsFlights(prompt: string) {
  const value = prompt.toLowerCase();
  return value.includes("flight") || value.includes("fly") || value.includes("airline");
}

function ensureFlightPreferences(value: DiscoverRequest, patch: Partial<FlightPreferences>) {
  return {
    baggage: value.flightPreferences?.baggage ?? "cabin_only",
    boarding: value.flightPreferences?.boarding ?? "no_preference",
    meals: value.flightPreferences?.meals ?? "no_preference",
    fareStyle: value.flightPreferences?.fareStyle ?? "balanced",
    sellerPreference: value.flightPreferences?.sellerPreference ?? "direct_preferred",
    ...patch,
  } satisfies FlightPreferences;
}

function bucketLabel(bucket: DiscoveryCard["bucket"]) {
  switch (bucket) {
    case "food-hidden-gems":
      return "Food";
    case "local-transport":
      return "Transport";
    case "hotels":
      return "Hotels";
    case "flights":
      return "Flights";
    case "car-rental":
      return "Car";
    case "local-advice":
      return "Advice";
  }
}

function providerProgressCopy(
  platform: string | undefined,
  providerStatus: string | undefined,
  fallback: string,
) {
  const label = platform?.trim();

  if (!label || !providerStatus) {
    return fallback;
  }

  switch (providerStatus) {
    case "STARTED":
      return `Checking ${label} in a live browser.`;
    case "STREAMING_URL":
      return `Live view is ready for ${label}.`;
    case "COMPLETED":
      return `Finished checking ${label}.`;
    case "FALLBACK":
      return `The live check on ${label} stalled, so I switched to a backup extractor.`;
    default:
      return fallback;
  }
}

function mergeById<T extends { id: string }>(previous: T[], next: T[]) {
  const merged = new Map<string, T>();

  for (const entry of previous) {
    merged.set(entry.id, entry);
  }

  for (const entry of next) {
    merged.set(entry.id, entry);
  }

  return Array.from(merged.values());
}

function mergeRunSnapshots(
  previous: DiscoveryRunSnapshot | null,
  next: DiscoveryRunSnapshot,
) {
  if (!previous || previous.id !== next.id) {
    return next;
  }

  return {
    ...previous,
    ...next,
    plan: next.plan ?? previous.plan,
    parsedSummary: next.parsedSummary ?? previous.parsedSummary,
    cards: mergeById(previous.cards, next.cards),
    events: mergeById(previous.events, next.events),
  } satisfies DiscoveryRunSnapshot;
}

type MessageBubbleProps = {
  role: "user" | "assistant" | "status";
  title: string;
  body: string;
  meta?: string;
  action?: {
    href: string;
    label: string;
  };
};

type StreamingTextProps = {
  text: string;
  className: string;
  active: boolean;
};

function StreamingText({ text, className, active }: StreamingTextProps) {
  const [visibleText, setVisibleText] = useState(active ? "" : text);

  useEffect(() => {
    if (!active) {
      setVisibleText(text);
      return;
    }

    setVisibleText("");
    let index = 0;
    const step = Math.max(1, Math.ceil(text.length / 36));
    const timeoutId = window.setInterval(() => {
      index = Math.min(text.length, index + step);
      setVisibleText(text.slice(0, index));

      if (index >= text.length) {
        window.clearInterval(timeoutId);
      }
    }, 18);

    return () => {
      window.clearInterval(timeoutId);
    };
  }, [active, text]);

  return <p className={className}>{visibleText}</p>;
}

function MessageBubble({ role, title, body, meta, action }: MessageBubbleProps) {
  const isUser = role === "user";
  const isStatus = role === "status";
  const shouldStream = !isUser;

  return (
    <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser ? (
        <div className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${isStatus ? "border-sky-200 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-700"}`}>
          {isStatus ? <Sparkles className="h-4 w-4" /> : <Compass className="h-4 w-4" />}
        </div>
      ) : null}
      <div
        className={`max-w-[48rem] rounded-[28px] border px-5 py-4 shadow-sm ${
          isUser
            ? "border-slate-900 bg-slate-900 text-white"
            : isStatus
              ? "border-sky-200 bg-sky-50/90 text-slate-900"
              : "border-slate-200 bg-white text-slate-900"
        }`}
      >
        <div className="flex items-center gap-2">
          <p className={`text-xs font-semibold uppercase tracking-[0.25em] ${isUser ? "text-white/60" : "text-slate-500"}`}>{title}</p>
          {meta ? <span className={`text-xs ${isUser ? "text-white/50" : "text-slate-400"}`}>{meta}</span> : null}
        </div>
        <StreamingText
          active={shouldStream}
          text={body}
          className={`mt-2 text-sm leading-7 ${isUser ? "text-white/92" : "text-slate-700"}`}
        />
        {action ? (
          <a
            href={action.href}
            target="_blank"
            rel="noreferrer"
            className={`mt-3 inline-flex items-center rounded-full px-3.5 py-2 text-sm font-semibold transition ${
              isUser
                ? "bg-white/10 text-white hover:bg-white/15"
                : "bg-slate-900 text-white hover:bg-slate-800"
            }`}
          >
            {action.label}
          </a>
        ) : null}
      </div>
    </motion.article>
  );
}

type ChoiceButtonProps = {
  label: string;
  active: boolean;
  onClick: () => void;
};

function ChoiceButton({ label, active, onClick }: ChoiceButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
        active
          ? "bg-slate-900 text-white shadow-lg shadow-slate-900/20"
          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
      }`}
    >
      {label}
    </button>
  );
}

export default function App() {
  const [request, setRequest] = useState<DiscoverRequest>(initialRequest);
  const [submittedRequest, setSubmittedRequest] = useState<DiscoverRequest | null>(null);
  const [userMessages, setUserMessages] = useState<Array<{ id: string; body: string; meta: string }>>([]);
  const [run, setRun] = useState<DiscoveryRunSnapshot | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [flightWatches, setFlightWatches] = useState<Record<string, FlightWatchDemoResult>>({});
  const [flightBudget, setFlightBudget] = useState(480);
  const [hotelBudget, setHotelBudget] = useState(220);
  const [hotelStyle, setHotelStyle] = useState<"calm" | "central" | "design">("central");
  const [isEditingTripDetails, setIsEditingTripDetails] = useState(false);
  const [hasConfirmedPlaces, setHasConfirmedPlaces] = useState(false);
  const [requestedExpansions, setRequestedExpansions] = useState<Record<string, boolean>>({});
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const flightsPanelRef = useRef<HTMLDivElement | null>(null);
  const hotelsPanelRef = useRef<HTMLDivElement | null>(null);
  const schedulePanelRef = useRef<HTMLDivElement | null>(null);

  const selectedCardIds = usePlannerStore((state) => state.selectedCardIds);
  const timelineNodes = usePlannerStore((state) => state.timelineNodes);
  const toggleSelectedCard = usePlannerStore((state) => state.toggleSelectedCard);
  const setSelectedCardIds = usePlannerStore((state) => state.setSelectedCardIds);
  const setTimelineNodes = usePlannerStore((state) => state.setTimelineNodes);
  const reorderTimeline = usePlannerStore((state) => state.reorderTimeline);
  const resetStore = usePlannerStore((state) => state.reset);

  const deferredCards = useDeferredValue(run?.cards ?? []);
  const placeCards = useMemo(
    () => deferredCards.filter((card) => placeBuckets.includes(card.bucket)),
    [deferredCards],
  );
  const flightCards = useMemo(
    () => deferredCards.filter((card) => card.bucket === "flights"),
    [deferredCards],
  );
  const hotelCards = useMemo(
    () => deferredCards.filter((card) => card.bucket === "hotels"),
    [deferredCards],
  );
  const localAdviceCards = useMemo(
    () => deferredCards.filter((card) => card.bucket === "local-advice"),
    [deferredCards],
  );
  const selectedPlaces = useMemo(
    () => deferredCards.filter((card) => selectedCardIds.includes(card.id) && placeBuckets.includes(card.bucket)),
    [deferredCards, selectedCardIds],
  );
  const selectedFlights = useMemo(
    () => deferredCards.filter((card) => selectedCardIds.includes(card.id) && card.bucket === "flights"),
    [deferredCards, selectedCardIds],
  );
  const selectedHotels = useMemo(
    () => deferredCards.filter((card) => selectedCardIds.includes(card.id) && card.bucket === "hotels"),
    [deferredCards, selectedCardIds],
  );
  const selectedPlaceIds = useMemo(() => selectedPlaces.map((card) => card.id), [selectedPlaces]);
  const selectedFlightIds = useMemo(() => selectedFlights.map((card) => card.id), [selectedFlights]);
  const selectedHotelIds = useMemo(() => selectedHotels.map((card) => card.id), [selectedHotels]);

  const discoverMutation = useMutation({
    mutationFn: createRun,
    onMutate: () => {
      setErrorMessage(null);
      setRun(null);
      setRunId(null);
      setFlightWatches({});
      setHasConfirmedPlaces(false);
      setRequestedExpansions({});
      resetStore();
    },
    onSuccess: async ({ runId: nextRunId }) => {
      setRunId(nextRunId);
      const latestRun = await fetchRun(nextRunId);
      setRun((current) => mergeRunSnapshots(current, latestRun));
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Could not start the trip search.");
    },
  });

  const timelineMutation = useMutation({
    mutationFn: buildTimelineRequest,
    onSuccess: ({ nodes }) => {
      setTimelineNodes(nodes);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Could not build the itinerary.");
    },
  });

  const recalculateMutation = useMutation({
    mutationFn: recalculateTimelineRequest,
    onSuccess: ({ nodes }) => {
      setTimelineNodes(nodes);
    },
  });

  const flightWatchMutation = useMutation({
    mutationFn: startFlightWatchDemo,
  });

  const expandRunMutation = useMutation({
    mutationFn: expandRun,
    onError: (error, variables) => {
      setRequestedExpansions((current) => {
        const next = { ...current };
        delete next[`${variables.runId}:${variables.buckets.join(",")}`];
        return next;
      });
      setErrorMessage(error instanceof Error ? error.message : "Could not expand this trip step.");
    },
  });

  useEffect(() => {
    if (!runId) {
      return;
    }

    const stream = subscribeToRun(runId, (message: RunStreamMessage) => {
      setRun((current) => mergeRunSnapshots(current, message.run));
    });

    stream.onerror = () => {
      stream.close();
    };

    return () => {
      stream.close();
    };
  }, [runId]);

  const activePrompt = submittedRequest?.prompt ?? request.prompt;
  const needsFlightPreferences = mentionsFlights(activePrompt);
  const isRunCompleted = run?.status === "completed";
  const isRunInProgress = run?.status === "queued" || run?.status === "running";
  const hasEnoughPlaces = selectedPlaces.length >= minimumPinnedPlaces;
  const hasUnlockedFlights = hasEnoughPlaces && hasConfirmedPlaces;
  const hasSelectedFlight = selectedFlights.length > 0;
  const hasSelectedHotel = selectedHotels.length > 0;
  const logisticsSatisfied = hasUnlockedFlights && hasSelectedFlight && hasSelectedHotel;
  const currentStep: ConversationStep = timelineNodes.length > 0
    ? "schedule"
    : !hasUnlockedFlights
      ? "places"
      : !hasSelectedFlight
        ? "flights"
        : !hasSelectedHotel
          ? "hotels"
          : "schedule";

  const visibleEventBuckets = useMemo(() => {
    if (currentStep === "places") {
      return new Set<DiscoveryCard["bucket"]>(placeBuckets);
    }

    if (currentStep === "flights") {
      return new Set<DiscoveryCard["bucket"]>([...placeBuckets, "flights"]);
    }

    return new Set<DiscoveryCard["bucket"]>([...placeBuckets, "flights", "hotels", "local-advice"]);
  }, [currentStep]);

  const latestHelperEvent = useMemo(() => {
    if (!run) {
      return null;
    }

    const latestEvent = run.events
      .filter((event) => !event.bucket || visibleEventBuckets.has(event.bucket))
      .at(-1);

    if (!latestEvent) {
      return null;
    }

    return {
      id: latestEvent.id,
      title: `${String(latestEvent.progress).padStart(2, "0")}%`,
      body: providerProgressCopy(
        latestEvent.meta?.platform ?? latestEvent.meta?.domain,
        latestEvent.meta?.providerStatus,
        latestEvent.message,
      ),
      meta: [
        latestEvent.bucket ? bucketLabel(latestEvent.bucket) : null,
        latestEvent.meta?.platform ?? latestEvent.meta?.domain ?? null,
      ]
        .filter(Boolean)
        .join(" • "),
      liveUrl: latestEvent.meta?.liveUrl,
    };
  }, [run, visibleEventBuckets]);

  const latestLiveEvent = useMemo(() => {
    if (!run) {
      return null;
    }

    const liveEvent = [...run.events].reverse().find((event) => event.meta?.liveUrl);

    if (!liveEvent?.meta?.liveUrl) {
      return null;
    }

    return {
      liveUrl: liveEvent.meta.liveUrl,
      label: liveEvent.meta.platform ?? liveEvent.meta.domain ?? "Live browser",
    };
  }, [run]);

  const inProgressThreadBody = useMemo(() => {
    if (!run || !isRunInProgress) {
      return null;
    }

    return [
      run.parsedSummary,
      latestHelperEvent?.body,
      "I’ll show the actual options once this pass is finished.",
    ]
      .filter(Boolean)
      .join(" ");
  }, [isRunInProgress, latestHelperEvent?.body, run]);

  const phaseIntro = useMemo(() => {
    if (!run) {
      return request.prompt.trim()
        ? "I’ll pull the useful choices into the conversation as they become relevant."
        : "Tell me the kind of trip you want and I’ll start narrowing it down.";
    }

    if (isRunInProgress) {
      return "I’m still researching the trip. I’ll show the actual options once this pass is finished.";
    }

    if (run.status === "failed") {
      return "This search did not finish cleanly. Adjust the request and I’ll try again.";
    }

    if (currentStep === "places") {
      if (placeCards.length === 0) {
        return "I finished the first pass, but I don’t have strong place matches to show yet. Try a more specific request.";
      }

      if (hasEnoughPlaces && !hasConfirmedPlaces) {
        return "You’ve picked enough places. Confirm these attractions and I’ll move on to flights.";
      }

      return "I found a few places worth starting with. Save the ones you would actually want this trip to revolve around.";
    }

    if (currentStep === "flights") {
      return needsFlightPreferences && !request.flightPreferences
        ? "That gives the trip enough shape. Set the fare preferences you care about, then pick one flight that feels right."
        : "That gives the trip enough shape. Here are a few flights that match the places you saved.";
    }

    if (currentStep === "hotels") {
      return "Flight is set. Now pick a base that makes the places you saved easy to reach.";
    }

    return timelineNodes.length
      ? "The outline is ready. Drag it around until the days feel natural."
      : "The core choices are in place. I can turn them into a day-by-day plan whenever you’re ready.";
  }, [currentStep, hasConfirmedPlaces, hasEnoughPlaces, isRunInProgress, needsFlightPreferences, placeCards.length, request.flightPreferences, request.prompt, run, timelineNodes.length]);

  const assistantThreadBody = useMemo(() => {
    if (!run) {
      return null;
    }

    if (isRunInProgress) {
      return inProgressThreadBody;
    }

    return [run.parsedSummary, phaseIntro]
      .filter(Boolean)
      .join(" ");
  }, [inProgressThreadBody, isRunInProgress, phaseIntro, run]);

  const assistantThreadMeta = useMemo(() => {
    if (!run) {
      return undefined;
    }

    if (isRunInProgress) {
      return [latestHelperEvent?.title, latestHelperEvent?.meta]
        .filter(Boolean)
        .join(" • ") || run.status;
    }

    return run.status;
  }, [isRunInProgress, latestHelperEvent?.meta, latestHelperEvent?.title, run]);

  const assistantThreadAction = useMemo(() => {
    if (!isRunInProgress || !latestLiveEvent?.liveUrl) {
      return undefined;
    }

    return {
      href: latestLiveEvent.liveUrl,
      label: `Watch live${latestLiveEvent.label ? `: ${latestLiveEvent.label}` : ""}`,
    };
  }, [isRunInProgress, latestLiveEvent?.label, latestLiveEvent?.liveUrl]);

  useEffect(() => {
    if (selectedPlaces.length < minimumPinnedPlaces) {
      setHasConfirmedPlaces(false);
    }
  }, [selectedPlaces.length]);

  useEffect(() => {
    if (!runId || !run || !hasUnlockedFlights || currentStep !== "flights" || flightCards.length > 0) {
      return;
    }

    const expansionKey = `${runId}:flights`;

    if (requestedExpansions[expansionKey] || expandRunMutation.isPending) {
      return;
    }

    setRequestedExpansions((current) => ({ ...current, [expansionKey]: true }));
    expandRunMutation.mutate({
      runId,
      buckets: ["flights"],
      selectedCardIds: selectedPlaceIds,
    });
  }, [
    currentStep,
    expandRunMutation,
    flightCards.length,
    hasUnlockedFlights,
    requestedExpansions,
    run,
    runId,
    selectedPlaceIds,
  ]);

  useEffect(() => {
    if (!runId || !run || currentStep !== "hotels" || hotelCards.length > 0 || selectedFlights.length === 0) {
      return;
    }

    const expansionKey = `${runId}:hotels`;

    if (requestedExpansions[expansionKey] || expandRunMutation.isPending) {
      return;
    }

    setRequestedExpansions((current) => ({ ...current, [expansionKey]: true }));
    expandRunMutation.mutate({
      runId,
      buckets: ["hotels"],
      selectedCardIds: [...selectedPlaceIds, ...selectedFlightIds],
    });
  }, [
    currentStep,
    expandRunMutation,
    hotelCards.length,
    requestedExpansions,
    run,
    runId,
    selectedFlightIds,
    selectedFlights.length,
    selectedPlaceIds,
  ]);

  function handleToggleSelection(cardId: string) {
    const card = deferredCards.find((entry) => entry.id === cardId);

    if (!card) {
      return;
    }

    if (card.bucket === "flights" || card.bucket === "hotels") {
      const nextIds = selectedCardIds.filter((selectedId) => {
        const selectedCard = deferredCards.find((entry) => entry.id === selectedId);
        return selectedCard?.bucket !== card.bucket;
      });

      if (!selectedCardIds.includes(cardId)) {
        nextIds.push(cardId);
      }

      setSelectedCardIds(nextIds);
      return;
    }

    toggleSelectedCard(cardId);
  }

  useEffect(() => {
    const node = bottomRef.current;

    if (!node) {
      return;
    }

    requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }, [latestHelperEvent?.id, latestHelperEvent?.body, currentStep, run?.status, selectedCardIds.length, timelineNodes.length, errorMessage]);

  useEffect(() => {
    if (!isRunCompleted) {
      return;
    }

    const target =
      currentStep === "flights"
        ? flightsPanelRef.current
        : currentStep === "hotels"
          ? hotelsPanelRef.current
          : currentStep === "schedule"
            ? schedulePanelRef.current
            : null;

    if (!target) {
      return;
    }

    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [currentStep, isRunCompleted]);

  function handleBuildSchedule() {
    if (!selectedCardIds.length) {
      return;
    }

    timelineMutation.mutate({
      runId: runId ?? undefined,
      selectedCardIds,
      destination: request.destination,
      dates: request.dates,
      busyWindows: request.busyWindows,
    });
  }

  function handleSubmit() {
    const nextRequest = {
      ...request,
      prompt: request.prompt.trim(),
    };

    setUserMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        body: nextRequest.prompt,
        meta: `${nextRequest.origin} -> ${nextRequest.destination || "Choose destination"}`,
      },
    ]);
    if (!submittedRequest || isEditingTripDetails) {
      setSubmittedRequest(nextRequest);
    }
    setIsEditingTripDetails(false);
    discoverMutation.mutate(nextRequest);
    setRequest((current) => ({
      ...current,
      prompt: "",
    }));
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    if (discoverMutation.isPending || !request.prompt.trim() || !request.destination.trim()) {
      return;
    }

    event.preventDefault();
    handleSubmit();
  }

  const hasSentInitialMessage = Boolean(submittedRequest || run || runId || discoverMutation.isPending);
  const showTripDetailsForm = !hasSentInitialMessage || isEditingTripDetails;
  const activeTrip = submittedRequest ?? request;
  const tripSummary = `${activeTrip.origin} -> ${activeTrip.destination || "Choose destination"} • ${activeTrip.dates?.start && activeTrip.dates?.end ? `${activeTrip.dates.start} to ${activeTrip.dates.end}` : "Flexible dates"}`;
  const composerPlaceholder = showTripDetailsForm
    ? "Describe the trip once the destination and dates look right..."
    : "Send a follow-up or refine the trip...";

  return (
    <ChatLayout
      headerTitle="Plan a trip in one conversation."
      headerBody="Tell me where you want to go, what kind of trip you want, and I’ll help you narrow it down step by step."
      composer={
        <div className="rounded-[24px] border border-slate-200/80 bg-white/90 shadow-sm transition focus-within:border-slate-300 focus-within:shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
          {!showTripDetailsForm ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Trip details</p>
                <p className="truncate text-sm text-slate-700">{tripSummary}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditingTripDetails(true)}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
              >
                Edit trip
              </button>
            </div>
          ) : null}

          <div className="px-3 py-2.5">
            <textarea
              value={request.prompt}
              onChange={(event) => setRequest((current) => ({ ...current, prompt: event.target.value }))}
              onKeyDown={handleComposerKeyDown}
              placeholder={composerPlaceholder}
              rows={showTripDetailsForm ? 4 : 2}
              className={`w-full resize-none bg-transparent text-sm leading-7 text-slate-900 outline-none placeholder:text-slate-400 ${
                showTripDetailsForm ? "min-h-[6.25rem]" : "min-h-[3.5rem]"
              }`}
            />
            <div className="mt-2.5 flex items-center justify-end">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={discoverMutation.isPending || !request.prompt.trim() || !request.destination.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Send className="h-4 w-4" />
                {discoverMutation.isPending ? "Thinking..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {dummyMessageHistory.map((message) => (
          <MessageBubble key={message.id} role={message.role} title={message.title} body={message.body} />
        ))}

        {userMessages.map((message) => (
          <MessageBubble
            key={message.id}
            role="user"
            title="Trip brief"
            body={message.body}
            meta={message.meta}
          />
        ))}

        {assistantThreadBody ? (
          <MessageBubble
            role="assistant"
            title="Assistant"
            body={assistantThreadBody}
            meta={assistantThreadMeta}
            action={assistantThreadAction}
          />
        ) : null}

        {showTripDetailsForm ? (
          <section className="rounded-[24px] border border-slate-200 bg-white/92 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Trip details</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">Set the route first.</h2>
                <p className="mt-1 text-sm text-slate-600">Pick the destination and dates here, then describe the trip in the box below.</p>
              </div>
              {hasSentInitialMessage ? (
                <button
                  type="button"
                  onClick={() => setIsEditingTripDetails(false)}
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
                >
                  Done
                </button>
              ) : null}
            </div>

            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              <div className="space-y-2 rounded-[20px] border border-slate-200 bg-slate-50/80 p-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Origin</span>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-900">Singapore</span>
                </div>
              </div>

              <label className="space-y-2 rounded-[20px] border border-slate-200 bg-slate-50/80 p-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Destination</span>
                <select
                  value={request.destination}
                  onChange={(event) => setRequest((current) => ({ ...current, destination: event.target.value }))}
                  className="w-full bg-transparent text-sm text-slate-900 outline-none"
                >
                  <option value="">Choose destination</option>
                  {demoDestinations.map((destination) => (
                    <option key={destination} value={destination}>
                      {destination}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 rounded-[20px] border border-slate-200 bg-slate-50/80 p-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Start date</span>
                <input
                  type="date"
                  value={request.dates?.start ?? ""}
                  onChange={(event) =>
                    setRequest((current) => ({
                      ...current,
                      dates: {
                        start: event.target.value,
                        end: current.dates?.end,
                      },
                    }))
                  }
                  className="w-full bg-transparent text-sm text-slate-900 outline-none"
                />
              </label>

              <label className="space-y-2 rounded-[20px] border border-slate-200 bg-slate-50/80 p-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">End date</span>
                <input
                  type="date"
                  value={request.dates?.end ?? ""}
                  onChange={(event) =>
                    setRequest((current) => ({
                      ...current,
                      dates: {
                        start: current.dates?.start,
                        end: event.target.value,
                      },
                    }))
                  }
                  className="w-full bg-transparent text-sm text-slate-900 outline-none"
                />
              </label>
            </div>
          </section>
        ) : null}

        {run && isRunCompleted && placeCards.length > 0 ? (
          <HybridGlassboxPanel
            phaseLabel="Places"
            title="A few places to start with"
            summary="These are the spots that look most worth building the trip around."
            preview={selectedPlaces.length === 0 ? "Nothing pinned yet." : `${selectedPlaces.length} place${selectedPlaces.length === 1 ? "" : "s"} saved so far.`}
            accent="sky"
            userView={
              <ResultsBoard
                cards={placeCards}
                selectedPlaceIds={selectedPlaceIds}
                selectedPlaces={selectedPlaces}
                onToggle={handleToggleSelection}
                minimumSavedForNextStep={minimumPinnedPlaces}
                isSelectionConfirmed={hasConfirmedPlaces}
                onConfirmSelection={() => setHasConfirmedPlaces(true)}
              />
            }
          />
        ) : null}

        {run && hasUnlockedFlights && currentStep === "flights" ? (
          <div ref={flightsPanelRef}>
            <HybridGlassboxPanel
              phaseLabel="Flights"
              title="A few good ways to get there"
              summary="Start with the flight. Once that is in place, I’ll narrow the stay around it."
              preview={hasSelectedFlight ? "Flight chosen." : "Choose one flight to keep moving."}
              accent="amber"
              userView={
                <div className="space-y-4">
                  <section className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-4">
                    <div className="grid gap-4">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Flight budget</p>
                            <p className="text-xs text-slate-500">Use this as a rough ceiling while you compare.</p>
                          </div>
                          <p className="text-sm font-semibold text-slate-900">SGD {flightBudget}</p>
                        </div>
                        <input
                          type="range"
                          min={120}
                          max={1500}
                          step={20}
                          value={flightBudget}
                          onChange={(event) => setFlightBudget(Number(event.target.value))}
                          className="planner-range mt-4 w-full"
                        />
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-sm font-semibold text-slate-900">Baggage</p>
                        <p className="mt-1 text-xs text-slate-500">Only set this if it actually matters for the fare you want.</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {[
                            ["no_bag", "No bag"],
                            ["cabin_only", "Cabin only"],
                            ["one_checked_bag", "1 checked bag"],
                            ["two_checked_bags", "2 checked bags"],
                          ].map(([value, label]) => (
                            <ChoiceButton
                              key={value}
                              label={label}
                              active={request.flightPreferences?.baggage === value}
                              onClick={() =>
                                setRequest((current) => ({
                                  ...current,
                                  flightPreferences: ensureFlightPreferences(current, {
                                    baggage: value as FlightPreferences["baggage"],
                                  }),
                                }))
                              }
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>

                  <SuggestedLogisticsPanel
                    mode="flights"
                    cards={flightCards}
                    selectedPlaceCards={selectedPlaces}
                    selectedCardIds={selectedFlightIds}
                    watchedFlightCardIds={Object.keys(flightWatches)}
                    isWatchingFlight={flightWatchMutation.isPending}
                    onToggle={handleToggleSelection}
                    onWatchFlight={async (card) => {
                      const result = await flightWatchMutation.mutateAsync({
                        origin: request.origin,
                        destination: request.destination,
                        cardId: card.id,
                        title: card.title,
                      });
                      setFlightWatches((current) => ({ ...current, [card.id]: result }));
                    }}
                  selectedPlaceCount={selectedPlaces.length}
                  flightBudget={flightBudget}
                  flightPreferences={request.flightPreferences}
                  isComplete={isRunCompleted}
                />
              </div>
            }
          />
          </div>
        ) : null}

        {run && hasUnlockedFlights && currentStep === "hotels" ? (
          <div ref={hotelsPanelRef}>
            <HybridGlassboxPanel
              phaseLabel="Stay"
              title="Now pick where to stay"
              summary="With the flight in place, I can narrow the better bases for the places you saved."
              preview={hasSelectedHotel ? "Stay chosen." : "Choose one stay so I can build the trip around it."}
              accent="amber"
              userView={
                <div className="space-y-4">
                  {selectedFlights[0] ? (
                    <section className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Chosen flight</p>
                      <h3 className="mt-1 text-lg font-semibold text-slate-950">{selectedFlights[0].title}</h3>
                      <p className="mt-2 text-sm leading-7 text-slate-600">{selectedFlights[0].summary}</p>
                    </section>
                  ) : null}

                  <section className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-4">
                    <div className="grid gap-4">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Hotel nightly budget</p>
                            <p className="text-xs text-slate-500">Use this to keep the shortlist in the right range.</p>
                          </div>
                          <p className="text-sm font-semibold text-slate-900">SGD {hotelBudget}</p>
                        </div>
                        <input
                          type="range"
                          min={60}
                          max={700}
                          step={10}
                          value={hotelBudget}
                          onChange={(event) => setHotelBudget(Number(event.target.value))}
                          className="planner-range mt-4 w-full"
                        />
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-sm font-semibold text-slate-900">Hotel style</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <ChoiceButton label="Calm base" active={hotelStyle === "calm"} onClick={() => setHotelStyle("calm")} />
                          <ChoiceButton label="Central" active={hotelStyle === "central"} onClick={() => setHotelStyle("central")} />
                          <ChoiceButton label="Design-led" active={hotelStyle === "design"} onClick={() => setHotelStyle("design")} />
                        </div>
                      </div>
                    </div>
                  </section>

                  <SuggestedLogisticsPanel
                    mode="hotels"
                    cards={hotelCards}
                    selectedPlaceCards={selectedPlaces}
                    selectedCardIds={selectedHotelIds}
                    watchedFlightCardIds={[]}
                    isWatchingFlight={false}
                    onToggle={handleToggleSelection}
                    onWatchFlight={async () => undefined}
                    selectedPlaceCount={selectedPlaces.length}
                    flightBudget={flightBudget}
                    flightPreferences={request.flightPreferences}
                    isComplete={isRunCompleted}
                  />

                  {localAdviceCards.length ? <LocalAdvicePanel cards={localAdviceCards} /> : null}
                </div>
              }
            />
          </div>
        ) : null}

        {run && isRunCompleted && logisticsSatisfied ? (
          <div ref={schedulePanelRef}>
            <HybridGlassboxPanel
              phaseLabel="Itinerary"
              title="A first pass at the trip"
              summary="Here’s a route you can drag around until it feels right."
              preview={timelineNodes.length ? `${timelineNodes.length} stop${timelineNodes.length === 1 ? "" : "s"} in the current plan.` : "Build the itinerary when you’re ready."}
              accent="emerald"
              userView={
                <div className="space-y-4">
                  <div className="rounded-[28px] border border-slate-900 bg-slate-950 p-5 text-white">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/60">Ready when you are</p>
                        <h3 className="mt-2 text-xl font-semibold">Build the itinerary.</h3>
                        <p className="mt-2 text-sm leading-7 text-white/70">
                          Once the trip has enough shape, I can turn it into a day-by-day route.
                        </p>
                      </div>
                      <CalendarRange className="mt-1 h-5 w-5 shrink-0 text-white/60" />
                    </div>
                    <button
                      type="button"
                      disabled={timelineMutation.isPending}
                      onClick={handleBuildSchedule}
                      className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-white/30 disabled:text-white/60"
                    >
                      <CalendarRange className="h-4 w-4" />
                      {timelineMutation.isPending ? "Building..." : timelineNodes.length ? "Refresh itinerary" : "Build itinerary"}
                    </button>
                  </div>

                  <TimelineBoard
                    nodes={timelineNodes}
                    onReorder={(nextNodes) => {
                      reorderTimeline(nextNodes);
                      recalculateMutation.mutate({
                        runId: runId ?? undefined,
                        nodes: nextNodes,
                        destination: request.destination,
                        dates: request.dates,
                        busyWindows: request.busyWindows,
                      });
                    }}
                  />
                  <MapPanel nodes={timelineNodes} />
                </div>
              }
            />
          </div>
        ) : null}

        {errorMessage ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>
    </ChatLayout>
  );
}
