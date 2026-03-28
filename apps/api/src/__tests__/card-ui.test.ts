import { beforeEach, describe, expect, it, vi } from "vitest";

const parseMock = vi.fn();
const createMock = vi.fn();

vi.mock("../config", () => ({
  config: {
    OPENAI_API_KEY: "test-key",
    OPENAI_SYNTH_MODEL: "gpt-5.4-mini",
    OPENAI_IMAGE_MODEL: "gpt-5.4-mini",
    OPENAI_STEP_TIMEOUT_MS: 1000,
  },
}));

vi.mock("openai/helpers/zod", () => ({
  zodTextFormat: vi.fn(() => ({ type: "json_schema" })),
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    responses = {
      parse: parseMock,
      create: createMock,
    };
  },
}));

describe("prepareCardsForUi", () => {
  beforeEach(() => {
    parseMock.mockReset();
    createMock.mockReset();
  });

  it("falls back to a plain JSON translation call when structured parse fails", async () => {
    parseMock.mockRejectedValueOnce(new Error("structured parse failed"));
    createMock.mockResolvedValueOnce({
      output_text: JSON.stringify({
        cards: [
          {
            id: "guide-1",
            title: "Six forest-style cafes in Bangkok",
            summary: "Travel blog: structured details from a live page.",
            whyItFits: "Good for adding a quieter stop once the route is clearer.",
            sourceLabel: "Six forest-style cafes in Bangkok",
            trustSummary: "Used a live page extraction path.",
            warnings: ["Independent cafes can change hours with little notice."],
          },
        ],
      }),
    });

    const { prepareCardsForUi } = await import("../card-ui");
    const result = await prepareCardsForUi([
      {
        id: "guide-1",
        bucket: "food-hidden-gems",
        title: "一口气又整理了六家曼谷森系咖啡厅‼️",
        summary: "Travel blog: extracted structured detail from a live page.",
        whyItFits: "Good for adding one quieter stop after you lock your base and transport.",
        imageUrls: ["http://images.example.com/example.jpg"],
        trustTag: "Hidden Gem",
        trustSummary: "Used a live page extraction path.",
        credibilityNotes: [],
        verificationState: "live",
        sourceLabel: "一口气又整理了六家曼谷森系咖啡厅‼️",
        recommendedDurationMinutes: 75,
        warnings: ["Smaller independent cafes can close earlier or change hours without much notice."],
        quotes: [],
        provenance: [
          {
            label: "一口气又整理了六家曼谷森系咖啡厅‼️",
            url: "https://example.com/bangkok-cafes",
            kind: "guide",
            lastChecked: new Date().toISOString(),
          },
        ],
      },
    ]);

    expect(result[0].planningStage).toBe("places");
    expect(result[0].title).toBe("Six forest-style cafes in Bangkok");
    expect(result[0].sourceLabel).toBe("Six forest-style cafes in Bangkok");
    expect(result[0].originalTitle).toBe("一口气又整理了六家曼谷森系咖啡厅‼️");
    expect(result[0].imageUrls).toEqual(["https://images.example.com/example.jpg"]);
  });

  it("retries one card at a time if batch translation still leaves non-English text behind", async () => {
    parseMock.mockResolvedValueOnce({
      output_parsed: {
        cards: [
          {
            id: "guide-2",
            title: "曼谷必喝咖啡店Top",
            summary: "Travel blog: extracted structured detail from a live page.",
            whyItFits: "Good for adding one quieter stop after you lock your base and transport.",
            sourceLabel: "曼谷必喝咖啡店Top",
            trustSummary: "Used a live page extraction path.",
            warnings: ["Smaller independent cafes can close earlier or change hours without much notice."],
          },
        ],
      },
    });
    createMock.mockResolvedValueOnce({
      output_text: JSON.stringify({
        id: "guide-2",
        title: "Top coffee spots in Bangkok",
        summary: "Travel blog: extracted structured detail from a live page.",
        whyItFits: "Good for adding one quieter stop after you lock your base and transport.",
        sourceLabel: "Top coffee spots in Bangkok",
        trustSummary: "Used a live page extraction path.",
        warnings: ["Smaller independent cafes can close earlier or change hours without much notice."],
      }),
    });

    const { prepareCardsForUi } = await import("../card-ui");
    const result = await prepareCardsForUi([
      {
        id: "guide-2",
        bucket: "food-hidden-gems",
        title: "曼谷必喝咖啡店Top",
        summary: "Travel blog: extracted structured detail from a live page.",
        whyItFits: "Good for adding one quieter stop after you lock your base and transport.",
        imageUrls: [],
        trustTag: "Hidden Gem",
        trustSummary: "Used a live page extraction path.",
        credibilityNotes: [],
        verificationState: "live",
        sourceLabel: "曼谷必喝咖啡店Top",
        recommendedDurationMinutes: 75,
        warnings: ["Smaller independent cafes can close earlier or change hours without much notice."],
        quotes: [],
        provenance: [
          {
            label: "曼谷必喝咖啡店Top",
            url: "https://example.com/bangkok-coffee-guide",
            kind: "guide",
            lastChecked: new Date().toISOString(),
          },
        ],
      },
    ]);

    expect(result[0].title).toBe("Top coffee spots in Bangkok");
    expect(result[0].sourceLabel).toBe("Top coffee spots in Bangkok");
    expect(result[0].originalTitle).toBe("曼谷必喝咖啡店Top");
  });
});
