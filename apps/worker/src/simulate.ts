import type { ExtractionJob, ExtractionResult } from "@planit/shared-schema";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function simulateExtraction(job: ExtractionJob): Promise<ExtractionResult> {
  const jobDelay = Math.min(job.timeoutMs, 450 + job.domain.length * 30);
  await delay(jobDelay);

  const simulatedFlightObservation =
    job.bucket === "flights"
      ? {
          airline: job.platform ?? "Public fare source",
          seller: job.platform ?? job.domain,
          route: job.promptHint,
          baseFare: "SGD 118",
          totalFare: "SGD 162",
          baggagePolicy: "Cabin bag included; checked bag extra",
          checkedBagPrice: "SGD 32",
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
          nightlyRate: "SGD 214",
          totalStayPrice: "SGD 642",
          breakfastIncluded: true,
          freeCancellation: true,
          payLaterAvailable: true,
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
            "Base fare: SGD 118",
            "Estimated total with requested extras: SGD 162",
            "Checked bag add-on: SGD 32",
            "Compare direct-booking baggage rules before choosing an aggregator.",
          ]
        : job.bucket === "hotels"
          ? [
              "Nightly rate: SGD 214",
              "Total stay price: SGD 642",
              "Free cancellation: Yes",
              "Breakfast included: Yes",
              "Pay later: Yes",
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
