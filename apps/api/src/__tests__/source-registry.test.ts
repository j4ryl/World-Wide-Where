import { describe, expect, it } from "vitest";

import { findCardsByIds, matchSeedDestination } from "../source-registry";

describe("source registry", () => {
  it("matches the Switzerland seed data", async () => {
    const destination = await matchSeedDestination(
      "Need scenic trains, a quiet cafe, and local advice for Switzerland",
      "Switzerland",
    );

    expect(destination.region).toBe("switzerland");
    expect(destination.cards.length).toBeGreaterThan(4);
  });

  it("finds seeded cards by id", async () => {
    const cards = await findCardsByIds(["hotel-interlaken", "transport-sbb-interlaken"]);

    expect(cards).toHaveLength(2);
    expect(cards[0]?.bookingLink).toContain("hotelinterlaken");
  });
});
