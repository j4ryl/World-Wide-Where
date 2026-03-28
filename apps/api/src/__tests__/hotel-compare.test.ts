import { describe, expect, it, vi } from "vitest";

vi.mock("../worker-client", () => ({
  extractJobsIndependently: vi.fn(async () => [
    {
      jobId: "hotel-compare-agoda-1",
      cardId: "hotel-offer-agoda",
      quote: "Checked Agoda.",
      verificationState: "live",
      details: [],
      hotelObservation: {
        propertyName: "Millennium Hilton Bangkok",
        nightlyRate: "SGD 214",
        totalStayPrice: "SGD 642",
        breakfastIncluded: true,
        freeCancellation: true,
        payLaterAvailable: true,
        neighborhood: "Riverside",
        cancellationPolicy: "Free cancellation before the final cancellation window.",
        roomType: "Deluxe room",
        preferencesMatched: ["Free cancellation found", "Breakfast included found"],
        preferencesMissing: [],
        notes: [],
      },
      credibilitySignals: [],
      sourceSummary: "Agoda",
    },
  ]),
}));

import { compareHotelAcrossPlatforms } from "../hotel-compare";

describe("hotel compare", () => {
  it("returns grouped hotel offers across platforms", async () => {
    const result = await compareHotelAcrossPlatforms(
      "Millennium Hilton Bangkok",
      "Bangkok",
      {
        freeCancellation: "required",
        breakfast: "preferred",
        payment: "pay_later_preferred",
        style: "balanced",
        areaPreference: "riverside",
        starPreference: "four_plus",
      },
      { start: "2026-06-12", end: "2026-06-14" },
    );

    expect(result.hotelName).toBe("Millennium Hilton Bangkok");
    expect(result.offers[0]?.sourceLabel).toBe("Agoda");
    expect(result.offers[0]?.hotelOffer.freeCancellation).toBe(true);
    expect(result.offers[0]?.priceSummary?.touristPrice).toBe("SGD 214");
  });
});
