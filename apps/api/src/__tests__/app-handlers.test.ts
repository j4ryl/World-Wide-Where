import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../pipeline", () => ({
  executeDiscoveryRun: vi.fn(),
  expandDiscoveryRun: vi.fn(),
}));

import { handleDiscover, handleExpandRun, handleGetRun } from "../app";
import { runsStore } from "../runs-store";

const testRequest = {
  prompt: "I need flights from Singapore to Kuching and a hotel near Bako transit.",
  origin: "Singapore",
  destination: "Kuching",
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
  mode: "live" as const,
  pricingMode: "public" as const,
};

describe("app handlers", () => {
  beforeEach(() => {
    runsStore.clear();
  });

  afterEach(() => {
    runsStore.clear();
  });

  it("creates a run and returns it through handleGetRun", async () => {
    const discoverResponse = await handleDiscover(testRequest);

    expect(discoverResponse.status).toBe(202);
    expect(discoverResponse.body.runId).toBeTruthy();

    const runResponse = handleGetRun(discoverResponse.body.runId);

    expect(runResponse.status).toBe(200);
    expect(runResponse.body.id).toBe(discoverResponse.body.runId);
    expect(runResponse.body.request.origin).toBe("Singapore");
    expect(runResponse.body.request.flightPreferences?.sellerPreference).toBe("direct_preferred");
    expect(runResponse.body.status).toBe("queued");
  });

  it("returns 404 for a missing run id", () => {
    const response = handleGetRun("does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Run not found");
  });

  it("accepts a staged expansion for an existing run", async () => {
    const discoverResponse = await handleDiscover(testRequest);
    const response = await handleExpandRun(discoverResponse.body.runId, {
      buckets: ["flights"],
      selectedCardIds: ["place-1", "place-2"],
    });

    expect(response.status).toBe(202);
    expect(response.body.runId).toBe(discoverResponse.body.runId);
    expect(response.body.buckets).toEqual(["flights"]);
  });
});
