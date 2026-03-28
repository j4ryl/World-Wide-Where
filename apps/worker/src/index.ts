import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { extractionJobSchema, extractionResultSchema, type ExtractionJob, type ExtractionResult } from "@planit/shared-schema";
import { z } from "zod";

import { createDomainQueue } from "./queue";
import { normalizeFlightObservationToSgd, normalizeHotelObservationToSgd } from "./flight-currency";
import { simulateExtraction } from "./simulate";

const rootDir = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
dotenv.config({ path: path.join(rootDir, ".env") });

const envSchema = z.object({
  WORKER_PORT: z.coerce.number().default(3001),
  PUBLIC_APP_URL: z.string().url().default("http://localhost:5173"),
  WORKER_GLOBAL_CONCURRENCY: z.coerce.number().int().positive().default(4),
  WORKER_PER_DOMAIN_CONCURRENCY: z.coerce.number().int().positive().default(2),
  TINYFISH_API_KEY: z.string().optional(),
  TINYFISH_BASE_URL: z.string().url().default("https://agent.tinyfish.ai"),
  TINYFISH_BROWSER_PROFILE: z.enum(["lite", "stealth"]).default("stealth"),
  TINYFISH_PROXY_COUNTRY: z.string().optional(),
  TINYFISH_STEALTH: z.coerce.boolean().default(true),
});

const env = envSchema.parse(process.env);
const tinyfishProxyCountry = env.TINYFISH_PROXY_COUNTRY?.trim() ? env.TINYFISH_PROXY_COUNTRY.trim() : undefined;
const queue = createDomainQueue({
  maxConcurrent: env.WORKER_GLOBAL_CONCURRENCY,
  maxPerDomain: env.WORKER_PER_DOMAIN_CONCURRENCY,
});

const app = express();

const tinyfishSseEventSchema = z
  .object({
    status: z.string().optional(),
    result: z.unknown().optional(),
    final_result: z.unknown().optional(),
    current_url: z.string().optional(),
    url: z.string().optional(),
    message: z.string().optional(),
    stream_url: z.string().optional(),
    browser_stream_url: z.string().optional(),
    browser_url: z.string().optional(),
    run_id: z.string().optional(),
    error: z.unknown().optional(),
  })
  .passthrough();

const workerStreamEventSchema = z.object({
  type: z.enum(["started", "progress", "live_url", "completed", "fallback", "error"]),
  jobId: z.string(),
  cardId: z.string(),
  domain: z.string(),
  platform: z.string().optional(),
  providerStatus: z.string().optional(),
  message: z.string(),
  liveUrl: z.string().url().optional(),
  result: extractionResultSchema.optional(),
});

const tinyfishFlightObservationSchema = z.object({
  airline: z.string().optional(),
  seller: z.string().optional(),
  route: z.string().optional(),
  baseFare: z.string().optional(),
  totalFare: z.string().optional(),
  baggagePolicy: z.string().optional(),
  checkedBagPrice: z.string().optional(),
  boardingPolicy: z.string().optional(),
  mealPolicy: z.string().optional(),
  fareClass: z.string().optional(),
  preferencesMatched: z.array(z.string()).default([]),
  preferencesMissing: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});

const tinyfishHotelObservationSchema = z.object({
  propertyName: z.string().optional(),
  nightlyRate: z.string().optional(),
  totalStayPrice: z.string().optional(),
  breakfastIncluded: z.boolean().nullable().optional(),
  freeCancellation: z.boolean().nullable().optional(),
  payLaterAvailable: z.boolean().nullable().optional(),
  neighborhood: z.string().optional(),
  cancellationPolicy: z.string().optional(),
  roomType: z.string().optional(),
  preferencesMatched: z.array(z.string()).default([]),
  preferencesMissing: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});

function flattenResult(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenResult(entry));
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      flattenResult(entry).map((line) => `${key}: ${line}`),
    );
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  return [];
}

