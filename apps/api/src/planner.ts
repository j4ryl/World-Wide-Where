import type { DiscoverRequest, SearchPlan } from "@planit/shared-schema";

const bucketKeywords: Array<{
  bucket: SearchPlan["buckets"][number];
  keywords: string[];
}> = [
  { bucket: "flights", keywords: ["flight", "airport", "fly"] },
  { bucket: "hotels", keywords: ["hotel", "stay", "accommodation"] },
  { bucket: "car-rental", keywords: ["car", "rental", "drive"] },
  { bucket: "local-transport", keywords: ["train", "bus", "ferry", "boat", "transport", "schedule"] },
  {
    bucket: "food-hidden-gems",
    keywords: [
      "food",
      "eat",
      "pad thai",
      "street food",
      "cafe",
      "coffee",
      "hidden gem",
      "restaurant",
      "shopping",
      "market",
      "floating market",
      "attraction",
      "temple",
      "museum",
      "neighborhood",
      "district",
      "park",
      "tour",
      "elephant",
      "elephants",
      "sanctuary",
      "wildlife",
    ],
  },
  { bucket: "local-advice", keywords: ["warning", "advice", "local", "weather", "closure"] },
];

const bucketFlowOrder: Record<SearchPlan["buckets"][number], number> = {
  "food-hidden-gems": 0,
  "local-advice": 1,
  hotels: 2,
  "local-transport": 3,
  flights: 4,
  "car-rental": 5,
};

function looksLikeTripPlanningPrompt(request: DiscoverRequest) {
  return (
    Boolean(request.destination?.trim()) ||
    /\b(plan|trip|travel|itinerary|days?|weekend|vacation|holiday|visit)\b/i.test(request.prompt)
  );
}

function hasExplicitLogisticsIntent(promptLower: string) {
  return bucketKeywords
    .filter(({ bucket }) => bucket !== "food-hidden-gems" && bucket !== "local-advice")
    .some(({ keywords }) => keywords.some((keyword) => promptLower.includes(keyword)));
}

function orderBucketsForConversationFlow(buckets: SearchPlan["buckets"]) {
  return [...new Set(buckets)].sort((left, right) => bucketFlowOrder[left] - bucketFlowOrder[right]);
}

function inferTripLength(request: DiscoverRequest) {
  if (request.dates?.start && request.dates?.end) {
    const start = new Date(request.dates.start);
    const end = new Date(request.dates.end);
    const ms = end.getTime() - start.getTime();
    const dayCount = Math.round(ms / (1000 * 60 * 60 * 24)) + 1;

    if (Number.isFinite(dayCount) && dayCount > 0) {
      return dayCount;
    }
  }

  const textMatch =
    request.prompt.match(/(\d+)\s*-\s*day/i) ??
    request.prompt.match(/(\d+)\s+day/i) ??
    request.prompt.match(/(\d+)\s+days/i);

  return textMatch ? Number(textMatch[1]) : 3;
}

