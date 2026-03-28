import fs from "node:fs/promises";
import path from "node:path";

import {
  discoveryCardSchema,
  type DiscoveryCard,
  sourceCandidateSchema,
  type SourceCandidate,
} from "@planit/shared-schema";
import { z } from "zod";

import { rootDir } from "./config";

const sourcesPath = path.join(rootDir, "data", "sources.json");
const cachePath = path.join(rootDir, "data", "cache.seed.json");

const seedCacheSchema = z.object({
  destinations: z.array(
    z.object({
      id: z.string(),
      region: z.string(),
      match: z.array(z.string()),
      samplePrompt: z.string(),
      cards: z.array(discoveryCardSchema),
    }),
  ),
});

export type DestinationSeed = z.infer<typeof seedCacheSchema>["destinations"][number];

let sourcesPromise: Promise<SourceCandidate[]> | undefined;
let cachePromise: Promise<DestinationSeed[]> | undefined;

export function loadSourceRegistry() {
  if (!sourcesPromise) {
    sourcesPromise = fs
      .readFile(sourcesPath, "utf8")
      .then((contents) => JSON.parse(contents))
      .then((data) => z.array(sourceCandidateSchema).parse(data));
  }

  return sourcesPromise;
}

export function loadSeedDestinations() {
  if (!cachePromise) {
    cachePromise = fs
      .readFile(cachePath, "utf8")
      .then((contents) => JSON.parse(contents))
      .then((data) => seedCacheSchema.parse(data).destinations);
  }

  return cachePromise;
}

export async function matchSeedDestination(prompt: string, destination: string) {
  const destinations = await loadSeedDestinations();
  const haystack = `${destination} ${prompt}`.toLowerCase();

  return destinations.find((entry) =>
    entry.match.some((needle) => haystack.includes(needle.toLowerCase())),
  );
}

export async function findCardsByIds(cardIds: string[]) {
  const destinations = await loadSeedDestinations();
  const allCards = destinations.flatMap((destination) => destination.cards);
  const cardMap = new Map(allCards.map((card) => [card.id, card] satisfies [string, DiscoveryCard]));

  return cardIds.map((cardId) => cardMap.get(cardId)).filter(Boolean) as DiscoveryCard[];
}
