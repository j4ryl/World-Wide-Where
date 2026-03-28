import cors from "cors";
import express from "express";
import {
  bookingLinkResultSchema,
  discoverRequestSchema,
  flightWatchDemoRequestSchema,
  hotelComparisonRequestSchema,
  runExpandRequestSchema,
  runStreamMessageSchema,
  sentryDemoRequestSchema,
  timelineRecalculateRequestSchema,
  timelineRequestSchema,
} from "@planit/shared-schema";
import { z } from "zod";

import { config } from "./config";
import { compareHotelAcrossPlatforms } from "./hotel-compare";
import { executeDiscoveryRun, expandDiscoveryRun } from "./pipeline";
import { runsStore } from "./runs-store";
import { createFlightWatchDemo, findDemoSentryAlertsByScope } from "./sentry";
import { findCardsByIds } from "./source-registry";
import { buildTimeline } from "./timeline";

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export async function handleDiscover(body: unknown) {
  const request = discoverRequestSchema.parse(body);
  const run = runsStore.create({
    ...request,
    mode: request.mode || config.DISCOVERY_MODE,
  });

  void executeDiscoveryRun(run.id, request);

  return { status: 202 as const, body: { runId: run.id } };
}

export function handleGetRun(runId: string) {
  const run = runsStore.get(runId);

  if (!run) {
    return { status: 404 as const, body: { message: "Run not found" } };
  }

  return { status: 200 as const, body: run };
}

export async function handleExpandRun(runId: string, body: unknown) {
  const run = runsStore.get(runId);

  if (!run) {
    return { status: 404 as const, body: { message: "Run not found" } };
  }

  const request = runExpandRequestSchema.parse(body);
  runsStore.patchRequest(runId, {
    flightPreferences: request.flightPreferences,
    hotelPreferences: request.hotelPreferences,
  });
  void expandDiscoveryRun(runId, request.buckets, request.selectedCardIds);

  return { status: 202 as const, body: { runId, buckets: request.buckets } };
}

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: config.PUBLIC_APP_URL,
    }),
  );
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "api" });
  });

  app.get("/api/image-proxy", async (req, res) => {
    const sourceUrl = z.string().url().safeParse(req.query.src);

    if (!sourceUrl.success) {
      res.status(400).json({ message: "Invalid image URL" });
      return;
    }

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(sourceUrl.data);
    } catch {
      res.status(400).json({ message: "Invalid image URL" });
      return;
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const isAllowedGoogleImage =
      hostname === "maps.googleapis.com" ||
      hostname === "places.googleapis.com" ||
      hostname.endsWith(".googleusercontent.com");

    if (!isAllowedGoogleImage) {
      res.status(403).json({ message: "Image host not allowed" });
      return;
    }

    try {
      const response = await fetch(parsedUrl, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3.1 Safari/605.1.15",
          accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          referer: config.PUBLIC_APP_URL,
        },
      });

      if (!response.ok) {
        res.status(response.status).end();
        return;
      }

      const contentType = response.headers.get("content-type") ?? "image/jpeg";
      const cacheControl = response.headers.get("cache-control") ?? "public, max-age=86400";
      const arrayBuffer = await response.arrayBuffer();

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", cacheControl);
      res.send(Buffer.from(arrayBuffer));
    } catch {
      res.status(502).json({ message: "Image fetch failed" });
    }
  });

  app.post("/api/discover", async (req, res) => {
    const response = await handleDiscover(req.body);
    res.status(response.status).json(response.body);
  });

  app.get("/api/runs/:runId", (req, res) => {
    const response = handleGetRun(req.params.runId);
    res.status(response.status).json(response.body);
  });

  app.post("/api/runs/:runId/expand", async (req, res) => {
    const response = await handleExpandRun(req.params.runId, req.body);
    res.status(response.status).json(response.body);
  });

  app.get("/api/runs/:runId/stream", (req, res) => {
    const run = runsStore.get(req.params.runId);

    if (!run) {
      res.status(404).end();
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = () => {
      const latestRun = runsStore.get(req.params.runId);
      const lastEvent = latestRun?.events.at(-1);

      if (!latestRun || !lastEvent) {
        return;
      }

      const payload = runStreamMessageSchema.parse({
        event: lastEvent,
        run: latestRun,
      });
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send();

    const unsubscribe = runsStore.subscribe(req.params.runId, (nextRun, event) => {
      const payload = runStreamMessageSchema.parse({
        event,
        run: nextRun,
      });
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    });

    const interval = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(interval);
      unsubscribe();
      res.end();
    });
  });

  app.post("/api/timeline", async (req, res) => {
    const request = timelineRequestSchema.parse(req.body);
    const cards = request.runId
      ? runsStore.findCards(request.runId, request.selectedCardIds)
      : await findCardsByIds(request.selectedCardIds);
    const orderedCards = request.selectedCardIds
      .map((cardId) => cards.find((card) => card.id === cardId))
      .filter(isDefined);
    const nodes = await buildTimeline(orderedCards, request.dates, request.busyWindows);

    res.json({ nodes });
  });

  app.post("/api/timeline/recalculate", async (req, res) => {
    const request = timelineRecalculateRequestSchema.parse(req.body);
    const cardIds = request.nodes.map((node) => node.cardId);
    const cards = request.runId ? runsStore.findCards(request.runId, cardIds) : await findCardsByIds(cardIds);
    const orderedCards = request.nodes
      .map((node) => cards.find((card) => card.id === node.cardId))
      .filter(isDefined);
    const nodes = await buildTimeline(orderedCards, request.dates, request.busyWindows);

    res.json({ nodes });
  });

  app.post("/api/book-link", async (req, res) => {
    const body = flightWatchDemoRequestSchema.extend({ runId: z.string().optional() }).pick({
      cardId: true,
      runId: true,
    }).parse(req.body);
    const card = body.runId ? runsStore.findCard(body.runId, body.cardId) : (await findCardsByIds([body.cardId]))[0];

    if (!card?.bookingLink) {
      res.status(404).json({ message: "Booking link not found" });
      return;
    }

    const result = bookingLinkResultSchema.parse({
      title: card.title,
      url: card.bookingLink,
      providerLabel: card.sourceLabel,
      notes: [
        "This link opens the provider page directly.",
        "Re-check dates, baggage rules, and weather-sensitive transport before paying.",
      ],
      preparedAt: new Date().toISOString(),
    });

    res.json(result);
  });

  app.post("/api/hotel-compare", async (req, res) => {
    const body = hotelComparisonRequestSchema.parse(req.body);
    const result = await compareHotelAcrossPlatforms(
      body.hotelName,
      body.destination,
      body.hotelPreferences,
      body.dates,
    );

    res.json(result);
  });

  app.post("/api/sentry/demo", async (req, res) => {
    const body = sentryDemoRequestSchema.parse(req.body);

    const alerts = await findDemoSentryAlertsByScope(body.origin, body.destination, body.scope);
    res.json({ alerts });
  });

  app.post("/api/flight-watch/demo", async (req, res) => {
    const body = flightWatchDemoRequestSchema.parse(req.body);
    const watch = await createFlightWatchDemo(body.origin, body.destination, body.title);
    res.json(watch);
  });

  return app;
}