function tryParseJsonObject(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const candidates = [trimmed];
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");

  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // keep trying
    }
  }

  return null;
}

function extractFlightObservation(resultBody: unknown) {
  if (typeof resultBody === "string") {
    const parsed = tryParseJsonObject(resultBody);
    const observation = parsed ? tinyfishFlightObservationSchema.safeParse(parsed).data : undefined;
    return observation ? normalizeFlightObservationToSgd(observation) : undefined;
  }

  if (resultBody && typeof resultBody === "object") {
    const observation = tinyfishFlightObservationSchema.safeParse(resultBody).data;
    return observation ? normalizeFlightObservationToSgd(observation) : undefined;
  }

  return undefined;
}

function extractHotelObservation(resultBody: unknown) {
  if (typeof resultBody === "string") {
    const parsed = tryParseJsonObject(resultBody);
    const observation = parsed ? tinyfishHotelObservationSchema.safeParse(parsed).data : undefined;
    return observation ? normalizeHotelObservationToSgd(observation) : undefined;
  }

  if (resultBody && typeof resultBody === "object") {
    const observation = tinyfishHotelObservationSchema.safeParse(resultBody).data;
    return observation ? normalizeHotelObservationToSgd(observation) : undefined;
  }

  return undefined;
}

function hostnameMatches(allowedHostname: string, candidateUrl?: string) {
  if (!candidateUrl) {
    return true;
  }

  try {
    const hostname = new URL(candidateUrl).hostname;
    return hostname === allowedHostname || hostname.endsWith(`.${allowedHostname}`);
  } catch {
    return true;
  }
}

function toWorkerStreamEvent(
  job: ExtractionJob,
  event: z.infer<typeof tinyfishSseEventSchema>,
): z.infer<typeof workerStreamEventSchema>[] {
  const providerStatus = event.status?.toUpperCase();
  const liveUrl = event.browser_stream_url ?? event.stream_url ?? event.browser_url;
  const events: z.infer<typeof workerStreamEventSchema>[] = [];

  if (providerStatus === "STARTED") {
    events.push(
      workerStreamEventSchema.parse({
        type: "started",
        jobId: job.id,
        cardId: job.cardId,
        domain: job.domain,
        platform: job.platform,
        providerStatus,
        message: `Opened ${job.platform ?? job.domain} in a live browser session.`,
      }),
    );
  }

  if (liveUrl) {
    events.push(
      workerStreamEventSchema.parse({
        type: "live_url",
        jobId: job.id,
        cardId: job.cardId,
        domain: job.domain,
        platform: job.platform,
        providerStatus,
        liveUrl,
        message: `Live browser view is ready for ${job.platform ?? job.domain}.`,
      }),
    );
  }

  if (!["STARTED", "COMPLETED", "DONE", "SUCCESS"].includes(providerStatus ?? "")) {
    events.push(
      workerStreamEventSchema.parse({
        type: "progress",
        jobId: job.id,
        cardId: job.cardId,
        domain: job.domain,
        platform: job.platform,
        providerStatus,
        liveUrl,
        message:
          event.message?.trim() ||
          `Still checking ${job.platform ?? job.domain} in the browser.`,
      }),
    );
  }

  return events;
}

