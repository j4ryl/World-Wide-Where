import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  flightWatchDemoResultSchema,
  sentryAlertSchema,
  type SentryAlert,
  type SentryScope,
} from "@planit/shared-schema";
import { z } from "zod";

import { rootDir } from "./config";

const sentrySeedSchema = z.object({
  alerts: z.array(
    sentryAlertSchema.extend({
      scope: z.enum(["prebooking", "postplanning"]),
      origin: z.string(),
      destination: z.string(),
    }),
  ),
});

let sentryPromise:
  | Promise<Array<SentryAlert & { scope: "prebooking" | "postplanning"; origin: string; destination: string }>>
  | undefined;

async function loadSentryAlerts() {
  if (!sentryPromise) {
    sentryPromise = fs
      .readFile(path.join(rootDir, "data", "sentry.seed.json"), "utf8")
      .then((contents) => JSON.parse(contents))
      .then((data) => sentrySeedSchema.parse(data).alerts);
  }

  return sentryPromise;
}

export async function findDemoSentryAlerts(origin: string, destination: string) {
  return findDemoSentryAlertsByScope(origin, destination);
}

export async function findDemoSentryAlertsByScope(
  origin: string,
  destination: string,
  scope?: SentryScope,
) {
  const alerts = await loadSentryAlerts();
  const normalizedOrigin = origin.toLowerCase();
  const normalizedDestination = destination.toLowerCase();

  return alerts.filter(
    (alert) =>
      alert.origin.toLowerCase() === normalizedOrigin &&
      alert.destination.toLowerCase() === normalizedDestination &&
      (!scope || alert.scope === scope),
  );
}

export async function createFlightWatchDemo(origin: string, destination: string, title: string) {
  const [alert] = await findDemoSentryAlertsByScope(origin, destination, "prebooking");

  return flightWatchDemoResultSchema.parse({
    watchId: randomUUID(),
    status: "watching",
    title,
    summary: `Watching public fares from ${origin} to ${destination}. The app will surface a simpler book-now signal when a lower public price shows up.`,
    recommendedChannel: "Telegram is the best demo channel for this because it is fast to wire up and easy for judges to try.",
    alert,
  });
}
