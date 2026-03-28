import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type {
  Bucket,
  DiscoveryCard,
  DiscoverRequest,
  ExtractionJob,
  ExtractionResult,
  FlightPreferences,
  HotelPreferences,
  SourceCandidate,
} from "@planit/shared-schema";
import { z } from "zod";

import { config } from "./config";
import { loadFlightSourceRegistry, type FlightSourceRegistryEntry } from "./flight-source-registry";

const plannerJobSchema = z.object({
  cardId: z.string(),
  sourceId: z.string(),
  goal: z.string(),
  titleHint: z.string(),
  browserProfile: z.enum(["lite", "stealth"]),
  proxyCountry: z.string().nullable().default(null),
});

const plannerOutputSchema = z.object({
  overview: z.string(),
  jobs: z.array(plannerJobSchema).max(5),
});

const synthesizedCardSchema = z.object({
  title: z.string(),
  summary: z.string(),
  whyItFits: z.string(),
  trustTag: z.enum([
    "Official Schedule",
    "Official Stay",
    "Verified Partner",
    "Local Tip",
    "Hidden Gem",
    "Local Advice",
  ]),
  trustSummary: z.string(),
  credibilityNotes: z.array(z.string()),
  sourceLabel: z.string(),
  recommendedDurationMinutes: z.number().int().positive(),
  touristPrice: z.string().nullable().default(null),
  localPrice: z.string().nullable().default(null),
  flightOffer: z
    .object({
      airline: z.string().nullable().default(null),
      seller: z.string().nullable().default(null),
      route: z.string().nullable().default(null),
      baseFare: z.string().nullable().default(null),
      totalFare: z.string().nullable().default(null),
      baggagePolicy: z.string().nullable().default(null),
      checkedBagPrice: z.string().nullable().default(null),
      boardingPolicy: z.string().nullable().default(null),
      mealPolicy: z.string().nullable().default(null),
      fareClass: z.string().nullable().default(null),
      preferencesMatched: z.array(z.string()).default([]),
      preferencesMissing: z.array(z.string()).default([]),
      notes: z.array(z.string()).default([]),
    })
    .nullable()
    .default(null),
  hotelOffer: z
    .object({
      propertyName: z.string().nullable().default(null),
      nightlyRate: z.string().nullable().default(null),
      totalStayPrice: z.string().nullable().default(null),
      breakfastIncluded: z.boolean().nullable().default(null),
      freeCancellation: z.boolean().nullable().default(null),
      payLaterAvailable: z.boolean().nullable().default(null),
      neighborhood: z.string().nullable().default(null),
      cancellationPolicy: z.string().nullable().default(null),
      roomType: z.string().nullable().default(null),
      preferencesMatched: z.array(z.string()).default([]),
      preferencesMissing: z.array(z.string()).default([]),
      notes: z.array(z.string()).default([]),
    })
    .nullable()
    .default(null),
  warnings: z.array(z.string()),
  quotes: z.array(z.string()),
  bookingLink: z.string().url().nullable().default(null),
});

const synthesisOutputSchema = z.object({
  cards: z.array(synthesizedCardSchema).max(5),
});

const liveCardSchema = synthesizedCardSchema.extend({
  url: z.string().url(),
  sourceKind: z.enum(["official", "partner", "guide", "forum", "social"]).default("guide"),
  coords: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .nullable()
    .default(null),
});

const liveCardResponseSchema = z.object({
  cards: z.array(liveCardSchema).max(10),
});

const agentBuckets = new Set<Bucket>(["flights", "hotels", "car-rental", "local-transport", "food-hidden-gems", "local-advice"]);

const liveSourceSchema = z.object({
  label: z.string(),
  url: z.string().url(),
  kind: z.enum(["official", "partner", "guide", "forum", "social"]),
  platform: z.string().nullable().default(null),
  credibilityGoal: z.string().nullable().default(null),
  requiresBrowser: z.boolean().default(true),
  loginRequired: z.boolean().default(false),
});

const liveSourceResponseSchema = z.object({
  overview: z.string(),
  candidates: z.array(liveSourceSchema).max(6),
});

const flightRegistrySelectionSchema = z.object({
  overview: z.string(),
  selectedSources: z.array(
    z.object({
      sourceId: z.string(),
      reason: z.string(),
    }),
  ).max(7),
});

const openaiClient = config.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: config.OPENAI_API_KEY,
    })
  : null;

const genericFlightDomains = new Set([
  "google.com",
  "google.co.uk",
  "google.com.sg",
  "skyscanner.com",
  "trip.com",
  "kayak.com",
  "momondo.com",
  "expedia.com",
  "booking.com",
]);

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function parseJsonObject<TSchema extends z.ZodTypeAny>(value: string, schema: TSchema): z.output<TSchema> | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const candidates = [trimmed];
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");

  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      return schema.parse(JSON.parse(candidate));
    } catch {
      // keep trying
    }
  }

  return null;
}

function formatFlightPreferencesForPrompt(preferences: FlightPreferences | undefined) {
  if (!preferences) {
    return "No extra flight preferences were given yet.";
  }

  const baggageMap = {
    no_bag: "no baggage needed",
    cabin_only: "cabin bag only",
    one_checked_bag: "one checked bag needed",
    two_checked_bags: "two checked bags needed",
  } as const;
  const boardingMap = {
    no_preference: "no priority boarding preference",
    priority_preferred: "priority boarding preferred",
    priority_required: "priority boarding required",
  } as const;
  const mealsMap = {
    no_preference: "no meal preference",
    meal_preferred: "meal preferred if the price still makes sense",
    meal_required: "meal required",
  } as const;
  const fareStyleMap = {
    cheapest: "optimize for the cheapest fare",
    balanced: "optimize for the best balance of price and useful extras",
    extras_included: "optimize for fares that already include the useful extras",
  } as const;
  const sellerMap = {
    any: "any seller is acceptable",
    direct_preferred: "prefer direct airline booking when the total is close",
    direct_only: "only direct airline booking is acceptable",
  } as const;

  return `Flight preferences: ${baggageMap[preferences.baggage]}; ${boardingMap[preferences.boarding]}; ${mealsMap[preferences.meals]}; ${fareStyleMap[preferences.fareStyle]}; ${sellerMap[preferences.sellerPreference]}.`;
}

function formatHotelPreferencesForPrompt(preferences: HotelPreferences | undefined) {
  if (!preferences) {
    return "No extra hotel preferences were given yet.";
  }

  const cancellationMap = {
    required: "free cancellation required",
    preferred: "free cancellation preferred",
    not_needed: "free cancellation not needed",
  } as const;
  const breakfastMap = {
    required: "breakfast required",
    preferred: "breakfast preferred",
    not_needed: "breakfast not needed",
  } as const;
  const paymentMap = {
    pay_later_preferred: "pay later preferred",
    prepay_ok: "prepay is acceptable",
    pay_at_property_preferred: "pay at property preferred",
  } as const;
  const styleMap = {
    cheapest: "optimize for cheapest stay",
    balanced: "optimize for balanced value",
    upscale: "optimize for more upscale stays",
  } as const;
  const starMap = {
    any: "any star level",
    three_plus: "3-star and above",
    four_plus: "4-star and above",
    five_star_only: "5-star only",
  } as const;

  const areaLine = preferences.areaPreference?.trim()
    ? ` area preference: ${preferences.areaPreference.trim()};`
    : "";

  return `Hotel preferences: ${cancellationMap[preferences.freeCancellation]}; ${breakfastMap[preferences.breakfast]}; ${paymentMap[preferences.payment]}; ${styleMap[preferences.style]}; ${starMap[preferences.starPreference]};${areaLine}`;
}

const bucketSignalPatterns: Record<Bucket, RegExp> = {
  flights: /\b(flight|flights|airline|airlines|airways|airfare|fare|fares|airport)\b/i,
  hotels: /\b(hotel|hotels|resort|resorts|stay|stays|accommodation|accommodations|hostel)\b/i,
  "car-rental": /\b(car rental|car hire|rental car|hire car|rent a car|vehicle rental)\b/i,
  "local-transport": /\b(boat|boats|ferry|ferries|bus|buses|train|trains|transport|timetable|schedule|shuttle|terminal|park access|route|transfer)\b/i,
  "food-hidden-gems": /\b(cafe|cafes|coffee|restaurant|restaurants|food|brunch|bakery|eatery|dessert|market|floating market|attraction|attractions|temple|museum|neighborhood|district|park|tour|shopping|mall|street|night market|elephant|elephants|sanctuary|wildlife)\b/i,
  "local-advice": /\b(advice|warning|warnings|closure|closures|weather|forum|forums|reddit|facebook|tip|tips|scam|scams)\b/i,
};

function normalizeText(value: string | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function buildLocationTerms(request: DiscoverRequest) {
  return [...new Set([request.destination, request.origin].flatMap((value) => {
    const normalized = normalizeText(value);

    if (!normalized) {
      return [];
    }

    return [normalized, ...normalized.split(" ").filter((part) => part.length >= 4)];
  }))];
}

function mentionsRequestLocation(text: string, request: DiscoverRequest) {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    return false;
  }

  return buildLocationTerms(request).some((term) => normalizedText.includes(term));
}

function regionMatchesRequest(region: string | undefined, request: DiscoverRequest) {
  const normalizedRegion = normalizeText(region);

  if (!normalizedRegion) {
    return false;
  }

  if (["global", "worldwide", "international", "anywhere"].includes(normalizedRegion)) {
    return true;
  }

  const destination = normalizeText(request.destination);

  if (!destination) {
    return false;
  }

  return destination.includes(normalizedRegion) || normalizedRegion.includes(destination);
}

function isCandidateRelevantToRequest(
  bucket: Bucket,
  request: DiscoverRequest,
  candidate: SourceCandidate,
) {
  const candidateText = [
    candidate.label,
    candidate.platform,
    candidate.url,
    candidate.credibilityGoal,
    candidate.region,
  ]
    .filter(Boolean)
    .join(" ");
  const hasBucketSignal = bucketSignalPatterns[bucket].test(candidateText);

  if (bucket === "flights") {
    return (
      (regionMatchesRequest(candidate.region, request) || mentionsRequestLocation(candidateText, request)) &&
      (hasBucketSignal || genericFlightDomains.has(candidate.domain))
    );
  }

  return (
    (regionMatchesRequest(candidate.region, request) || mentionsRequestLocation(candidateText, request)) &&
    hasBucketSignal
  );
}

function liveCardHasBucketSignal(bucket: Bucket, draft: z.infer<typeof liveCardSchema>) {
  const text = [
    draft.title,
    draft.summary,
    draft.whyItFits,
    draft.trustSummary,
    draft.sourceLabel,
    draft.url,
    draft.bookingLink,
  ]
    .filter(Boolean)
    .join(" ");

  if (bucket === "flights") {
    const hostname = new URL(draft.url).hostname.replace(/^www\./, "");
    return bucketSignalPatterns[bucket].test(text) || genericFlightDomains.has(hostname);
  }

  return bucketSignalPatterns[bucket].test(text);
}