export function createSearchPlan(request: DiscoverRequest): SearchPlan {
  const promptLower = request.prompt.toLowerCase();
  const inferredBuckets: SearchPlan["buckets"] = bucketKeywords
    .filter(({ keywords }) => keywords.some((keyword) => promptLower.includes(keyword)))
    .map(({ bucket }) => bucket);
  const buckets: SearchPlan["buckets"] =
    inferredBuckets.length > 0
      ? [...new Set(inferredBuckets)]
      : looksLikeTripPlanningPrompt(request) && !hasExplicitLogisticsIntent(promptLower)
        ? ["food-hidden-gems"]
        : [
            "flights",
            "hotels",
            "car-rental",
            "local-transport",
            "food-hidden-gems",
            "local-advice",
          ];

  if (looksLikeTripPlanningPrompt(request) && !buckets.includes("food-hidden-gems")) {
    buckets.push("food-hidden-gems");
  }

  if (
    looksLikeTripPlanningPrompt(request) &&
    buckets.includes("food-hidden-gems") &&
    !hasExplicitLogisticsIntent(promptLower)
  ) {
    return {
      tripBrief: request.prompt,
      destination: request.destination || "the destination in the request",
      tripLengthDays: inferTripLength(request),
      buckets: ["food-hidden-gems"],
      freshnessNotes: [
        "Check official transport, opening-hour, and operator pages before relying on a timetable or booking detail.",
        "Treat social and forum findings as inspiration or warnings, not the only source of critical logistics.",
      ],
      budgetNotes: [
        "Use public prices for the main comparison and surface lower local-style options only when there is clear evidence.",
        "Keep a fallback option ready for weather-sensitive or disruption-sensitive parts of the route.",
      ],
    };
  }

  return {
    tripBrief: request.prompt,
    destination: request.destination || "the destination in the request",
    tripLengthDays: inferTripLength(request),
    buckets: orderBucketsForConversationFlow(buckets),
    freshnessNotes: [
      "Check official transport, opening-hour, and operator pages before relying on a timetable or booking detail.",
      "Treat social and forum findings as inspiration or warnings, not the only source of critical logistics.",
    ],
    budgetNotes: [
      "Use public prices for the main comparison and surface lower local-style options only when there is clear evidence.",
      "Keep a fallback option ready for weather-sensitive or disruption-sensitive parts of the route.",
    ],
  };
}

function formatFlightPreferenceSummary(request: DiscoverRequest) {
  const prefs = request.flightPreferences;

  if (!prefs) {
    return "";
  }

  const baggageMap = {
    no_bag: "no baggage",
    cabin_only: "cabin bag only",
    one_checked_bag: "one checked bag",
    two_checked_bags: "two checked bags",
  } as const;
  const boardingMap = {
    no_preference: "no boarding preference",
    priority_preferred: "priority boarding preferred",
    priority_required: "priority boarding required",
  } as const;
  const mealsMap = {
    no_preference: "no meal preference",
    meal_preferred: "meal preferred",
    meal_required: "meal required",
  } as const;
  const fareStyleMap = {
    cheapest: "cheapest headline fare",
    balanced: "balanced total value",
    extras_included: "extras included where possible",
  } as const;
  const sellerMap = {
    any: "any seller",
    direct_preferred: "direct airline preferred",
    direct_only: "direct airline only",
  } as const;

  return ` Flight preferences: ${baggageMap[prefs.baggage]}, ${boardingMap[prefs.boarding]}, ${mealsMap[prefs.meals]}, ${fareStyleMap[prefs.fareStyle]}, ${sellerMap[prefs.sellerPreference]}.`;
}

function formatHotelPreferenceSummary(request: DiscoverRequest) {
  const prefs = request.hotelPreferences;

  if (!prefs) {
    return "";
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

  const areaNote = request.hotelPreferences?.areaPreference?.trim()
    ? `, area preference: ${request.hotelPreferences.areaPreference.trim()}`
    : "";

  return ` Hotel preferences: ${cancellationMap[prefs.freeCancellation]}, ${breakfastMap[prefs.breakfast]}, ${paymentMap[prefs.payment]}, ${styleMap[prefs.style]}, ${starMap[prefs.starPreference]}${areaNote}.`;
}

export function createParsedSummary(request: DiscoverRequest, plan: SearchPlan) {
  const travelers = request.travelers?.adults ?? 2;
  const route =
    request.origin && plan.destination
      ? `from ${request.origin} to ${plan.destination}`
      : `to ${plan.destination}`;
  return `Planning a ${plan.tripLengthDays}-day trip ${route} for ${travelers} traveler${travelers === 1 ? "" : "s"}, with ${plan.buckets.length} search area${plan.buckets.length === 1 ? "" : "s"} and ${request.busyWindows.length} busy time block${request.busyWindows.length === 1 ? "" : "s"}.${formatFlightPreferenceSummary(request)}${formatHotelPreferenceSummary(request)}`;
}
