import {
  hotelComparisonResultSchema,
  type DiscoverRequest,
  type ExtractionJob,
  type HotelComparisonResult,
  type HotelPreferences,
} from "@planit/shared-schema";

import { extractJobsIndependently } from "./worker-client";

const hotelPlatforms = [
  {
    id: "agoda",
    label: "Agoda",
    url: "https://www.agoda.com/",
    domain: "agoda.com",
    kind: "partner" as const,
  },
  {
    id: "booking",
    label: "Booking.com",
    url: "https://www.booking.com/",
    domain: "booking.com",
    kind: "partner" as const,
  },
  {
    id: "google-hotels",
    label: "Google Hotels",
    url: "https://www.google.com/travel/hotels",
    domain: "google.com",
    kind: "guide" as const,
  },
  {
    id: "expedia",
    label: "Expedia",
    url: "https://www.expedia.com/Hotel-Search",
    domain: "expedia.com",
    kind: "partner" as const,
  },
];

function formatHotelPreferencesForPrompt(preferences: HotelPreferences | undefined) {
  if (!preferences) {
    return "No extra hotel preferences were given yet.";
  }

  return [
    preferences.freeCancellation === "required"
      ? "Free cancellation required."
      : preferences.freeCancellation === "preferred"
        ? "Free cancellation preferred."
        : "Free cancellation not needed.",
    preferences.breakfast === "required"
      ? "Breakfast required."
      : preferences.breakfast === "preferred"
        ? "Breakfast preferred."
        : "Breakfast not needed.",
    preferences.payment === "pay_later_preferred"
      ? "Pay later preferred."
      : preferences.payment === "pay_at_property_preferred"
        ? "Pay at property preferred."
        : "Prepay is acceptable.",
    preferences.style === "cheapest"
      ? "Optimize for cheapest stay."
      : preferences.style === "upscale"
        ? "Optimize for upscale stays."
        : "Optimize for balanced value.",
    preferences.starPreference === "four_plus"
      ? "Prefer 4-star and above."
      : preferences.starPreference === "five_star_only"
        ? "Only 5-star stays."
        : preferences.starPreference === "three_plus"
          ? "Prefer 3-star and above."
          : "Any star level is acceptable.",
    preferences.areaPreference?.trim() ? `Area preference: ${preferences.areaPreference.trim()}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildHotelComparisonGoal(
  hotelName: string,
  destination: string,
  preferences: HotelPreferences | undefined,
  dates: DiscoverRequest["dates"] | undefined,
  domain: string,
) {
  const dateLine =
    dates?.start && dates?.end
      ? `DATES: ${dates.start} to ${dates.end}.`
      : "DATES: Use the most visible public stay terms if exact dates are not available.";

  return [
    "You are checking one hotel booking site only.",
    `ALLOWED SITE: Stay only on ${domain}. Do not use other sites, ads, or search engines.`,
    `TARGET PROPERTY: ${hotelName} in ${destination}.`,
    dateLine,
    formatHotelPreferencesForPrompt(preferences),
    "STEP 1 - FIND THE EXACT HOTEL:",
    "Search for the exact hotel name. If the exact hotel is not visible, return that clearly instead of switching to a different hotel.",
    "STEP 2 - CAPTURE THE BEST COMPARABLE PUBLIC OFFER:",
    "Look for the most useful visible public offer for that exact hotel. Prefer offers matching the requested cancellation, breakfast, and payment preferences.",
    "STEP 3 - EXTRACT HOTEL TERMS:",
    "Capture the nightly rate, total stay price if visible, breakfast included or not, free cancellation or not, pay later or pay at property if visible, neighborhood, room type, and a short cancellation note.",
    "STEP 4 - RETURN STRICT JSON ONLY:",
    "{\"propertyName\":\"...\",\"nightlyRate\":\"...\",\"totalStayPrice\":\"...\",\"breakfastIncluded\":true,\"freeCancellation\":true,\"payLaterAvailable\":true,\"neighborhood\":\"...\",\"cancellationPolicy\":\"...\",\"roomType\":\"...\",\"preferencesMatched\":[\"...\"],\"preferencesMissing\":[\"...\"],\"notes\":[\"...\"],\"bookingLink\":\"current page url\"}",
    "Use SGD for rate fields where possible. If the site shows another currency, convert approximately into SGD and mention the original observed currency in notes.",
  ].join("\n");
}

function buildHotelComparisonJobs(
  hotelName: string,
  destination: string,
  preferences: HotelPreferences | undefined,
  dates: DiscoverRequest["dates"] | undefined,
): ExtractionJob[] {
  return hotelPlatforms.map((platform, index) => ({
    id: `hotel-compare-${platform.id}-${index + 1}`,
    runId: "hotel-compare",
    cardId: `hotel-offer-${platform.id}`,
    sourceId: platform.id,
    url: platform.url,
    domain: platform.domain,
    bucket: "hotels",
    platform: platform.label,
    sourceKind: platform.kind,
    promptHint: `${hotelName} in ${destination}`,
    goal: buildHotelComparisonGoal(hotelName, destination, preferences, dates, platform.domain),
    browserProfile: "stealth",
    timeoutMs: 9000,
  }));
}

function summarizeBestValue(offers: HotelComparisonResult["offers"]) {
  const bestWithBreakfast = offers.find(
    (offer) => offer.hotelOffer.breakfastIncluded && offer.hotelOffer.freeCancellation,
  );

  if (bestWithBreakfast) {
    return `${bestWithBreakfast.sourceLabel} currently looks strongest for value because it combines breakfast and free cancellation in one comparable offer.`;
  }

  const cheapest = offers.find((offer) => offer.hotelOffer.nightlyRate);

  if (cheapest) {
    return `${cheapest.sourceLabel} currently has the clearest public price for this hotel.`;
  }

  return "Use the matched hotel offers to compare cancellation, breakfast, and payment flexibility before booking.";
}

export async function compareHotelAcrossPlatforms(
  hotelName: string,
  destination: string,
  preferences: HotelPreferences | undefined,
  dates: DiscoverRequest["dates"] | undefined,
) {
  const jobs = buildHotelComparisonJobs(hotelName, destination, preferences, dates);
  const results = await extractJobsIndependently(jobs);

  const offers = results
    .filter((result) => result.hotelObservation)
    .map((result) => {
      const job = jobs.find((entry) => entry.id === result.jobId)!;
      const hotelOffer = result.hotelObservation!;

      return {
        sourceLabel: job.platform ?? job.domain,
        bookingLink: job.url,
        hotelOffer,
        priceSummary: hotelOffer.nightlyRate
          ? {
              touristPrice: hotelOffer.nightlyRate,
              localPrice: hotelOffer.totalStayPrice ?? "Check full stay total on the provider page.",
            }
          : undefined,
      };
    });

  return hotelComparisonResultSchema.parse({
    hotelName,
    destination,
    offers,
    bestValueSummary: summarizeBestValue(offers),
    preparedAt: new Date().toISOString(),
  });
}
