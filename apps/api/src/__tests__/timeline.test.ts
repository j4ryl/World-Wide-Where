import { describe, expect, it } from "vitest";

import { buildTimeline } from "../timeline";

const cards = [
  {
    id: "transport-sbb-interlaken",
    bucket: "local-transport" as const,
    title: "SBB rail links to Interlaken and Lauterbrunnen",
    summary: "Rail anchor",
    trustTag: "Official Schedule" as const,
    trustSummary: "Official",
    verificationState: "verified" as const,
    sourceLabel: "SBB",
    recommendedDurationMinutes: 75,
    priceSummary: {
      touristPrice: "CHF 32",
      localPrice: "Saver Day Pass",
    },
    coords: {
      lat: 46.6903,
      lng: 7.8691,
    },
    warnings: [],
    quotes: [],
    openingHours: [
      {
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const,
        open: "05:00",
        close: "23:30",
      },
    ],
    provenance: [
      {
        label: "SBB",
        url: "https://www.sbb.ch/en",
        kind: "official" as const,
        lastChecked: "2026-03-27T00:00:00.000Z",
      },
    ],
  },
  {
    id: "food-iseltwald-cafe",
    bucket: "food-hidden-gems" as const,
    title: "Quiet cafe stop in Iseltwald",
    summary: "Cafe stop",
    trustTag: "Hidden Gem" as const,
    trustSummary: "Guide + local",
    verificationState: "cached" as const,
    sourceLabel: "Local guides",
    recommendedDurationMinutes: 75,
    priceSummary: {
      touristPrice: "CHF 18",
      localPrice: "Village bakery",
    },
    coords: {
      lat: 46.7119,
      lng: 7.9648,
    },
    warnings: [],
    quotes: [],
    openingHours: [
      {
        days: ["mon", "thu", "fri", "sat", "sun"] as const,
        open: "10:00",
        close: "17:30",
      },
    ],
    provenance: [
      {
        label: "MySwitzerland",
        url: "https://www.myswitzerland.com/en-us/experiences/food-wine/",
        kind: "guide" as const,
        lastChecked: "2026-03-27T00:00:00.000Z",
      },
    ],
  },
];

describe("timeline", () => {
  it("avoids the busy window and preserves order", async () => {
    const nodes = await buildTimeline(cards, { start: "2026-06-12", end: "2026-06-14" }, [
      {
        id: "busy-1",
        date: "2026-06-12",
        startTime: "09:00",
        endTime: "11:00",
        label: "Morning meeting",
      },
    ]);

    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.startTime >= "11:00").toBe(true);
    expect(nodes[1]?.cardId).toBe("food-iseltwald-cafe");
  });
});
