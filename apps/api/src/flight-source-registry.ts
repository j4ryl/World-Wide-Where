import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { rootDir } from "./config";

const flightSourcesPath = path.join(rootDir, "data", "flight-sources.json");

export const flightSourceTypeSchema = z.enum([
  "official-airline",
  "aggregator",
  "metasearch",
  "budget-airline",
  "regional-airline",
]);

export const flightSourceRegistryEntrySchema = z.object({
  id: z.string(),
  providerName: z.string(),
  domain: z.string(),
  baseUrl: z.string().url(),
  type: flightSourceTypeSchema,
  priority: z.number().int().nonnegative().default(100),
  enabled: z.boolean().default(true),
  browserRequired: z.boolean().default(true),
  loginRequired: z.boolean().default(false),
  regions: z.array(z.string()).default(["global"]),
  routeNotes: z.array(z.string()).default([]),
  defaultGoal: z.string(),
});

export type FlightSourceRegistryEntry = z.infer<typeof flightSourceRegistryEntrySchema>;

let flightSourcesPromise: Promise<FlightSourceRegistryEntry[]> | undefined;

export function loadFlightSourceRegistry() {
  if (!flightSourcesPromise) {
    flightSourcesPromise = fs
      .readFile(flightSourcesPath, "utf8")
      .then((contents) => JSON.parse(contents))
      .then((data) => z.array(flightSourceRegistryEntrySchema).parse(data))
      .then((entries) => entries.filter((entry) => entry.enabled))
      .then((entries) => entries.sort((left, right) => left.priority - right.priority));
  }

  return flightSourcesPromise;
}
