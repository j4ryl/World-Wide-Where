import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  DiscoverRequest,
  DiscoveryCard,
  DiscoveryRunSnapshot,
  RunEvent,
  SearchPlan,
} from "@planit/shared-schema";
import { discoveryRunSnapshotSchema } from "@planit/shared-schema";

import { rootDir } from "./config";

type RunListener = (run: DiscoveryRunSnapshot, event: RunEvent) => void;

const RUN_PERSIST_LIMIT = 40;
const runsCachePath = process.env.VITEST
  ? path.join(os.tmpdir(), "planit-runs-cache.test.json")
  : path.join(rootDir, "data", "runs.cache.json");

class RunsStore {
  private runs = new Map<string, DiscoveryRunSnapshot>();
  private listeners = new Map<string, Set<RunListener>>();

  constructor() {
    this.loadFromDisk();
  }

  clear() {
    this.runs.clear();
    this.listeners.clear();
    this.persist();
  }

  create(request: DiscoverRequest) {
    const id = randomUUID();
    const run: DiscoveryRunSnapshot = {
      id,
      status: "queued",
      request,
      cards: [],
      events: [],
      updatedAt: new Date().toISOString(),
    };

    this.runs.set(id, run);
    this.persist();
    return run;
  }

  get(runId: string) {
    return this.runs.get(runId);
  }

  findCards(runId: string, cardIds: string[]) {
    const run = this.runs.get(runId);

    if (!run) {
      return [];
    }

    const byId = new Map(run.cards.map((card) => [card.id, card] as const));
    return cardIds.map((cardId) => byId.get(cardId)).filter(Boolean) as DiscoveryCard[];
  }

  findCard(runId: string, cardId: string) {
    return this.runs.get(runId)?.cards.find((card) => card.id === cardId);
  }

  updatePlan(runId: string, plan: SearchPlan, parsedSummary: string) {
    const run = this.mustGet(runId);
    run.plan = plan;
    run.parsedSummary = parsedSummary;
    run.status = "running";
    run.updatedAt = new Date().toISOString();
    this.persist();
  }

  patchRequest(runId: string, patch: Partial<DiscoverRequest>) {
    const run = this.mustGet(runId);
    run.request = {
      ...run.request,
      ...patch,
    };
    run.updatedAt = new Date().toISOString();
    this.persist();
  }

  upsertCards(runId: string, incomingCards: DiscoveryCard[]) {
    const run = this.mustGet(runId);
    const cardsById = new Map(run.cards.map((card) => [card.id, card] as const));

    for (const card of incomingCards) {
      cardsById.set(card.id, card);
    }

    run.cards = [...cardsById.values()];
    run.updatedAt = new Date().toISOString();
    this.persist();
  }

  appendEvent(runId: string, event: Omit<RunEvent, "id" | "timestamp">) {
    const run = this.mustGet(runId);
    const fullEvent: RunEvent = {
      ...event,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    run.events = [...run.events, fullEvent];
    run.updatedAt = new Date().toISOString();
    this.persist();
    this.emit(runId, fullEvent);
    return fullEvent;
  }

  markCompleted(runId: string) {
    const run = this.mustGet(runId);
    run.status = "completed";
    run.updatedAt = new Date().toISOString();
    this.persist();
  }

  markFailed(runId: string) {
    const run = this.mustGet(runId);
    run.status = "failed";
    run.updatedAt = new Date().toISOString();
    this.persist();
  }

  subscribe(runId: string, listener: RunListener) {
    const group = this.listeners.get(runId) ?? new Set<RunListener>();
    group.add(listener);
    this.listeners.set(runId, group);

    return () => {
      const current = this.listeners.get(runId);

      if (!current) {
        return;
      }

      current.delete(listener);

      if (current.size === 0) {
        this.listeners.delete(runId);
      }
    };
  }

  private mustGet(runId: string) {
    const run = this.runs.get(runId);

    if (!run) {
      throw new Error(`Unknown run: ${runId}`);
    }

    return run;
  }

  private emit(runId: string, event: RunEvent) {
    const run = this.mustGet(runId);
    const listeners = this.listeners.get(runId);

    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(run, event);
    }
  }

  private loadFromDisk() {
    try {
      if (!fs.existsSync(runsCachePath)) {
        return;
      }

      const contents = fs.readFileSync(runsCachePath, "utf8");

      if (!contents.trim()) {
        return;
      }

      const parsed = discoveryRunSnapshotSchema.array().parse(JSON.parse(contents));

      this.runs = new Map(parsed.map((run) => [run.id, run] as const));
    } catch {
      this.runs = new Map();
    }
  }

  private persist() {
    try {
      const runs = [...this.runs.values()]
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, RUN_PERSIST_LIMIT);

      fs.mkdirSync(path.dirname(runsCachePath), { recursive: true });
      fs.writeFileSync(runsCachePath, JSON.stringify(runs, null, 2));
    } catch {
      // Demo-safe persistence only. A write failure should not take the API down.
    }
  }
}

export const runsStore = new RunsStore();
