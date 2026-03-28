import { describe, expect, it } from "vitest";

import { createParsedSummary, createSearchPlan } from "../planner";

describe("planner", () => {
  it("includes requested travel buckets from the prompt", () => {
    const request = {
      prompt: "Need trains, a hotel, a quiet cafe, and local weather advice in Switzerland",
      destination: "Switzerland",
      dates: { start: "2026-06-12", end: "2026-06-14" },
      travelers: { adults: 2, children: 0 },
      flightPreferences: {
        baggage: "one_checked_bag" as const,
        boarding: "priority_preferred" as const,
        meals: "meal_preferred" as const,
        fareStyle: "balanced" as const,
        sellerPreference: "direct_preferred" as const,
      },
      busyWindows: [],
      mode: "hybrid" as const,
      pricingMode: "public" as const,
    };

    const plan = createSearchPlan(request);

    expect(plan.tripLengthDays).toBe(3);
    expect(plan.buckets).toEqual(
      expect.arrayContaining(["hotels", "local-transport", "food-hidden-gems", "local-advice"]),
    );
    expect(plan.buckets[0]).toBe("food-hidden-gems");
    expect(createParsedSummary(request, plan)).toContain("3-day trip");
    expect(createParsedSummary(request, plan)).toContain("one checked bag");
  });

  it("keeps place discovery first even when the prompt mentions only logistics", () => {
    const request = {
      prompt: "Plan a Bangkok trip with flights and a hotel that fits the route",
      origin: "Singapore",
      destination: "Bangkok",
      busyWindows: [],
      mode: "live" as const,
      pricingMode: "public" as const,
    };

    const plan = createSearchPlan(request);

    expect(plan.buckets[0]).toBe("food-hidden-gems");
    expect(plan.buckets).toEqual(expect.arrayContaining(["flights", "hotels"]));
    expect(plan.buckets.indexOf("food-hidden-gems")).toBeLessThan(plan.buckets.indexOf("hotels"));
    expect(plan.buckets.indexOf("food-hidden-gems")).toBeLessThan(plan.buckets.indexOf("flights"));
  });

  it("uses correct singular wording in the parsed summary", () => {
    const request = {
      prompt: "Plan a Bangkok trip with one main focus",
      origin: "Singapore",
      destination: "Bangkok",
      busyWindows: [],
      mode: "live" as const,
      pricingMode: "public" as const,
    };

    const plan = {
      ...createSearchPlan(request),
      buckets: ["food-hidden-gems"] as const,
    };

    expect(createParsedSummary(request, plan)).toContain("with 1 search area and 0 busy time blocks");
  });

  it("keeps a place-only prompt in the places bucket", () => {
    const request = {
      prompt: "I want to see elephants and eat pad thai",
      origin: "Singapore",
      destination: "Bangkok",
      busyWindows: [],
      mode: "live" as const,
      pricingMode: "public" as const,
    };

    const plan = createSearchPlan(request);

    expect(plan.buckets).toEqual(["food-hidden-gems"]);
    expect(createParsedSummary(request, plan)).toContain("with 1 search area and 0 busy time blocks");
  });
});
