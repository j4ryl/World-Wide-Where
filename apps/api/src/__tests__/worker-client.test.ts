import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExtractionJob } from "@planit/shared-schema";

import { extractCardEnrichment } from "../worker-client";

function sseBody(events: unknown[]) {
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  });
}

describe("worker client streaming", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses streamed worker events and returns the final result", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        sseBody([
          {
            type: "started",
            jobId: "job-1",
            cardId: "card-1",
            domain: "example.com",
            platform: "Example",
            providerStatus: "STARTED",
            message: "Opened Example.",
          },
          {
            type: "live_url",
            jobId: "job-1",
            cardId: "card-1",
            domain: "example.com",
            platform: "Example",
            providerStatus: "STREAMING_URL",
            liveUrl: "https://example.com/live",
            message: "Live browser ready.",
          },
          {
            type: "completed",
            jobId: "job-1",
            cardId: "card-1",
            domain: "example.com",
            platform: "Example",
            providerStatus: "COMPLETED",
            message: "Finished checking Example.",
            result: {
              jobId: "job-1",
              cardId: "card-1",
              quote: "Finished checking Example.",
              verificationState: "live",
              details: ["One useful detail."],
              credibilitySignals: ["Browser capture completed."],
              sourceSummary: "Example completed.",
            },
          },
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );

    const events: string[] = [];
    const jobs: ExtractionJob[] = [
      {
        id: "job-1",
        runId: "run-1",
        cardId: "card-1",
        url: "https://example.com/place",
        domain: "example.com",
        bucket: "hotels",
        promptHint: "Check a hotel page",
        browserProfile: "lite",
        timeoutMs: 5000,
        sourceKind: "guide",
      },
    ];

    const results = await extractCardEnrichment("run-1", [], jobs, (event) => {
      events.push(event.type);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["started", "live_url", "completed"]);
    expect(results).toHaveLength(1);
    expect(results[0]?.cardId).toBe("card-1");
    expect(results[0]?.quote).toBe("Finished checking Example.");
  });
});