async function runTinyFishSse(
  job: ExtractionJob,
  onEvent?: (event: z.infer<typeof workerStreamEventSchema>) => void,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), job.timeoutMs);

  const response = await fetch(`${env.TINYFISH_BASE_URL}/v1/automation/run-sse`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.TINYFISH_API_KEY!,
    },
    body: JSON.stringify({
      url: job.url,
      goal: job.goal ?? job.promptHint,
      browser_profile: job.browserProfile ?? env.TINYFISH_BROWSER_PROFILE,
      proxy_config: {
        enabled: Boolean(job.proxyCountry ?? tinyfishProxyCountry),
        country_code: job.proxyCountry ?? tinyfishProxyCountry,
      },
    }),
    signal: controller.signal,
  });

  if (!response.ok) {
    clearTimeout(timeout);
    throw new Error(`TinyFish SSE start failed with ${response.status}`);
  }

  if (!response.body) {
    clearTimeout(timeout);
    throw new Error("TinyFish SSE response body missing.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let latestEvent: z.infer<typeof tinyfishSseEventSchema> | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        const dataLine = chunk
          .split("\n")
          .find((line) => line.startsWith("data:"))
          ?.replace(/^data:\s*/, "");

        if (!dataLine) {
          continue;
        }

        const parsed = tinyfishSseEventSchema.safeParse(JSON.parse(dataLine));

        if (!parsed.success) {
          continue;
        }

        latestEvent = parsed.data;

        for (const normalizedEvent of toWorkerStreamEvent(job, parsed.data)) {
          onEvent?.(normalizedEvent);
        }

        if (
          !hostnameMatches(job.domain, parsed.data.current_url) ||
          !hostnameMatches(job.domain, parsed.data.url)
        ) {
          throw new Error("TinyFish navigation drifted outside the allowed domain.");
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }

  if (!latestEvent) {
    throw new Error("TinyFish SSE finished without a usable event.");
  }

  return latestEvent;
}

function summarizeTinyFishRun(job: ExtractionJob, run: z.infer<typeof tinyfishSseEventSchema>): ExtractionResult {
  const resultBody = run.final_result ?? run.result ?? run.message;
  const flattened = flattenResult(resultBody).slice(0, 6);
  const primary = flattened[0] ?? `Finished checking ${job.domain}.`;
  const flightObservation = job.bucket === "flights" ? extractFlightObservation(resultBody) : undefined;
  const hotelObservation = job.bucket === "hotels" ? extractHotelObservation(resultBody) : undefined;
  const credibilitySignals = [
    job.sourceKind === "social"
      ? "Social source was captured in a browser flow instead of a static fetch."
      : "Public browser capture completed successfully.",
  ];

  if (job.browserProfile === "stealth") {
    credibilitySignals.push("This source normally needs a browser session, so static scraping is less reliable.");
  }

  if (job.bucket === "flights") {
    credibilitySignals.push("Use this as a public fare snapshot, not a guaranteed final checkout price.");
  }

  return extractionResultSchema.parse({
    jobId: job.id,
    cardId: job.cardId,
    quote: primary,
    warning:
      job.bucket === "flights"
        ? "Fare pages can change fast and aggregator ordering may still include sponsored placements."
        : undefined,
    verificationState: "live",
    details:
      flightObservation
        ? [
            flightObservation.baseFare ? `Base fare: ${flightObservation.baseFare}` : "",
            flightObservation.totalFare ? `Estimated total fare: ${flightObservation.totalFare}` : "",
            flightObservation.baggagePolicy ? `Baggage: ${flightObservation.baggagePolicy}` : "",
            flightObservation.checkedBagPrice ? `Checked bag: ${flightObservation.checkedBagPrice}` : "",
            ...flightObservation.notes.slice(0, 2),
          ].filter(Boolean)
        : hotelObservation
          ? [
              hotelObservation.nightlyRate ? `Nightly rate: ${hotelObservation.nightlyRate}` : "",
              hotelObservation.totalStayPrice ? `Total stay price: ${hotelObservation.totalStayPrice}` : "",
              hotelObservation.freeCancellation !== undefined && hotelObservation.freeCancellation !== null
                ? `Free cancellation: ${hotelObservation.freeCancellation ? "Yes" : "No"}`
                : "",
              hotelObservation.breakfastIncluded !== undefined && hotelObservation.breakfastIncluded !== null
                ? `Breakfast included: ${hotelObservation.breakfastIncluded ? "Yes" : "No"}`
                : "",
              hotelObservation.payLaterAvailable !== undefined && hotelObservation.payLaterAvailable !== null
                ? `Pay later: ${hotelObservation.payLaterAvailable ? "Yes" : "No"}`
                : "",
              ...hotelObservation.notes.slice(0, 2),
            ].filter(Boolean)
        : flattened,
    flightObservation,
    hotelObservation,
    credibilitySignals,
    sourceSummary: `${job.platform ?? job.domain}: ${primary}`,
  });
}

async function executeJob(job: ExtractionJob) {
  if (!env.TINYFISH_API_KEY) {
    return simulateExtraction(job);
  }

  try {
    const completedRun = await runTinyFishSse(job);
    return summarizeTinyFishRun(job, completedRun);
  } catch {
    return simulateExtraction(job);
  }
}

async function executeJobStreaming(
  job: ExtractionJob,
  onEvent: (event: z.infer<typeof workerStreamEventSchema>) => void,
) {
  if (!env.TINYFISH_API_KEY) {
    const result = await simulateExtraction(job);
    onEvent(
      workerStreamEventSchema.parse({
        type: "fallback",
        jobId: job.id,
        cardId: job.cardId,
        domain: job.domain,
        platform: job.platform,
        providerStatus: "FALLBACK",
        message: `Using the backup extractor for ${job.platform ?? job.domain}.`,
        result,
      }),
    );
    return result;
  }

  try {
    const completedRun = await runTinyFishSse(job, onEvent);
    const result = summarizeTinyFishRun(job, completedRun);
    onEvent(
      workerStreamEventSchema.parse({
        type: "completed",
        jobId: job.id,
        cardId: job.cardId,
        domain: job.domain,
        platform: job.platform,
        providerStatus: completedRun.status?.toUpperCase() ?? "COMPLETED",
        message: `Finished checking ${job.platform ?? job.domain}.`,
        liveUrl: completedRun.browser_stream_url ?? completedRun.stream_url ?? completedRun.browser_url,
        result,
      }),
    );
    return result;
  } catch (error) {
    const result = await simulateExtraction(job);
    onEvent(
      workerStreamEventSchema.parse({
        type: "fallback",
        jobId: job.id,
        cardId: job.cardId,
        domain: job.domain,
        platform: job.platform,
        providerStatus: "FALLBACK",
        message:
          error instanceof Error
            ? `Live browser extraction stalled on ${job.platform ?? job.domain}, so the backup extractor took over.`
            : `Live browser extraction stalled on ${job.platform ?? job.domain}, so the backup extractor took over.`,
        result,
      }),
    );
    return result;
  }
}

app.use(
  cors({
    origin: env.PUBLIC_APP_URL,
  }),
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "worker",
    globalConcurrency: env.WORKER_GLOBAL_CONCURRENCY,
    perDomainConcurrency: env.WORKER_PER_DOMAIN_CONCURRENCY,
  });
});

