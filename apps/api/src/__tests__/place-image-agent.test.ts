import { describe, expect, it } from "vitest";

import { __private__ } from "../place-image-agent";

describe("place image agent heuristics", () => {
  it("treats generic list-page titles as non-place queries", () => {
    expect(__private__.looksGenericPlaceTitle("Bangkok cafe and food map search")).toBe(true);
    expect(__private__.buildGooglePlaceQuery({
      id: "generic-1",
      bucket: "food-hidden-gems",
      title: "Bangkok cafe and food map search",
      summary: "A generic search page",
      whyItFits: "Not relevant",
      imageUrls: [],
      trustTag: "Hidden Gem",
      trustSummary: "Guide",
      credibilityNotes: [],
      verificationState: "live",
      sourceLabel: "Bangkok cafe and food map search",
      recommendedDurationMinutes: 60,
      warnings: [],
      quotes: [],
      provenance: [
        {
          label: "Bangkok food and cafe reviews",
          url: "https://example.com/bangkok-food",
          kind: "guide",
          lastChecked: new Date().toISOString(),
        },
      ],
    })).toBeNull();
  });

  it("builds a Google place query for a named venue", () => {
    expect(__private__.buildGooglePlaceQuery({
      id: "place-1",
      bucket: "food-hidden-gems",
      title: "The Grand Palace",
      summary: "Bangkok landmark",
      whyItFits: "Historic stop",
      imageUrls: [],
      trustTag: "Classic Landmark",
      trustSummary: "Guide",
      credibilityNotes: [],
      verificationState: "live",
      sourceLabel: "The Grand Palace",
      recommendedDurationMinutes: 90,
      warnings: [],
      quotes: [],
      provenance: [
        {
          label: "Bangkok temple guide",
          url: "https://example.com/grand-palace",
          kind: "guide",
          lastChecked: new Date().toISOString(),
        },
      ],
    })).toBe("The Grand Palace, Bangkok temple guide");
  });
});
