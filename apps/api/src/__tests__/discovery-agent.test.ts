import { afterAll, describe, expect, it, vi } from "vitest";

const previousOpenAiKey = vi.hoisted(() => {
  const value = process.env.OPENAI_API_KEY;

  process.env.OPENAI_API_KEY = "";
  return value;
});

const { discoverLiveSources, planAgentJobs, synthesizeLiveSearchCards } = await import("../discovery-agent");

afterAll(() => {
  if (previousOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
    return;
  }

  process.env.OPENAI_API_KEY = previousOpenAiKey;
});

const kuchingRequest = {
  prompt: "Need flights for a 3-day Kuching trip",
  origin: "Singapore",
  destination: "Kuching",
  dates: { start: "2026-06-12", end: "2026-06-14" },
  travelers: { adults: 2, children: 0 },
  busyWindows: [],
  mode: "live" as const,
  pricingMode: "public" as const,
};

describe("discovery agent", () => {
  it("returns generic route-specific flight candidates without falling back to Switzerland", async () => {
    const candidates = await discoverLiveSources("flights", kuchingRequest, []);

    expect(candidates.map((candidate) => candidate.label)).toEqual(
      expect.arrayContaining([
        "Google Flights Singapore to Kuching",
        "Skyscanner Singapore to Kuching",
        "Kayak Singapore to Kuching",
        "Trip.com Singapore to Kuching",
      ]),
    );
    expect(candidates.some((candidate) => candidate.region.toLowerCase().includes("switzerland"))).toBe(false);
  });

  it("keeps metasearch, aggregator, and airline coverage in the flight extraction plan", async () => {
    const candidates = await discoverLiveSources("flights", kuchingRequest, []);
    const plan = await planAgentJobs("run-test", "flights", kuchingRequest, candidates, []);

    expect(plan.jobs.map((job) => job.sourceId)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("google"),
        expect.stringContaining("skyscanner"),
        expect.stringContaining("trip"),
      ]),
    );
    expect(plan.jobs.length).toBeGreaterThanOrEqual(4);
  });

  it("adds prompt-aware Bako transport candidates for the Kuching request", async () => {
    const candidates = await discoverLiveSources(
      "local-transport",
      {
        prompt: "Find reliable boat schedules to Bako National Park from Kuching",
        origin: "Singapore",
        destination: "Kuching",
        dates: { start: "2026-06-12", end: "2026-06-14" },
        travelers: { adults: 2, children: 0 },
        busyWindows: [],
        mode: "live",
        pricingMode: "public",
      },
      [],
    );

    expect(candidates.map((candidate) => candidate.label)).toEqual(
      expect.arrayContaining([
        "Sarawak Forestry Bako park access and boat information",
        "Kuching to Bako National Park route planning",
      ]),
    );
  });

  it("includes Agoda and hotel aggregators for hotel discovery", async () => {
    const candidates = await discoverLiveSources(
      "hotels",
      {
        ...kuchingRequest,
        prompt: "Find a Bangkok hotel with free cancellation and breakfast",
        destination: "Bangkok",
        hotelPreferences: {
          freeCancellation: "required",
          breakfast: "preferred",
          payment: "pay_later_preferred",
          style: "balanced",
          areaPreference: "Siam or riverside",
          starPreference: "four_plus",
        },
      },
      [],
    );

    expect(candidates.map((candidate) => candidate.label)).toEqual(
      expect.arrayContaining([
        "Agoda hotels in Bangkok",
        "Booking.com hotels in Bangkok",
        "Google hotels in Bangkok",
      ]),
    );
  });

  it("filters out generic search and review titles from hidden-gem results", async () => {
    const cards = await synthesizeLiveSearchCards(
      "food-hidden-gems",
      {
        ...kuchingRequest,
        prompt: "Find hidden cafes in Bangkok",
        destination: "Bangkok",
      },
      [
        {
          id: "gmaps-search",
          bucket: "food-hidden-gems",
          label: "Bangkok cafe and food map search",
          platform: "Google Maps",
          previewImageUrl: undefined,
          domain: "google.com",
          url: "https://www.google.com/maps/search/Bangkok%20cafe",
          kind: "guide",
          region: "Bangkok",
          requiresBrowser: false,
          loginRequired: false,
          credibilityGoal: "Find hidden-gem cafes and food stops in Bangkok.",
        },
        {
          id: "tripadvisor-search",
          bucket: "food-hidden-gems",
          label: "Bangkok food and cafe reviews",
          platform: "Tripadvisor",
          previewImageUrl: undefined,
          domain: "tripadvisor.com",
          url: "https://www.tripadvisor.com/Search?q=Bangkok%20cafe",
          kind: "guide",
          region: "Bangkok",
          requiresBrowser: false,
          loginRequired: false,
          credibilityGoal: "Find place-specific cafe and food candidates in Bangkok.",
        },
      ],
    );

    expect(cards.length).toBeGreaterThan(0);
    expect(cards.some((card) => /search|reviews?|review|map|maps|tripadvisor|google maps/i.test(card.title))).toBe(
      false,
    );
  });

  it("adds prompt-aware Bangkok attraction candidates for elephants, floating markets, and pad thai", async () => {
    const candidates = await discoverLiveSources(
      "food-hidden-gems",
      {
        ...kuchingRequest,
        prompt: "I want to see elephants and eat good pad thai and visit a floating market",
        destination: "Bangkok",
      },
      [],
    );

    expect(candidates.map((candidate) => candidate.label)).toEqual(
      expect.arrayContaining([
        "Bangkok elephant sanctuary experiences",
        "Bangkok floating market tours",
        "Bangkok pad thai restaurants",
      ]),
    );
  });

  it("returns fast Bangkok demo place fallbacks when OpenAI synthesis is unavailable", async () => {
    const cards = await synthesizeLiveSearchCards(
      "food-hidden-gems",
      {
        ...kuchingRequest,
        prompt: "I want to see elephants and eat good pad thai",
        destination: "Bangkok",
      },
      [],
    );

    expect(cards.map((card) => card.title)).toEqual(
      expect.arrayContaining(["Living Green Elephant Sanctuary", "Thipsamai Pad Thai", "The Grand Palace"]),
    );
    expect(cards.length).toBeGreaterThanOrEqual(6);
  });
});