function filterCandidatesForRequest(
  bucket: Bucket,
  request: DiscoverRequest,
  candidates: SourceCandidate[],
) {
  const byUrl = new Map<string, SourceCandidate>();

  for (const candidate of candidates) {
    if (candidate.bucket !== bucket) {
      continue;
    }

    if (!isCandidateRelevantToRequest(bucket, request, candidate)) {
      continue;
    }

    byUrl.set(candidate.url, candidate);
  }

  return [...byUrl.values()];
}

async function createWebSearchResponse(input: OpenAI.Responses.ResponseCreateParams["input"], model: string) {
  if (!openaiClient) {
    throw new Error("OpenAI client unavailable");
  }

  const modelsToTry = [model, "gpt-4.1-mini"];
  let lastError: unknown;

  for (const candidateModel of modelsToTry) {
    try {
      return await withOpenAiTimeout(
        openaiClient.responses.create({
          model: candidateModel,
          tools: [{ type: "web_search_preview", search_context_size: "medium" }],
          input,
        }),
        `createWebSearchResponse:${candidateModel}`,
        config.OPENAI_WEB_SEARCH_TIMEOUT_MS,
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function withOpenAiTimeout<T>(promise: Promise<T>, label: string, timeoutMs = config.OPENAI_STEP_TIMEOUT_MS) {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

function bucketSourcePrompt(bucket: Bucket, request: DiscoverRequest) {
  switch (bucket) {
    case "flights":
      return `Find only flight comparison or airline booking pages for a route from ${request.origin} to ${request.destination}. Prioritize Google Flights, direct airline pages, and reputable aggregators. ${formatFlightPreferencesForPrompt(request.flightPreferences)} Do not return hotel, transport, park, or attraction pages.`;
    case "hotels":
      return `Find only hotel or accommodation pages for ${request.destination} that help choose a base after attractions are chosen. Prefer Agoda, Booking.com, Google Hotels, Hotels.com, Expedia, and direct hotel pages. ${formatHotelPreferencesForPrompt(request.hotelPreferences)} Do not return flight, transport, or attraction pages.`;
    case "car-rental":
      return `Find only car rental provider pages or reputable rental comparison pages for ${request.destination}. Do not return hotel, transport, or general guide pages.`;
    case "local-transport":
      return `Find only official transport operator pages, timetable pages, boat/ferry pages, or route-planning pages for ${request.destination}. Prioritize official schedules when possible. Do not return flights, hotels, or generic attraction guides unless they are specifically about access logistics.`;
    case "food-hidden-gems":
      return `Find only specific places worth adding to an itinerary in ${request.destination}. Prioritize named cafes, markets, neighborhoods, attractions, museums, scenic areas, and tour pages that clearly name places. Prefer travel blogs, destination guides, and tour operators over generic search result pages. Do not return flight, hotel, or transport pages.`;
    case "local-advice":
      return `Find only practical warning sources for ${request.destination}, such as official closures, weather-sensitive operations, forums, or local advice threads. Do not return booking pages or generic listicles.`;
  }
}

function buildLiveSourceId(bucket: Bucket, label: string, index: number) {
  return `${bucket}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "source"}-${index + 1}`;
}

function encodeQuery(value: string) {
  return encodeURIComponent(value.trim());
}

function buildPathSegment(value: string) {
  return value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildCandidate(params: {
  id: string;
  bucket: Bucket;
  label: string;
  url: string;
  kind: SourceCandidate["kind"];
  region: string;
  platform?: string;
  credibilityGoal: string;
  requiresBrowser?: boolean;
  loginRequired?: boolean;
}) {
  return {
    id: params.id,
    bucket: params.bucket,
    label: params.label,
    platform: params.platform,
    previewImageUrl: undefined,
    domain: new URL(params.url).hostname.replace(/^www\./, ""),
    url: params.url,
    kind: params.kind,
    region: params.region,
    requiresBrowser: params.requiresBrowser ?? true,
    loginRequired: params.loginRequired ?? false,
    credibilityGoal: params.credibilityGoal,
  } satisfies SourceCandidate;
}

function mapFlightRegistryEntryToCandidate(
  entry: FlightSourceRegistryEntry,
  request: DiscoverRequest,
  reason?: string,
) {
  return buildCandidate({
    id: `flight-registry-${entry.id}`,
    bucket: "flights",
    label: `${entry.providerName} ${request.origin} to ${request.destination}`,
    url: entry.baseUrl,
    platform: entry.providerName,
    kind:
      entry.type === "official-airline" || entry.type === "budget-airline" || entry.type === "regional-airline"
        ? "official"
        : "guide",
    region: entry.regions.join(", "),
    credibilityGoal: reason ?? entry.defaultGoal,
    requiresBrowser: entry.browserRequired,
    loginRequired: entry.loginRequired,
  });
}

function requestLooksAsianRoute(request: DiscoverRequest) {
  const text = `${request.origin} ${request.destination}`.toLowerCase();
  return [
    "singapore",
    "malaysia",
    "kuching",
    "kuala lumpur",
    "jakarta",
    "bangkok",
    "taipei",
    "seoul",
    "tokyo",
    "hong kong",
    "asia",
  ].some((needle) => text.includes(needle));
}

function prefersDirectFlightSource(request: DiscoverRequest) {
  return request.flightPreferences?.sellerPreference === "direct_preferred" || request.flightPreferences?.sellerPreference === "direct_only";
}

function isAirlineFlightEntry(entry: FlightSourceRegistryEntry) {
  return entry.type === "budget-airline" || entry.type === "regional-airline" || entry.type === "official-airline";
}

function rankFlightRegistryEntry(
  entry: FlightSourceRegistryEntry,
  preferredSourceIds: Set<string>,
  request: DiscoverRequest,
) {
  const asiaRelevant = requestLooksAsianRoute(request) && entry.regions.some((region) => region.toLowerCase() === "asia");
  const directPreferred = prefersDirectFlightSource(request) && isAirlineFlightEntry(entry);

  return [
    preferredSourceIds.has(entry.id) ? 0 : 1,
    directPreferred ? 0 : 1,
    asiaRelevant ? 0 : 1,
    entry.priority,
  ] as const;
}

function pickFirstByType(
  entries: FlightSourceRegistryEntry[],
  chosen: FlightSourceRegistryEntry[],
  predicate: (entry: FlightSourceRegistryEntry) => boolean,
) {
  const found = entries.find((entry) => predicate(entry) && !chosen.some((selected) => selected.id === entry.id));

  if (found) {
    chosen.push(found);
  }
}

function pickDeterministicFlightRegistrySources(entries: FlightSourceRegistryEntry[], request: DiscoverRequest) {
  const chosen: FlightSourceRegistryEntry[] = [];
  const prefersAsia = requestLooksAsianRoute(request);
  const sortedAggregators = [...entries]
    .filter((entry) => entry.type === "aggregator")
    .sort((left, right) => {
      const leftAsia = prefersAsia && left.regions.some((region) => region.toLowerCase() === "asia");
      const rightAsia = prefersAsia && right.regions.some((region) => region.toLowerCase() === "asia");

      if (leftAsia !== rightAsia) {
        return leftAsia ? -1 : 1;
      }

      return left.priority - right.priority;
    });

  pickFirstByType(entries, chosen, (entry) => entry.type === "metasearch");

  for (const aggregator of sortedAggregators.slice(0, 3)) {
    chosen.push(aggregator);
  }

  pickFirstByType(entries, chosen, (entry) => entry.type === "budget-airline");
  pickFirstByType(entries, chosen, (entry) => entry.type === "regional-airline");
  pickFirstByType(entries, chosen, (entry) => entry.type === "official-airline");

  for (const entry of entries) {
    if (chosen.length >= 5) {
      break;
    }

    if (!chosen.some((selected) => selected.id === entry.id)) {
      chosen.push(entry);
    }
  }

  return chosen.slice(0, 5);
}

function chooseFlightRegistryCoverage(
  entries: FlightSourceRegistryEntry[],
  request: DiscoverRequest,
  preferredSelections: z.infer<typeof flightRegistrySelectionSchema>["selectedSources"] = [],
) {
  const preferredSourceIds = new Set(preferredSelections.map((selection) => selection.sourceId));
  const reasonBySourceId = new Map(preferredSelections.map((selection) => [selection.sourceId, selection.reason]));
  const ranked = [...entries].sort((left, right) => {
    const leftRank = rankFlightRegistryEntry(left, preferredSourceIds, request);
    const rightRank = rankFlightRegistryEntry(right, preferredSourceIds, request);

    return leftRank[0] - rightRank[0] || leftRank[1] - rightRank[1] || leftRank[2] - rightRank[2];
  });
  const chosen: FlightSourceRegistryEntry[] = [];

  pickFirstByType(ranked, chosen, (entry) => entry.type === "metasearch");

  for (const aggregator of ranked.filter((entry) => entry.type === "aggregator")) {
    if (chosen.filter((entry) => entry.type === "aggregator").length >= 3) {
      break;
    }

    if (!chosen.some((selected) => selected.id === aggregator.id)) {
      chosen.push(aggregator);
    }
  }

  pickFirstByType(ranked, chosen, isAirlineFlightEntry);

  for (const entry of ranked) {
    if (chosen.length >= 5) {
      break;
    }

    if (!chosen.some((selected) => selected.id === entry.id)) {
      chosen.push(entry);
    }
  }

  return chosen.slice(0, 5).map((entry) =>
    mapFlightRegistryEntryToCandidate(entry, request, reasonBySourceId.get(entry.id)),
  );
}

async function selectFlightRegistryCandidates(request: DiscoverRequest) {
  const registryEntries = await loadFlightSourceRegistry();

  if (registryEntries.length === 0) {
    return [] satisfies SourceCandidate[];
  }

  const fallbackEntries = pickDeterministicFlightRegistrySources(registryEntries, request);

  if (!openaiClient) {
    return fallbackEntries.map((entry) => mapFlightRegistryEntryToCandidate(entry, request));
  }

  try {
    const response = await withOpenAiTimeout(
      openaiClient.responses.parse({
        model: config.OPENAI_PLANNER_MODEL,
        input: [
          {
            role: "system",
            content:
              "You are selecting flight sources from a controlled registry. Pick a balanced mix for the exact route: ideally one metasearch source, three aggregators, and one direct or regional airline source. Prefer Asia-relevant providers for Asia routes. Do not invent source ids.",
          },
          {
            role: "user",
            content: JSON.stringify({
              request,
              registryEntries: registryEntries.map((entry) => ({
                id: entry.id,
                providerName: entry.providerName,
                domain: entry.domain,
                type: entry.type,
                priority: entry.priority,
                regions: entry.regions,
                routeNotes: entry.routeNotes,
              })),
            }),
          },
        ],
        text: {
          format: zodTextFormat(flightRegistrySelectionSchema, "flight_registry_selection"),
        },
      }),
      "selectFlightRegistryCandidates",
    );

    const parsed = flightRegistrySelectionSchema.parse(response.output_parsed);
    const selectedEntries = chooseFlightRegistryCoverage(registryEntries, request, parsed.selectedSources);

    if (selectedEntries.length > 0) {
      return selectedEntries;
    }
  } catch {
    // Fall back to deterministic flight source coverage below.
  }

  return fallbackEntries.map((entry) => mapFlightRegistryEntryToCandidate(entry, request));
}

function buildGenericBucketCandidates(bucket: Bucket, request: DiscoverRequest) {
  const destination = request.destination || "destination";
  const origin = request.origin || "origin";
  const encodedDestination = encodeQuery(destination);

  switch (bucket) {
    case "flights":
      return [
        buildCandidate({
          id: `generic-google-flights-${buildPathSegment(`${origin}-${destination}`) || "route"}`,
          bucket,
          label: `Google Flights ${origin} to ${destination}`,
          url: "https://www.google.com/travel/flights",
          platform: "Google Flights",
          kind: "guide",
          region: "global",
          credibilityGoal: `Check public flight fares for ${origin} to ${destination} without relying on one sponsored listing.`,
        }),
        buildCandidate({
          id: `generic-skyscanner-${buildPathSegment(`${origin}-${destination}`) || "route"}`,
          bucket,
          label: `Skyscanner ${origin} to ${destination} flights`,
          url: "https://www.skyscanner.com/",
          platform: "Skyscanner",
          kind: "guide",
          region: "global",
          credibilityGoal: `Compare aggregator flight fares for ${origin} to ${destination}.`,
        }),
        buildCandidate({
          id: `generic-kayak-${buildPathSegment(`${origin}-${destination}`) || "route"}`,
          bucket,
          label: `Kayak ${origin} to ${destination} flights`,
          url: "https://www.kayak.com/flights",
          platform: "Kayak",
          kind: "guide",
          region: "global",
          credibilityGoal: `Check another public flight comparison for ${origin} to ${destination}.`,
        }),
        buildCandidate({
          id: `generic-trip-com-${buildPathSegment(`${origin}-${destination}`) || "route"}`,
          bucket,
          label: `Trip.com ${origin} to ${destination}`,
          url: "https://www.trip.com/flights/",
          platform: "Trip.com",
          kind: "guide",
          region: "global",
          credibilityGoal: `Check an Asia-friendly aggregator view for ${origin} to ${destination}.`,
        }),
      ];
    case "hotels":
      return [
        buildCandidate({
          id: `generic-agoda-hotels-${buildPathSegment(destination) || "destination"}`,
          bucket,
          label: `Agoda hotels in ${destination}`,
          url: `https://www.agoda.com/search?city=${encodedDestination}`,
          platform: "Agoda",
          kind: "partner",
          region: "global",
          credibilityGoal: `Check hotel deals in ${destination}, especially breakfast, cancellation, and pay-later terms.`,
        }),
        buildCandidate({
          id: `generic-booking-hotels-${buildPathSegment(destination) || "destination"}`,
          bucket,
          label: `Booking.com hotels in ${destination}`,
          url: `https://www.booking.com/searchresults.html?ss=${encodedDestination}`,
          platform: "Booking.com",
          kind: "partner",
          region: "global",
          credibilityGoal: `Check hotel options in ${destination} that can be matched to the chosen attractions and filtered by cancellation and breakfast value.`,
        }),
        buildCandidate({
          id: `generic-google-hotels-${buildPathSegment(destination) || "destination"}`,
          bucket,
          label: `Google hotels in ${destination}`,
          url: "https://www.google.com/travel/hotels",
          platform: "Google Hotels",
          kind: "guide",
          region: "global",
          credibilityGoal: `Compare hotel areas and public rates in ${destination}.`,
        }),
        buildCandidate({
          id: `generic-hotels-com-${buildPathSegment(destination) || "destination"}`,
          bucket,
          label: `Hotels.com stays in ${destination}`,
          url: `https://www.hotels.com/Hotel-Search?destination=${encodedDestination}`,
          platform: "Hotels.com",
          kind: "partner",
          region: "global",
          credibilityGoal: `Check another OTA view for breakfast, cancellation, and neighborhood fit in ${destination}.`,
        }),
        buildCandidate({
          id: `generic-expedia-hotels-${buildPathSegment(destination) || "destination"}`,
          bucket,
          label: `Expedia hotels in ${destination}`,
          url: `https://www.expedia.com/Hotel-Search?destination=${encodedDestination}`,
          platform: "Expedia",
          kind: "partner",
          region: "global",
          credibilityGoal: `Compare hotel package terms and public stay rates in ${destination}.`,
        }),
      ];
    case "car-rental":
      return [
        buildCandidate({
          id: `generic-kayak-cars-${buildPathSegment(destination) || "destination"}`,
          bucket,
          label: `Kayak car rental in ${destination}`,
          url: "https://www.kayak.com/cars",
          platform: "Kayak Cars",
          kind: "guide",
          region: "global",
          credibilityGoal: `Compare public car rental options in ${destination}.`,
        }),
        buildCandidate({
          id: `generic-rentalcars-${buildPathSegment(destination) || "destination"}`,
          bucket,
          label: `Rentalcars.com in ${destination}`,
          url: "https://www.rentalcars.com/",
          platform: "Rentalcars.com",
          kind: "guide",
          region: "global",
          credibilityGoal: `Check available rental car providers for ${destination}.`,
        }),
      ];
    case "local-transport":
      return [
        buildCandidate({
          id: `generic-rome2rio-${buildPathSegment(destination) || "destination"}`,
          bucket,
          label: `${destination} transport and route planning`,
          url: `https://www.rome2rio.com/map/${buildPathSegment(destination) || "destination"}`,
          platform: "Rome2Rio",
          kind: "guide",
          region: destination,
          credibilityGoal: `Check route options, terminals, and transfer timing for ${destination}.`,
        }),
      ];
    case "food-hidden-gems":
      return [
        buildCandidate({
          id: `generic-getyourguide-${buildPathSegment(destination) || "destination"}`,
          bucket,
          label: `${destination} things to do`,
          url: `https://www.getyourguide.com/s/?q=${encodedDestination}`,
          platform: "GetYourGuide",
          kind: "guide",
          region: destination,
          credibilityGoal: `Find named attractions and tour-worthy stops in ${destination} that can anchor a real itinerary.`,
        }),
        buildCandidate({
          id: `generic-klook-${buildPathSegment(destination) || "destination"}`,
          bucket,
          label: `${destination} experiences and attractions`,
          url: `https://www.klook.com/en-SG/search/result/?query=${encodedDestination}`,
          platform: "Klook",
          kind: "guide",
          region: destination,
          credibilityGoal: `Find named attractions, neighborhoods, and bookable experiences in ${destination}.`,
        }),
        buildCandidate({
          id: `generic-viator-${buildPathSegment(destination) || "destination"}`,
          bucket,
          label: `${destination} tours and attractions`,
          url: `https://www.viator.com/searchResults/all?text=${encodedDestination}`,
          platform: "Viator",
          kind: "guide",
          region: destination,
          credibilityGoal: `Find named attractions and popular activity clusters in ${destination}.`,
        }),
        buildCandidate({
          id: `generic-lonely-planet-${buildPathSegment(destination) || "destination"}`,
          bucket,
          label: `${destination} destination guide`,
          url: `https://www.lonelyplanet.com/search?q=${encodedDestination}`,
          platform: "Lonely Planet",
          kind: "guide",
          region: destination,
          credibilityGoal: `Find destination-editorial pages that name neighborhoods, landmarks, and worthwhile stops in ${destination}.`,
          requiresBrowser: false,
        }),
      ];
    case "local-advice":
      return [
        buildCandidate({
          id: `generic-reddit-advice-${buildPathSegment(destination) || "destination"}`,
          bucket,
          label: `${destination} travel advice search`,
          url: `https://www.reddit.com/search/?q=${encodeQuery(`${destination} travel advice`)}`,
          platform: "Reddit",
          kind: "forum",
          region: destination,
          credibilityGoal: `Find repeated traveler warnings and practical local advice for ${destination}.`,
        }),
        buildCandidate({
          id: `generic-tripadvisor-forum-${buildPathSegment(destination) || "destination"}`,
          bucket,
          label: `${destination} travel forum search`,
          url: `https://www.tripadvisor.com/Search?q=${encodeQuery(`${destination} forum`)}`,
          platform: "Tripadvisor",
          kind: "forum",
          region: destination,
          credibilityGoal: `Find practical warnings, closures, and local planning tips for ${destination}.`,
        }),
      ];
    default:
      return [] satisfies SourceCandidate[];
  }
}

function buildPromptAwareCandidates(bucket: Bucket, request: DiscoverRequest) {
  const prompt = `${request.prompt} ${request.destination}`.toLowerCase();

  if (bucket === "food-hidden-gems" && request.destination.toLowerCase().includes("bangkok")) {
    const themedCandidates: SourceCandidate[] = [];

    if (/\belephant|sanctuary|wildlife\b/i.test(prompt)) {
      themedCandidates.push(
        buildCandidate({
          id: "bangkok-elephant-klook",
          bucket,
          label: "Bangkok elephant sanctuary experiences",
          url: "https://www.klook.com/en-SG/search/result/?query=Bangkok%20elephant%20sanctuary",
          platform: "Klook",
          kind: "guide",
          region: "Bangkok",
          credibilityGoal: "Find named elephant sanctuaries or ethical elephant experiences near Bangkok that can anchor the itinerary.",
        }),
        buildCandidate({
          id: "bangkok-elephant-getyourguide",
          bucket,
          label: "Bangkok elephant day trips and sanctuaries",
          url: "https://www.getyourguide.com/s/?q=Bangkok%20elephant%20sanctuary",
          platform: "GetYourGuide",
          kind: "guide",
          region: "Bangkok",
          credibilityGoal: "Find named elephant sanctuaries or day trips commonly chosen from Bangkok.",
        }),
      );
    }

    if (/\bfloating market|market\b/i.test(prompt)) {
      themedCandidates.push(
        buildCandidate({
          id: "bangkok-floating-market-klook",
          bucket,
          label: "Bangkok floating markets",
          url: "https://www.klook.com/en-SG/search/result/?query=Bangkok%20floating%20market",
          platform: "Klook",
          kind: "guide",
          region: "Bangkok",
          credibilityGoal: "Find named floating markets near Bangkok that travelers actually visit on short trips.",
        }),
        buildCandidate({
          id: "bangkok-floating-market-viator",
          bucket,
          label: "Bangkok floating market tours",
          url: "https://www.viator.com/searchResults/all?text=Bangkok%20floating%20market",
          platform: "Viator",
          kind: "guide",
          region: "Bangkok",
          credibilityGoal: "Find named floating markets and the common transfer patterns from Bangkok.",
        }),
      );
    }

    if (/\bpad thai|street food|food|eat\b/i.test(prompt)) {
      themedCandidates.push(
        buildCandidate({
          id: "bangkok-pad-thai-lonely-planet",
          bucket,
          label: "Bangkok street food and pad thai picks",
          url: "https://www.lonelyplanet.com/search?q=Bangkok%20pad%20thai",
          platform: "Lonely Planet",
          kind: "guide",
          region: "Bangkok",
          credibilityGoal: "Find named Bangkok food stops or neighborhoods known for strong pad thai and street food.",
          requiresBrowser: false,
        }),
        buildCandidate({
          id: "bangkok-pad-thai-tripadvisor",
          bucket,
          label: "Bangkok pad thai restaurants",
          url: "https://www.tripadvisor.com/Search?q=Bangkok%20pad%20thai",
          platform: "Tripadvisor",
          kind: "guide",
          region: "Bangkok",
          credibilityGoal: "Find named Bangkok restaurants or neighborhoods that repeatedly surface for pad thai.",
        }),
      );
    }

    if (themedCandidates.length > 0) {
      return themedCandidates;
    }
  }

  if (prompt.includes("bako") && prompt.includes("kuching")) {
    if (bucket === "local-transport") {
      return [
        buildCandidate({
          id: "kuching-bako-official-access",
          bucket,
          label: "Sarawak Forestry Bako park access and boat information",
          url: "https://sarawakforestry.com/parks-and-reserves/bako-national-park/",
          platform: "Sarawak Forestry",
          kind: "official",
          region: "Kuching",
          credibilityGoal: "Use the official Bako National Park access page for boat, ticketing, and terminal logistics.",
          requiresBrowser: false,
        }),
        buildCandidate({
          id: "kuching-bako-rome2rio",
          bucket,
          label: "Kuching to Bako National Park route planning",
          url: "https://www.rome2rio.com/map/Kuching/Bako-National-Park",
          platform: "Rome2Rio",
          kind: "guide",
          region: "Kuching",
          credibilityGoal: "Cross-check transfer flow from Kuching to Bako National Park.",
        }),
      ];
    }

    if (bucket === "local-advice") {
      return [
        buildCandidate({
          id: "kuching-bako-reddit-advice",
          bucket,
          label: "Kuching and Bako travel advice search",
          url: "https://www.reddit.com/search/?q=Kuching%20Bako%20travel%20advice",
          platform: "Reddit",
          kind: "forum",
          region: "Kuching",
          credibilityGoal: "Look for repeated advice on Bako timing, weather, and practical transport caveats.",
        }),
      ];
    }
  }

  return [] satisfies SourceCandidate[];
}

function classifyFlightCandidate(candidate: SourceCandidate) {
  const platform = (candidate.platform ?? "").toLowerCase();
  const domain = candidate.domain.toLowerCase();
  const label = candidate.label.toLowerCase();

  if (
    platform.includes("google flights") ||
    platform.includes("google travel") ||
    domain.includes("google.com")
  ) {
    return "metasearch" as const;
  }

  if (
    platform.includes("skyscanner") ||
    platform.includes("kayak") ||
    platform.includes("trip.com") ||
    platform.includes("trip com") ||
    domain.includes("skyscanner") ||
    domain.includes("kayak") ||
    domain.includes("trip.com")
  ) {
    return "aggregator" as const;
  }

  if (
    candidate.kind === "official" ||
    platform.includes("airline") ||
    platform.includes("airasia") ||
    platform.includes("scoot") ||
    platform.includes("malaysia airlines") ||
    label.includes("airasia") ||
    label.includes("scoot") ||
    label.includes("airline")
  ) {
    return "airline" as const;
  }

  return "other" as const;
}

function rankFlightCandidate(candidate: SourceCandidate) {
  const platform = (candidate.platform ?? "").toLowerCase();

  if (platform.includes("google flights")) {
    return 0;
  }

  if (platform.includes("skyscanner")) {
    return 1;
  }

  if (platform.includes("trip.com") || platform.includes("trip com")) {
    return 2;
  }

  if (platform.includes("kayak")) {
    return 3;
  }

  if (platform.includes("scoot")) {
    return 4;
  }

  if (platform.includes("airasia")) {
    return 5;
  }

  if (platform.includes("malaysia airlines")) {
    return 6;
  }

  return 20;
}

function pickFlightPlanningCandidates(candidates: SourceCandidate[]) {
  const ranked = [...candidates].sort((left, right) => rankFlightCandidate(left) - rankFlightCandidate(right));
  const chosen: SourceCandidate[] = [];
  const addFirst = (predicate: (candidate: SourceCandidate) => boolean) => {
    const found = ranked.find((candidate) => predicate(candidate) && !chosen.some((selected) => selected.url === candidate.url));

    if (found) {
      chosen.push(found);
    }
  };

  addFirst((candidate) => classifyFlightCandidate(candidate) === "metasearch");

  for (const candidate of ranked.filter((entry) => classifyFlightCandidate(entry) === "aggregator")) {
    if (chosen.filter((entry) => classifyFlightCandidate(entry) === "aggregator").length >= 3) {
      break;
    }

    if (!chosen.some((selected) => selected.url === candidate.url)) {
      chosen.push(candidate);
    }
  }

  addFirst((candidate) => classifyFlightCandidate(candidate) === "airline");

  for (const candidate of ranked) {
    if (chosen.length >= 5) {
      break;
    }

    if (!chosen.some((selected) => selected.url === candidate.url)) {
      chosen.push(candidate);
    }
  }

  return chosen.slice(0, 5);
}

function normalizeFlightPlan(
  candidates: SourceCandidate[],
  request: DiscoverRequest,
  plan?: z.infer<typeof plannerOutputSchema>,
): z.infer<typeof plannerOutputSchema> {
  const selectedCandidates = [...pickFlightPlanningCandidates(candidates)]
    .sort((left, right) => {
      const leftDirectScore = prefersDirectFlightSource(request) && classifyFlightCandidate(left) === "airline" ? 0 : 1;
      const rightDirectScore = prefersDirectFlightSource(request) && classifyFlightCandidate(right) === "airline" ? 0 : 1;

      return leftDirectScore - rightDirectScore || rankFlightCandidate(left) - rankFlightCandidate(right);
    })
    .slice(0, 5);
  const jobBySourceId = new Map((plan?.jobs ?? []).map((job) => [job.sourceId, job]));

  return {
    overview:
      plan?.overview ??
      `Compare one metasearch anchor, several aggregators, and one direct airline so sponsored ordering does not control the answer. ${formatFlightPreferencesForPrompt(request.flightPreferences)}`,
    jobs: selectedCandidates.map((candidate, index) => {
      const existingJob = jobBySourceId.get(candidate.id);

      return {
        cardId: existingJob?.cardId ?? `flights-agent-${index + 1}`,
        sourceId: candidate.id,
        goal:
          existingJob?.goal ??
          "Find the lowest clearly visible public fare, note the airline or seller, and capture any baggage or sponsored-listing caveat.",
        titleHint: existingJob?.titleHint ?? "Public fare comparison",
        browserProfile: existingJob?.browserProfile ?? (candidate.loginRequired ? "stealth" : "lite"),
        proxyCountry: existingJob?.proxyCountry ?? null,
      };
    }),
  };
}

export async function discoverLiveSources(
  bucket: Bucket,
  request: DiscoverRequest,
  registryCandidates: SourceCandidate[],
) {
  const filteredRegistryCandidates = filterCandidatesForRequest(bucket, request, registryCandidates);
  const flightRegistryCandidates =
    bucket === "flights" ? await selectFlightRegistryCandidates(request) : ([] as SourceCandidate[]);
  const genericCandidates = filterCandidatesForRequest(bucket, request, buildGenericBucketCandidates(bucket, request));
  const promptAwareCandidates = filterCandidatesForRequest(bucket, request, buildPromptAwareCandidates(bucket, request));
  const byUrl = new Map<string, SourceCandidate>();

  for (const candidate of [
    ...genericCandidates,
    ...filteredRegistryCandidates,
    ...flightRegistryCandidates,
    ...promptAwareCandidates,
  ]) {
    byUrl.set(candidate.url, candidate);
  }

  if (!openaiClient) {
    return [...byUrl.values()];
  }

  try {
    const response = await createWebSearchResponse(
      [
        {
          role: "system",
          content:
            "Find targeted travel source pages for the exact trip request. Prefer exact pages over homepage-only results. Stay inside the requested bucket: flights must return flight pages, hotels must return hotel pages, transport must return access or schedule pages, and hidden gems must return named places. Return JSON only.",
        },
        {
          role: "user",
          content: JSON.stringify({
            bucket,
            request,
            guidance: bucketSourcePrompt(bucket, request),
            output: {
              overview: "one sentence summary",
              candidates: [
                {
                  label: "source label",
                  url: "exact URL",
                  kind: "official | partner | guide | forum | social",
                  platform: "optional platform",
                  credibilityGoal: "why this source helps",
                  requiresBrowser: true,
                  loginRequired: false,
                },
              ],
            },
          }),
        },
      ],
      config.OPENAI_PLANNER_MODEL,
    );

    const parsed = liveSourceResponseSchema.parse(JSON.parse(response.output_text));

    const normalizedCandidates = parsed.candidates.map((candidate, index) => {
      const hostname = new URL(candidate.url).hostname.replace(/^www\./, "");

      return {
        id: buildLiveSourceId(bucket, candidate.label, index),
        bucket,
        label: candidate.label,
        platform: candidate.platform ?? undefined,
        previewImageUrl: undefined,
        domain: hostname,
        url: candidate.url,
        kind: candidate.kind,
        region: request.destination || "global",
        requiresBrowser: candidate.requiresBrowser,
        loginRequired: candidate.loginRequired,
        credibilityGoal: candidate.credibilityGoal ?? undefined,
      } satisfies SourceCandidate;
    });

    for (const candidate of filterCandidatesForRequest(bucket, request, normalizedCandidates)) {
      byUrl.set(candidate.url, candidate);
    }
  } catch {
    // Keep destination-matching registry candidates only and continue with any extra bucket logic below.
  }

  return [...byUrl.values()];
}

function fallbackPlan(
  bucket: Bucket,
  request: DiscoverRequest,
  candidates: SourceCandidate[],
): z.infer<typeof plannerOutputSchema> {
  if (bucket === "flights") {
    return normalizeFlightPlan(candidates, request);
  }

  const kindPriority: Record<SourceCandidate["kind"], number> =
    bucket === "food-hidden-gems"
      ? { social: 0, guide: 1, forum: 2, official: 3, partner: 4 }
      : { official: 0, forum: 1, social: 2, guide: 3, partner: 4 };

  const preferred = [...candidates]
    .sort((left, right) => kindPriority[left.kind] - kindPriority[right.kind])
    .slice(0, 3);

  return {
    overview:
      bucket === "local-transport"
        ? "Use a small mix of official access pages and route planners so transport timing is grounded in something concrete."
        : bucket === "hotels"
          ? "Use a small mix of Agoda, OTA comparisons, and direct hotel pages so the base choice reflects location, cancellation terms, and breakfast value."
        : bucket === "car-rental"
          ? "Use a small mix of rental providers and comparison pages so car options can be checked against the actual route."
        : bucket === "food-hidden-gems"
          ? "Use a small mix of travel blogs, destination guides, and tour operators so places still have concrete context."
          : "Use a small mix of practical sources so warnings are easier to cross-check.",
    jobs: preferred.map((candidate, index) => ({
      cardId: `${bucket}-agent-${index + 1}`,
      sourceId: candidate.id,
      titleHint:
        bucket === "local-transport"
          ? "Transport route detail"
          : bucket === "hotels"
            ? "Hotel base option"
          : bucket === "car-rental"
            ? "Car rental option"
            : bucket === "food-hidden-gems"
              ? "Local hidden gem"
              : "Local planning advice",
      goal:
        bucket === "local-transport"
          ? "Find the specific route or access detail, the key timing information, and one practical warning or limitation."
          : bucket === "hotels"
            ? "Find one usable hotel base, visible nightly rate, cancellation or breakfast terms, neighborhood fit, and one tradeoff that matters."
          : bucket === "car-rental"
            ? "Find one usable rental option, visible pickup context, and one cost or policy warning that matters in trip planning."
            : bucket === "food-hidden-gems"
              ? "Find one specific hidden-gem cafe or food stop, why locals like it, what area it is in, and any useful warning."
              : "Find one practical warning or tip that locals repeat, and explain when it matters in real trip planning.",
      browserProfile: candidate.loginRequired ? ("stealth" as const) : ("lite" as const),
      proxyCountry: null,
    })),
  };
}

function fallbackSynthesis(
  bucket: Bucket,
  jobs: ExtractionJob[],
  results: ExtractionResult[],
  candidates: SourceCandidate[],
): z.infer<typeof synthesisOutputSchema> {
  return {
    cards: results.map((result, index) => {
      const job = jobs.find((entry) => entry.id === result.jobId);
      const source = candidates.find((candidate) => candidate.id === job?.sourceId);
      const trustTag =
        bucket === "flights"
          ? "Verified Partner"
          : bucket === "hotels"
            ? "Official Stay"
          : bucket === "local-transport"
            ? "Official Schedule"
            : bucket === "car-rental"
              ? "Verified Partner"
          : bucket === "food-hidden-gems"
            ? "Hidden Gem"
            : "Local Advice";
      const titleBase =
        bucket === "flights"
          ? `Public fare snapshot ${index + 1}`
          : bucket === "hotels"
            ? source?.label ?? `Hotel base option ${index + 1}`
          : bucket === "local-transport"
            ? `Transport option ${index + 1}`
            : bucket === "car-rental"
              ? `Car rental option ${index + 1}`
          : bucket === "food-hidden-gems"
            ? source?.label ?? `Hidden gem idea ${index + 1}`
            : `Local advice ${index + 1}`;

      return {
        title: titleBase,
        summary: result.sourceSummary ?? result.quote,
        whyItFits:
          bucket === "flights"
            ? "Useful as a public price anchor before choosing where to book."
            : bucket === "hotels"
              ? "Useful for comparing whether the hotel base actually fits the pinned places and stay terms you care about."
            : bucket === "local-transport"
              ? "Useful for shaping the route before locking the hotel and flight."
              : bucket === "car-rental"
                ? "Useful for checking whether a rental car actually helps the chosen route."
            : bucket === "food-hidden-gems"
              ? "Good for adding one quieter stop after you lock your base and transport."
              : "Helpful as a reality check before you commit the daily plan.",
        trustTag,
        trustSummary:
          result.credibilitySignals[0] ?? "Built from a hard-to-crawl source and rechecked with more stable context.",
        credibilityNotes: result.credibilitySignals,
        sourceLabel: source?.label ?? job?.domain ?? "Social source",
        recommendedDurationMinutes: bucket === "flights" ? 45 : bucket === "hotels" ? 30 : bucket === "local-transport" ? 60 : 75,
        touristPrice: bucket === "flights" || bucket === "car-rental" || bucket === "hotels" ? result.details[0] ?? null : null,
        localPrice: bucket === "flights" || bucket === "car-rental" || bucket === "hotels" ? result.details[1] ?? null : null,
        flightOffer: bucket === "flights" ? result.flightObservation ?? null : null,
        hotelOffer: bucket === "hotels" ? result.hotelObservation ?? null : null,
        warnings: result.warning ? [result.warning] : [],
        quotes: [result.quote],
        bookingLink: source?.url ?? null,
      };
    }),
  };
}

function mapToCards(
  bucket: Bucket,
  drafts: z.infer<typeof synthesizedCardSchema>[],
  jobs: ExtractionJob[],
  candidates: SourceCandidate[],
) {
  return drafts.map((draft, index) => {
    const job = jobs[index];
    const source = candidates.find((candidate) => candidate.id === job?.sourceId);

    return {
      id: job?.cardId ?? `${bucket}-agent-${index + 1}`,
      bucket,
      title: draft.title,
      summary: draft.summary,
      whyItFits: draft.whyItFits,
      imageUrls: source?.previewImageUrl ? [source.previewImageUrl] : [],
      trustTag: draft.trustTag,
      trustSummary: draft.trustSummary,
      credibilityNotes: draft.credibilityNotes,
      verificationState: "live" as const,
      sourceLabel: draft.sourceLabel,
      recommendedDurationMinutes: draft.recommendedDurationMinutes,
      priceSummary:
        draft.touristPrice && draft.localPrice
          ? {
              touristPrice: draft.touristPrice,
              localPrice: draft.localPrice,
            }
          : draft.flightOffer?.baseFare && draft.flightOffer?.totalFare
            ? {
                touristPrice: draft.flightOffer.baseFare,
                localPrice: draft.flightOffer.totalFare,
              }
            : draft.hotelOffer?.nightlyRate
              ? {
                  touristPrice: draft.hotelOffer.nightlyRate,
                  localPrice: draft.hotelOffer.totalStayPrice ?? "Check the stay terms on the provider page.",
                }
            : undefined,
      flightOffer: draft.flightOffer ?? undefined,
      hotelOffer: draft.hotelOffer ?? undefined,
      warnings: draft.warnings,
      quotes: draft.quotes,
      bookingLink: draft.bookingLink ?? source?.url,
      provenance: [
        {
          label: source?.label ?? draft.sourceLabel,
          url: source?.url ?? draft.bookingLink ?? "https://example.com/",
          kind: source?.kind ?? "guide",
          lastChecked: new Date().toISOString(),
          note: source?.credibilityGoal ?? "Agent-generated discovery from public web content.",
        },
      ],
    } satisfies DiscoveryCard;
  });
}

function mapLiveCards(
  bucket: Bucket,
  drafts: z.infer<typeof liveCardSchema>[],
  candidates: SourceCandidate[],
): DiscoveryCard[] {
  return drafts.map((draft, index) => {
    const matchedCandidate = candidates.find(
      (candidate) => candidate.url === draft.url || candidate.url === draft.bookingLink,
    );

    return {
      id: `${bucket}-live-${index + 1}-${draft.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`,
      bucket,
      title: draft.title,
      summary: draft.summary,
      whyItFits: draft.whyItFits,
      imageUrls: matchedCandidate?.previewImageUrl ? [matchedCandidate.previewImageUrl] : [],
      trustTag: draft.trustTag,
      trustSummary: draft.trustSummary,
      credibilityNotes: draft.credibilityNotes,
      verificationState: "live",
      sourceLabel: draft.sourceLabel,
      recommendedDurationMinutes: draft.recommendedDurationMinutes,
      priceSummary:
        draft.touristPrice && draft.localPrice
          ? {
              touristPrice: draft.touristPrice,
              localPrice: draft.localPrice,
            }
          : draft.hotelOffer?.nightlyRate
            ? {
                touristPrice: draft.hotelOffer.nightlyRate,
                localPrice: draft.hotelOffer.totalStayPrice ?? "Check the stay terms on the provider page.",
              }
          : undefined,
      hotelOffer: draft.hotelOffer ?? undefined,
      coords: draft.coords ?? undefined,
      warnings: draft.warnings,
      quotes: draft.quotes,
      bookingLink: draft.bookingLink ?? draft.url,
      provenance: [
        {
          label: draft.sourceLabel,
          url: draft.url,
          kind: draft.sourceKind,
          lastChecked: new Date().toISOString(),
          note: "Live card synthesized from current web search results.",
        },
      ],
    };
  });
}

function fallbackLiveCards(bucket: Bucket, request: DiscoverRequest, candidates: SourceCandidate[]) {
  const relevantCandidates = filterCandidatesForRequest(bucket, request, candidates)
    .filter((candidate) => keepAsFallbackCandidate(bucket, candidate))
    .slice(0, bucket === "hotels" ? 2 : 3);

  if (relevantCandidates.length === 0) {
    return [] as DiscoveryCard[];
  }

  return relevantCandidates.map((candidate, index) => {
    const trustTag: DiscoveryCard["trustTag"] =
      bucket === "hotels" ? "Official Stay" : bucket === "local-advice" ? "Local Advice" : "Verified Partner";

    return {
      id: `${bucket}-fallback-live-${index + 1}`,
      bucket,
      title:
        bucket === "hotels"
          ? `${request.destination} stay option ${index + 1}`
          : candidate.label,
      summary:
        bucket === "hotels"
          ? `${candidate.platform ?? candidate.label}: a usable base option near the requested area.`
          : `${candidate.platform ?? candidate.label}: a usable live source for ${bucket.replace("-", " ")}.`,
      whyItFits:
        bucket === "hotels"
          ? "Useful as a base once the places are pinned, so the stay fits the route instead of fighting it."
          : bucket === "car-rental"
            ? "Useful for comparing practical logistics after the route is clearer."
            : "Useful as a concrete fallback when live synthesis is incomplete.",
      imageUrls: candidate.previewImageUrl ? [candidate.previewImageUrl] : [],
      trustTag,
      trustSummary:
        candidate.kind === "official"
          ? "Direct provider or official source."
          : candidate.kind === "social"
            ? "Social source kept only as a place lead, not as the only source of critical logistics."
            : "Usable public source kept as a fallback while live synthesis is sparse.",
      credibilityNotes: [candidate.credibilityGoal ?? "Fallback card built from a destination-matching source candidate."],
      verificationState: "live",
      sourceLabel: candidate.label,
      recommendedDurationMinutes: bucket === "hotels" ? 30 : 60,
      priceSummary:
        bucket === "hotels"
          ? {
              touristPrice: "Check the current nightly rate on the provider page.",
              localPrice: "Compare location fit before optimizing for headline price alone.",
            }
          : undefined,
      warnings: [],
      quotes: [],
      bookingLink: candidate.url,
      provenance: [
        {
          label: candidate.label,
          url: candidate.url,
          kind: candidate.kind,
          lastChecked: new Date().toISOString(),
          note: candidate.credibilityGoal ?? "Destination-matching fallback source.",
        },
      ],
    } satisfies DiscoveryCard;
  });
}

function isGenericHiddenGemLabel(value: string) {
  return /\b(search|reviews?|review|map|maps|tripadvisor|google maps|food map|cafe reviews?)\b/i.test(value);
}

function hasNamedPlaceSignal(value: string) {
  return !isGenericHiddenGemLabel(value) && value.trim().length > 0;
}

function keepAsFallbackCandidate(bucket: Bucket, candidate: SourceCandidate) {
  if (bucket !== "food-hidden-gems") {
    return true;
  }

  if (candidate.kind === "social") {
    return true;
  }

  return hasNamedPlaceSignal(candidate.label);
}

function keepAsLiveHiddenGemCard(draft: z.infer<typeof liveCardSchema>) {
  const combined = [draft.title, draft.sourceLabel, draft.summary, draft.bookingLink, draft.url].filter(Boolean).join(" ");

  if (isGenericHiddenGemLabel(combined)) {
    return false;
  }

  return true;
}

function foodHiddenGemLooksSpecific(draft: z.infer<typeof liveCardSchema>) {
  const combined = [draft.title, draft.sourceLabel, draft.summary].filter(Boolean).join(" ");

  if (!keepAsLiveHiddenGemCard(draft)) {
    return false;
  }

  return combined.trim().length >= 12;
}

function buildBangkokDemoPlaceFallbacks(request: DiscoverRequest) {
  const prompt = request.prompt.toLowerCase();
  const cards: z.infer<typeof liveCardSchema>[] = [];

  if (/elephant|elephants|sanctuary|wildlife/.test(prompt)) {
    cards.push({
      title: "Living Green Elephant Sanctuary",
      summary: "Popular elephant sanctuary day trip from Bangkok with hands-on feeding and river time instead of a generic animal stop.",
      whyItFits: "Good anchor activity if the trip needs one standout day beyond central Bangkok.",
      trustTag: "Hidden Gem",
      trustSummary: "Commonly surfaced across Bangkok activity listings and day-trip guides.",
      credibilityNotes: ["Strong demo fallback for elephant-focused Bangkok requests."],
      sourceLabel: "Klook elephant sanctuary listings",
      url: "https://www.klook.com/en-SG/search/result/?query=Bangkok%20elephant%20sanctuary",
      sourceKind: "guide",
      recommendedDurationMinutes: 360,
      touristPrice: "Day-trip pricing varies by transfer option",
      localPrice: null,
      flightOffer: null,
      hotelOffer: null,
      warnings: ["Choose sanctuary-style experiences and avoid exploitative elephant rides for the demo flow."],
      quotes: ["Useful as the main wildlife-style stop for a short Bangkok trip."],
      bookingLink: "https://www.klook.com/en-SG/search/result/?query=Bangkok%20elephant%20sanctuary",
      coords: { lat: 13.3615, lng: 101.0047 },
    });
  }

  if (/floating market|market/.test(prompt)) {
    cards.push({
      title: "Bang Nam Phueng Floating Market",
      summary: "Easy floating-market style stop with food, snacks, and a greener setting than the bigger tourist-heavy options.",
      whyItFits: "Works well when the user wants a market experience without turning the whole trip into a long day trip.",
      trustTag: "Hidden Gem",
      trustSummary: "Regularly named in Bangkok market roundups and short-trip recommendations.",
      credibilityNotes: ["Good demo fallback for floating-market intent near Bangkok."],
      sourceLabel: "Viator floating market listings",
      url: "https://www.viator.com/searchResults/all?text=Bangkok%20floating%20market",
      sourceKind: "guide",
      recommendedDurationMinutes: 150,
      touristPrice: "Entry is usually minimal; food spending varies",
      localPrice: null,
      flightOffer: null,
      hotelOffer: null,
      warnings: ["Best on weekend-style timings; opening patterns can shift."],
      quotes: ["A softer market stop than the most commercial floating-market tours."],
      bookingLink: "https://www.viator.com/searchResults/all?text=Bangkok%20floating%20market",
      coords: { lat: 13.6798, lng: 100.5634 },
    });
  }

  if (/pad thai|street food|food|eat/.test(prompt)) {
    cards.push(
      {
        title: "Thipsamai Pad Thai",
        summary: "One of the most famous pad thai stops in Bangkok and an easy flagship food stop for a short first-time trip.",
        whyItFits: "Matches a direct pad thai request and is easy to understand in a demo.",
        trustTag: "Hidden Gem",
        trustSummary: "Widely referenced in Bangkok food guides and traveler shortlists.",
        credibilityNotes: ["Fast, concrete fallback for pad-thai intent."],
        sourceLabel: "Bangkok street food and pad thai picks",
        url: "https://www.lonelyplanet.com/search?q=Bangkok%20pad%20thai",
        sourceKind: "guide",
        recommendedDurationMinutes: 75,
        touristPrice: "Expect popular-signature pricing rather than the cheapest street stall rate",
        localPrice: null,
        flightOffer: null,
        hotelOffer: null,
        warnings: ["Queues are common around peak meal hours."],
        quotes: ["Useful as the obvious pad thai anchor in a short Bangkok itinerary."],
        bookingLink: "https://www.lonelyplanet.com/search?q=Bangkok%20pad%20thai",
        coords: { lat: 13.7533, lng: 100.5031 },
      },
      {
        title: "Yaowarat Road",
        summary: "Bangkok’s most famous street-food stretch if the user wants a broader food crawl beyond one restaurant.",
        whyItFits: "Good second food stop if the trip should include one evening food district.",
        trustTag: "Hidden Gem",
        trustSummary: "Consistently cited across Bangkok food guides and trip roundups.",
        credibilityNotes: ["Reliable fallback for food-first Bangkok prompts."],
        sourceLabel: "Bangkok street food and pad thai picks",
        url: "https://www.tripadvisor.com/Search?q=Bangkok%20pad%20thai",
        sourceKind: "guide",
        recommendedDurationMinutes: 120,
        touristPrice: "Food spend varies by stall and appetite",
        localPrice: null,
        flightOffer: null,
        hotelOffer: null,
        warnings: ["Best as an evening stop; it can feel too hot and flat earlier in the day."],
        quotes: ["Useful if the trip should include one bigger night-food district."],
        bookingLink: "https://www.tripadvisor.com/Search?q=Bangkok%20pad%20thai",
        coords: { lat: 13.7396, lng: 100.5103 },
      },
    );
  }

  const genericBangkokAnchors: z.infer<typeof liveCardSchema>[] = [
    {
      title: "The Grand Palace",
      summary: "Bangkok’s most famous landmark and an easy anchor attraction for a first-time short trip.",
      whyItFits: "Gives the itinerary one obvious cultural stop if the trip should not be only food-focused.",
      trustTag: "Hidden Gem",
      trustSummary: "Consistently named across Bangkok attraction guides and short-trip itineraries.",
      credibilityNotes: ["Strong default Bangkok anchor attraction."],
      sourceLabel: "Bangkok attraction guides",
      url: "https://www.getyourguide.com/s/?q=The%20Grand%20Palace%20Bangkok",
      sourceKind: "guide",
      recommendedDurationMinutes: 120,
      touristPrice: "Ticket pricing varies by official policy and package",
      localPrice: null,
      flightOffer: null,
      hotelOffer: null,
      warnings: ["Dress rules are stricter than at many other Bangkok stops."],
      quotes: ["Useful as the classic daytime culture anchor."],
      bookingLink: "https://www.getyourguide.com/s/?q=The%20Grand%20Palace%20Bangkok",
      coords: { lat: 13.7500, lng: 100.4913 },
    },
    {
      title: "Wat Pho",
      summary: "Easy cultural stop near the old-city core and a simple pairing with the Grand Palace area.",
      whyItFits: "Works well when the trip needs a recognizable temple stop without adding much complexity.",
      trustTag: "Hidden Gem",
      trustSummary: "Regularly paired with old-city Bangkok routes in guide content.",
      credibilityNotes: ["Reliable second old-city stop."],
      sourceLabel: "Bangkok attraction guides",
      url: "https://www.klook.com/en-SG/search/result/?query=Wat%20Pho%20Bangkok",
      sourceKind: "guide",
      recommendedDurationMinutes: 90,
      touristPrice: "Official entry pricing varies",
      localPrice: null,
      flightOffer: null,
      hotelOffer: null,
      warnings: ["Old-city heat and walking time can add up by midday."],
      quotes: ["Useful as a nearby follow-up after the palace area."],
      bookingLink: "https://www.klook.com/en-SG/search/result/?query=Wat%20Pho%20Bangkok",
      coords: { lat: 13.7465, lng: 100.4930 },
    },
    {
      title: "ICONSIAM",
      summary: "Modern riverside stop with easy air-con downtime, food options, and a simple evening handoff.",
      whyItFits: "Useful when the trip needs one comfortable modern stop between outdoor attractions and food.",
      trustTag: "Hidden Gem",
      trustSummary: "Frequently used as a practical Bangkok anchor in modern-city itineraries.",
      credibilityNotes: ["Useful fallback for a weather-safe Bangkok stop."],
      sourceLabel: "Bangkok attraction guides",
      url: "https://www.tripadvisor.com/Search?q=ICONSIAM%20Bangkok",
      sourceKind: "guide",
      recommendedDurationMinutes: 120,
      touristPrice: "Spending depends on shopping and dining choices",
      localPrice: null,
      flightOffer: null,
      hotelOffer: null,
      warnings: ["Less useful if the user wants only traditional old-city Bangkok."],
      quotes: ["Good weather-safe riverside stop for a short trip."],
      bookingLink: "https://www.tripadvisor.com/Search?q=ICONSIAM%20Bangkok",
      coords: { lat: 13.7269, lng: 100.5105 },
    },
    {
      title: "Talat Noi",
      summary: "Creative old neighborhood with cafes, street scenes, and photo-friendly side streets near Chinatown.",
      whyItFits: "Useful if the trip should mix food with a walkable neighborhood stop.",
      trustTag: "Hidden Gem",
      trustSummary: "Regularly named in Bangkok neighborhood and cafe roundups.",
      credibilityNotes: ["Good softer neighborhood anchor."],
      sourceLabel: "Bangkok neighborhood guides",
      url: "https://www.lonelyplanet.com/search?q=Talat%20Noi%20Bangkok",
      sourceKind: "guide",
      recommendedDurationMinutes: 90,
      touristPrice: "Mostly pay-as-you-go food and cafe spending",
      localPrice: null,
      flightOffer: null,
      hotelOffer: null,
      warnings: ["Better with some flexible wandering time than a strict timed stop."],
      quotes: ["Good for a lighter urban walk between big-ticket attractions."],
      bookingLink: "https://www.lonelyplanet.com/search?q=Talat%20Noi%20Bangkok",
      coords: { lat: 13.7349, lng: 100.5132 },
    },
  ];

  for (const anchor of genericBangkokAnchors) {
    if (cards.length >= 8) {
      break;
    }

    if (!cards.some((existing) => existing.title === anchor.title)) {
      cards.push(anchor);
    }
  }

  return cards.slice(0, 8);
}

function demoPlaceFallbackCards(request: DiscoverRequest) {
  if (request.destination.toLowerCase().includes("bangkok")) {
    return buildBangkokDemoPlaceFallbacks(request);
  }

  return [] as z.infer<typeof liveCardSchema>[];
}

function mergePlaceFallbackCards(
  liveCards: z.infer<typeof liveCardSchema>[],
  fallbackCards: z.infer<typeof liveCardSchema>[],
  limit = 8,
) {
  const seen = new Set<string>();
  const merged: z.infer<typeof liveCardSchema>[] = [];

  for (const card of [...liveCards, ...fallbackCards]) {
    const key = `${card.title}|${card.url}`.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(card);

    if (merged.length >= limit) {
      break;
    }
  }

  return merged;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function synthesizeNamedPlaceCards(
  request: DiscoverRequest,
  candidateHints: SourceCandidate[],
) {
  const demoFallbackCards = demoPlaceFallbackCards(request);

  if (demoFallbackCards.length > 0) {
    await sleep(config.DEMO_ATTRACTION_TIMEOUT_MS);
    return demoFallbackCards;
  }

  if (!openaiClient) {
    return demoPlaceFallbackCards(request);
  }

  try {
    const response = await withOpenAiTimeout(
      createWebSearchResponse(
      [
        {
          role: "system",
          content:
            "Search the web for exact named places that belong in a real itinerary. Return only specific places, never category pages or search result page titles. Use travel blogs, official tourism pages, and tour operators as evidence. The card title must be the actual place name a traveler would pin on a trip board. For demo-style prompts, prefer popular concrete attractions and strong food stops that clearly match the user's request themes.",
        },
        {
          role: "user",
          content: JSON.stringify({
            bucket: "food-hidden-gems",
            request,
            requestedThemes: [
              /elephant|sanctuary|wildlife/i.test(request.prompt) ? "elephant sanctuaries or elephant day trips" : null,
              /floating market|market/i.test(request.prompt) ? "floating markets" : null,
              /pad thai|street food|food|eat/i.test(request.prompt) ? "pad thai and memorable food stops" : null,
            ].filter(Boolean),
            sourceFamilies: candidateHints.map((candidate) => ({
              platform: candidate.platform ?? candidate.label,
              domain: candidate.domain,
              reason: candidate.credibilityGoal,
            })),
            output: {
              cards: [
                {
                  title: "actual place name",
                  summary: "one short summary",
                  whyItFits: "why it fits the trip",
                  trustTag: "Hidden Gem",
                  trustSummary: "why the source is trustworthy",
                  credibilityNotes: ["short trust notes"],
                  sourceLabel: "specific article or operator page",
                  url: "source url",
                  sourceKind: "official | partner | guide | forum | social",
                  recommendedDurationMinutes: 90,
                  touristPrice: "optional visible public price",
                  localPrice: "optional local-value note",
                  warnings: ["optional warnings"],
                  quotes: ["short extracted detail"],
                  bookingLink: "optional direct provider url",
                  coords: { lat: 0, lng: 0 },
                },
              ],
            },
          }),
        },
      ],
      config.OPENAI_SYNTH_MODEL,
      ),
      "synthesizeNamedPlaceCards",
      config.DEMO_ATTRACTION_TIMEOUT_MS,
    );

    const parsed = parseJsonObject(response.output_text ?? "", liveCardResponseSchema);
    return parsed?.cards ?? demoPlaceFallbackCards(request);
  } catch {
    return demoPlaceFallbackCards(request);
  }
}

function buildTinyFishGoal(
  request: DiscoverRequest,
  bucket: Bucket,
  source: SourceCandidate,
  modelGoal: string,
) {
  const dateLine =
    request.dates?.start && request.dates?.end
      ? `TRAVEL DATES: ${request.dates.start} to ${request.dates.end}.`
      : "TRAVEL DATES: Use the visible cheapest public availability view if exact dates are not available.";

  if (bucket === "flights") {
    return [
      "You are checking one flight source only.",
      `ALLOWED SITE: Stay only on ${source.domain}. Do not open other sites, search engines, ads, or unrelated tabs.`,
      `TRIP INTENT: Find public flight options from ${request.origin} to ${request.destination}.`,
      formatFlightPreferencesForPrompt(request.flightPreferences),
      dateLine,
      "STEP 1 - LANDING:",
      `Start at ${source.url}. If a cookie banner or region chooser appears, accept only what is needed to continue.`,
      "STEP 2 - ENTER THE ROUTE:",
      `Use origin: "${request.origin}" and destination: "${request.destination}".`,
      "If dates are visible in the request, use them exactly. Otherwise keep the page on the cheapest public availability view.",
      "STEP 3 - FIND THE FIRST USEFUL PUBLIC FARE:",
      "Capture the lowest visible public fare or the first clearly comparable fare card that matches the user's stated preferences.",
      "Ignore sponsored labels, promoted badges, insurance upsells, and unrelated bundles.",
      "If baggage, priority boarding, meals, or fare bundles are visible, capture whether they are included or extra.",
      "If the user asked for checked baggage, priority boarding, or meals, try to capture the visible total after those extras. If an exact total is not visible, capture the base fare plus the add-on prices separately.",
      "For all fare fields, prefer SGD output. If the source shows another currency, capture the visible original amount and convert it into an approximate SGD amount, then mention the original observed currency in notes.",
      "STEP 4 - RETURN ONLY TRAVEL DATA AS STRICT JSON:",
      "Return a single JSON object only.",
      "JSON SHAPE:",
      "{\"airline\":\"...\",\"seller\":\"...\",\"route\":\"...\",\"baseFare\":\"...\",\"totalFare\":\"...\",\"baggagePolicy\":\"...\",\"checkedBagPrice\":\"...\",\"boardingPolicy\":\"...\",\"mealPolicy\":\"...\",\"fareClass\":\"...\",\"preferencesMatched\":[\"...\"],\"preferencesMissing\":[\"...\"],\"notes\":[\"...\"],\"bookingLink\":\"current page url\"}",
      "Keep values short and factual. If something is not visible, use an empty string.",
      "If the site does not reveal a usable fare, say that clearly instead of wandering elsewhere.",
      `TASK GOAL: ${modelGoal}`,
    ].join("\n");
  }

  if (bucket === "hotels") {
    return [
      "You are checking one hotel source only.",
      `ALLOWED SITE: Stay only on ${source.domain}. Do not open other sites, search engines, ads, or unrelated tabs.`,
      `DESTINATION: ${request.destination}`,
      formatHotelPreferencesForPrompt(request.hotelPreferences),
      dateLine,
      "STEP 1 - FIND ONE USEFUL HOTEL OPTION:",
      "Capture one actual property listing or exact hotel page that could work as the trip base.",
      "STEP 2 - EXTRACT THE STAY TERMS:",
      "Find the visible nightly rate, total stay price if shown, whether breakfast is included, whether free cancellation is offered, whether pay later or pay at property is available, and the neighborhood or area.",
      "STEP 3 - RETURN ONLY HOTEL DATA AS STRICT JSON:",
      "Return a single JSON object only.",
      "JSON SHAPE:",
      "{\"propertyName\":\"...\",\"nightlyRate\":\"...\",\"totalStayPrice\":\"...\",\"breakfastIncluded\":true,\"freeCancellation\":true,\"payLaterAvailable\":true,\"neighborhood\":\"...\",\"cancellationPolicy\":\"...\",\"roomType\":\"...\",\"preferencesMatched\":[\"...\"],\"preferencesMissing\":[\"...\"],\"notes\":[\"...\"],\"bookingLink\":\"current page url\"}",
      "Use SGD for visible rate fields where possible. If the site shows another currency, convert approximately into SGD and mention the original observed currency in notes.",
      "If the site does not reveal a usable stay option, say that clearly instead of wandering elsewhere.",
      `TASK GOAL: ${modelGoal}`,
    ].join("\n");
  }

  if (bucket === "food-hidden-gems") {
    return [
      "You are checking one place-discovery source only.",
      `ALLOWED SITE: Stay only on ${source.domain}. Do not use other sites or search results.`,
      `DESTINATION: ${request.destination}`,
      dateLine,
      "STEP 1 - FIND ONE REAL PLACE:",
      "Look for one named cafe, market, neighborhood, attraction, museum, scenic area, shopping street, or tour stop with enough concrete detail to help a traveler decide.",
      "STEP 2 - EXTRACT THE IMPORTANT FACTS:",
      "Capture the place name, neighborhood or town, what makes it special, and one caution such as queue, timing, reservation, or seasonal issue.",
      "STEP 3 - RETURN ONLY RELEVANT DETAIL:",
      "Do not browse off-site. If the page is blocked or too vague, say that clearly.",
      `TASK GOAL: ${modelGoal}`,
    ].join("\n");
  }

  if (bucket === "local-transport") {
    return [
      "You are checking one transport or access source only.",
      `ALLOWED SITE: Stay only on ${source.domain}. Do not browse away.`,
      `DESTINATION: ${request.destination}`,
      dateLine,
      "STEP 1 - FIND THE RELEVANT ACCESS DETAIL:",
      "Look for the route, access instructions, terminal, timetable, or schedule information that matters for the trip.",
      "STEP 2 - EXTRACT PRACTICAL LOGISTICS:",
      "Capture the access method, any key time, and one warning such as weather dependence, last departure, or ticketing limitation.",
      "STEP 3 - RETURN ONLY RELEVANT DETAIL:",
      "If the page is too generic, say that clearly instead of wandering elsewhere.",
      `TASK GOAL: ${modelGoal}`,
    ].join("\n");
  }

  if (bucket === "car-rental") {
    return [
      "You are checking one car rental source only.",
      `ALLOWED SITE: Stay only on ${source.domain}. Do not browse away.`,
      `DESTINATION: ${request.destination}`,
      dateLine,
      "STEP 1 - FIND ONE USABLE RENTAL OPTION:",
      "Look for visible rental providers, pickup location context, or price signals relevant to the destination.",
      "STEP 2 - EXTRACT THE IMPORTANT FACTS:",
      "Capture provider name, visible price or rate cue, pickup area, and one policy or cost warning that matters.",
      "STEP 3 - RETURN ONLY RELEVANT DETAIL:",
      "If the site is too generic, say that clearly instead of inventing specifics.",
      `TASK GOAL: ${modelGoal}`,
    ].join("\n");
  }

  return [
    "You are checking one advice source only.",
    `ALLOWED SITE: Stay only on ${source.domain}. Do not browse away.`,
    `DESTINATION: ${request.destination}`,
    dateLine,
    "Find one practical local warning or planning tip that could change the trip.",
    "Return the warning, when it matters, and why a traveler should care.",
    `TASK GOAL: ${modelGoal}`,
  ].join("\n");
}

function buildJobs(
  runId: string,
  request: DiscoverRequest,
  bucket: Bucket,
  candidates: SourceCandidate[],
  plan: z.infer<typeof plannerOutputSchema>,
) {
  const jobs: ExtractionJob[] = [];

  for (const job of plan.jobs) {
    const source = candidates.find((candidate) => candidate.id === job.sourceId);

    if (!source) {
      continue;
    }

    jobs.push({
      id: `${runId}-${job.cardId}`,
      runId,
      cardId: job.cardId,
      sourceId: source.id,
      url: source.url,
      domain: source.domain,
      bucket,
      platform: source.platform,
      sourceKind: source.kind,
      promptHint: job.titleHint,
      goal: buildTinyFishGoal(request, bucket, source, job.goal),
      browserProfile: job.browserProfile,
      proxyCountry: job.proxyCountry ?? undefined,
      timeoutMs: 18000,
    });
  }

  return jobs;
}

export async function planAgentJobs(
  runId: string,
  bucket: Bucket,
  request: DiscoverRequest,
  candidates: SourceCandidate[],
  seedCards: DiscoveryCard[],
) {
  if (!agentBuckets.has(bucket) || candidates.length === 0) {
    return { overview: "", jobs: [] as ExtractionJob[] };
  }

  if (!openaiClient) {
    const fallback = fallbackPlan(bucket, request, candidates);
    return {
      overview: fallback.overview,
      jobs: buildJobs(runId, request, bucket, candidates, fallback),
    };
  }

  try {
    const response = await withOpenAiTimeout(
      openaiClient.responses.parse({
        model: config.OPENAI_PLANNER_MODEL,
        input: [
        {
          role: "system",
          content:
            "You are a travel scout. Pick a small set of sources that help plan a real trip. Stay strictly inside the requested bucket and reject cross-category pages. Prefer sources that reduce sponsored bias. The browser agent must stay on the given domain, so write goals that are explicit, sequential, narrow, and impossible to misread.",
        },
          {
            role: "user",
            content: JSON.stringify({
              request,
              bucket,
              candidates,
              seedCards: seedCards.map((card) => ({
                title: card.title,
                summary: card.summary,
                trustSummary: card.trustSummary,
              })),
            }),
          },
        ],
        text: {
          format: zodTextFormat(plannerOutputSchema, "discovery_plan"),
        },
      }),
      `planAgentJobs:${bucket}`,
    );

    const parsed = plannerOutputSchema.parse(response.output_parsed);

    if (parsed.jobs.length === 0) {
      const fallback = fallbackPlan(bucket, request, candidates);
      return {
        overview: fallback.overview,
        jobs: buildJobs(runId, request, bucket, candidates, fallback),
      };
    }

    if (bucket === "flights") {
      const normalized = normalizeFlightPlan(candidates, request, parsed);
      return {
        overview: normalized.overview,
        jobs: buildJobs(runId, request, bucket, candidates, normalized),
      };
    }

    return {
      overview: parsed.overview,
      jobs: buildJobs(runId, request, bucket, candidates, parsed),
    };
  } catch {
    const fallback = fallbackPlan(bucket, request, candidates);
    return {
      overview: fallback.overview,
      jobs: buildJobs(runId, request, bucket, candidates, fallback),
    };
  }
}

export async function synthesizeAgentCards(
  bucket: Bucket,
  request: DiscoverRequest,
  jobs: ExtractionJob[],
  results: ExtractionResult[],
  candidates: SourceCandidate[],
) {
  if (!agentBuckets.has(bucket) || results.length === 0) {
    return [] as DiscoveryCard[];
  }

  if (!openaiClient) {
    const fallback = fallbackSynthesis(bucket, jobs, results, candidates);
    return mapToCards(bucket, fallback.cards, jobs, candidates);
  }

  try {
    const response = await withOpenAiTimeout(openaiClient.responses.parse({
      model: config.OPENAI_SYNTH_MODEL,
      input: [
        {
          role: "system",
          content:
            "Turn raw trip research into clean travel cards. Be specific, avoid hype, and keep each card inside the requested bucket. If a result is not actually a flight, hotel, car rental, transport, hidden-gem place, or advice item for that bucket, do not turn it into a card. For flights, prefer structured fare-package details from the extraction result over generic prose, and surface the total price that best matches the user's stated preferences. For hotels, prefer structured stay terms from the extraction result, especially nightly price, breakfast, cancellation, pay-later, and neighborhood fit.",
        },
        {
          role: "user",
          content: JSON.stringify({
            destination: request.destination,
            prompt: request.prompt,
            bucket,
            results,
          }),
        },
      ],
      text: {
        format: zodTextFormat(synthesisOutputSchema, "synthesized_cards"),
      },
    }), `synthesizeAgentCards:${bucket}`);

    const parsed = synthesisOutputSchema.parse(response.output_parsed);

    if (parsed.cards.length === 0) {
      const fallback = fallbackSynthesis(bucket, jobs, results, candidates);
      return mapToCards(bucket, fallback.cards, jobs, candidates);
    }

    return mapToCards(bucket, parsed.cards, jobs, candidates);
  } catch {
    const fallback = fallbackSynthesis(bucket, jobs, results, candidates);
    return mapToCards(bucket, fallback.cards, jobs, candidates);
  }
}

export async function synthesizeLiveSearchCards(
  bucket: Bucket,
  request: DiscoverRequest,
  candidates: SourceCandidate[],
) {
  if (!openaiClient) {
    return bucket === "food-hidden-gems"
      ? mapLiveCards(bucket, demoPlaceFallbackCards(request), candidates)
      : fallbackLiveCards(bucket, request, candidates);
  }

  try {
    const relevantCandidates = filterCandidatesForRequest(bucket, request, candidates);

    if (bucket === "food-hidden-gems") {
      const namedPlaceCards = (await synthesizeNamedPlaceCards(request, relevantCandidates)).filter(foodHiddenGemLooksSpecific);
      const mergedCards = mergePlaceFallbackCards(namedPlaceCards, demoPlaceFallbackCards(request), 8);
      return mergedCards.length > 0 ? mapLiveCards(bucket, mergedCards, relevantCandidates) : [];
    }

    const response = await createWebSearchResponse(
      [
        {
          role: "system",
          content:
            "Find exact travel options for the user's request and return clean card JSON only. Stay strictly inside the requested bucket. Prefer exact place pages, official operator pages, and direct booking pages. Avoid generic country listicles unless they contain a specific place or operator.",
        },
        {
          role: "user",
          content: JSON.stringify({
            bucket,
            request,
            candidateHints: relevantCandidates.map((candidate) => ({
              label: candidate.label,
              url: candidate.url,
              kind: candidate.kind,
            })),
            guidance: bucketSourcePrompt(bucket, request),
            output: {
              cards: [
                {
                  title: "card title",
                  summary: "one short summary",
                  whyItFits: "why it fits the trip",
                  trustTag: "Official Schedule | Official Stay | Verified Partner | Local Tip | Hidden Gem | Local Advice",
                  trustSummary: "why the source is trustworthy",
                  credibilityNotes: ["short trust notes"],
                  sourceLabel: "source label",
                  url: "source url",
                  sourceKind: "official | partner | guide | forum | social",
                  recommendedDurationMinutes: 90,
                  touristPrice: "optional visible public price",
                  localPrice: "optional lower local-style or value note",
                  hotelOffer: {
                    propertyName: "optional hotel name",
                    nightlyRate: "optional nightly rate in SGD",
                    totalStayPrice: "optional total stay price in SGD",
                    breakfastIncluded: true,
                    freeCancellation: true,
                    payLaterAvailable: true,
                    neighborhood: "optional area",
                    cancellationPolicy: "optional short cancellation note",
                    roomType: "optional room type",
                    preferencesMatched: ["short matches"],
                    preferencesMissing: ["short gaps"],
                    notes: ["extra deal notes"],
                  },
                  warnings: ["optional warnings"],
                  quotes: ["short quote or extracted detail"],
                  bookingLink: "optional direct provider url",
                  coords: { lat: 0, lng: 0 },
                },
              ],
            },
          }),
        },
      ],
      config.OPENAI_SYNTH_MODEL,
    );

    const parsed = parseJsonObject(response.output_text ?? "", liveCardResponseSchema);

    if (!parsed) {
      return fallbackLiveCards(bucket, request, relevantCandidates);
    }

    const filteredCards = parsed.cards.filter((draft) => {
      const matchedCandidate = relevantCandidates.find(
        (candidate) => candidate.url === draft.url || candidate.url === draft.bookingLink,
      );

      if (matchedCandidate) {
        return true;
      }

      const searchableText = [
        draft.title,
        draft.summary,
        draft.whyItFits,
        draft.trustSummary,
        draft.sourceLabel,
        draft.url,
        draft.bookingLink,
      ]
        .filter(Boolean)
        .join(" ");

      return mentionsRequestLocation(searchableText, request) && liveCardHasBucketSignal(bucket, draft);
    });

    const limitedCards = filteredCards.slice(0, 5);

    if (limitedCards.length === 0) {
      return fallbackLiveCards(bucket, request, relevantCandidates);
    }

    return mapLiveCards(bucket, limitedCards, relevantCandidates);
  } catch {
    return bucket === "food-hidden-gems" ? ([] as DiscoveryCard[]) : fallbackLiveCards(bucket, request, candidates);
  }
}