app.post("/tasks/extract", async (req, res) => {
  const { jobs } = z
    .object({
      jobs: z.array(extractionJobSchema),
    })
    .parse(req.body);

  const results = await Promise.all(
    jobs.map((job) =>
      queue.push({
        domain: job.domain,
        run: async () => executeJob(job),
      }),
    ),
  );

  res.json({ results });
});

app.post("/tasks/extract-stream", async (req, res) => {
  const { job } = z
    .object({
      job: extractionJobSchema,
    })
    .parse(req.body);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: z.infer<typeof workerStreamEventSchema>) => {
    res.write(`data: ${JSON.stringify(workerStreamEventSchema.parse(event))}\n\n`);
  };

  try {
    await queue.push({
      domain: job.domain,
      run: async () => executeJobStreaming(job, send),
    });
  } catch (error) {
    send(
      workerStreamEventSchema.parse({
        type: "error",
        jobId: job.id,
        cardId: job.cardId,
        domain: job.domain,
        platform: job.platform,
        providerStatus: "ERROR",
        message: error instanceof Error ? error.message : "Worker extraction failed.",
      }),
    );
  } finally {
    res.end();
  }
});

app.listen(env.WORKER_PORT, () => {
  console.log(`World Wide Where worker listening on http://localhost:${env.WORKER_PORT}`);
});
