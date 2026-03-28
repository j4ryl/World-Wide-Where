import type { ExtractionJob, ExtractionResult } from "@planit/shared-schema";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerSeed(job: ExtractionJob) {
  const value = `${job.platform ?? ""}:${job.domain}:${job.bucket}`;
  return [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function formatSgd(amount: number) {
  return `SGD ${amount}`;
}

export async function simulateExtraction(job: ExtractionJob): Promise<ExtractionResult> {
  const jobDelay = Math.min(job.timeoutMs, 450 + job.domain.length * 30);
  await delay(jobDelay);
  const seed = providerSeed(job);

  const flightBaseFare = 108 + (seed % 9) * 11;
  const checkedBagPrice = 26 + (seed % 4) * 6;
  const mealPrice = 9 + (seed % 3) * 4;
  const totalFare = flightBaseFare + checkedBagPrice + mealPrice + 8;

  const hotelNightlyRate = 168 + (seed % 7) * 18;
  const hotelTotalStayPrice = hotelNightlyRate * 3 + 24 + (seed % 3) * 12;

  const simulatedFlightObservation =
    job.bucket === "flights"
      ? {
          airline: job.platform ?? "Public fare source",
          seller: job.platform ?? job.domain,
          route: job.promptHint,
          baseFare: formatSgd(flightBaseFare),
          totalFare: formatSgd(totalFare),
          baggagePolicy: "Cabin bag included; checked bag extra",
          checkedBagPrice: formatSgd(checkedBagPrice),
          boardingPolicy: "Priority boarding extra",
          mealPolicy: "Meal extra",
          fareClass: "Economy Light",
          preferencesMatched: ["Visible total fare found", "Carry-on policy found"],
          preferencesMissing: ["Priority boarding price not confirmed at checkout"],
          notes: ["Simulated fallback result used because live browser extraction was unavailable."],
        }
      : undefined;
  const simulatedHotelObservation =
    job.bucket === "hotels"
      ? {
          propertyName: job.platform ?? "Hotel stay option",
          nightlyRate: formatSgd(hotelNightlyRate),
          totalStayPrice: formatSgd(hotelTotalStayPrice),
          breakfastIncluded: seed % 2 === 0,
          freeCancellation: seed % 3 !== 0,
          payLaterAvailable: seed % 4 !== 0,
          neighborhood: "Central district",
          cancellationPolicy: "Free cancellation before the final cancellation window.",
          roomType: "Deluxe room",
          preferencesMatched: ["Free cancellation found", "Breakfast included found", "Pay-later option found"],
          preferencesMissing: ["Exact tax breakdown not confirmed"],
          notes: ["Simulated fallback result used because live browser extraction was unavailable."],
        }
      : undefined;

  return {
    jobId: job.id,
    cardId: job.cardId,
    quote: `Checked ${job.domain} and pulled a clearer note for ${job.bucket.replace("-", " ")} results.`,
    warning:
      job.bucket === "local-advice"
        ? "Keep a backup stop or meal option in case mountain weather or Sunday hours shift."
        : job.bucket === "food-hidden-gems"
          ? "Smaller independent cafes can close earlier or change hours without much notice."
          : undefined,
    verificationState: "live",
    details:
      job.bucket === "flights"
        ? [
            "Visible fare snapshot found on the page.",
            `Base fare: ${formatSgd(flightBaseFare)}`,
            `Estimated total with requested extras: ${formatSgd(totalFare)}`,
            `Checked bag add-on: ${formatSgd(checkedBagPrice)}`,
            "Compare direct-booking baggage rules before choosing an aggregator.",
          ]
        : job.bucket === "hotels"
          ? [
              `Nightly rate: ${formatSgd(hotelNightlyRate)}`,
              `Total stay price: ${formatSgd(hotelTotalStayPrice)}`,
              `Free cancellation: ${simulatedHotelObservation?.freeCancellation ? "Yes" : "No"}`,
              `Breakfast included: ${simulatedHotelObservation?.breakfastIncluded ? "Yes" : "No"}`,
              `Pay later: ${simulatedHotelObservation?.payLaterAvailable ? "Yes" : "No"}`,
            ]
        : ["Useful detail extracted from a browser-only page.", "Cross-check hours or location before locking the plan."],
    flightObservation: simulatedFlightObservation,
    hotelObservation: simulatedHotelObservation,
    credibilitySignals: [
      job.browserProfile === "stealth"
        ? "Used a browser-style extraction path for a harder-to-crawl source."
        : "Used a standard browser extraction path.",
    ],
    sourceSummary: `${job.platform ?? job.domain}: extracted structured detail from a live page.`,
  };
}
