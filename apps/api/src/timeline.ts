import OpenAI from "openai";
import type { BusyWindow, DiscoveryCard, TimelineNode } from "@planit/shared-schema";
import { z } from "zod";

import { config } from "./config";

const minutesPerDayStart = 9 * 60;
const minutesPerDayEnd = 18 * 60 + 30;

const openaiClient = config.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: config.OPENAI_API_KEY,
    })
  : null;

const timelineResponseSchema = z.object({
  nodes: z.array(
    z.object({
      cardId: z.string(),
      day: z.number().int().positive(),
      startTime: z.string(),
      endTime: z.string(),
      durationMinutes: z.number().int().positive(),
      travelMinutesFromPrevious: z.number().int().nonnegative(),
      note: z.string(),
      logistics: z.string(),
    }),
  ),
});

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatTime(totalMinutes: number) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function haversineMinutes(a?: DiscoveryCard["coords"], b?: DiscoveryCard["coords"]) {
  if (!a || !b) {
    return 25;
  }

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const radiusKm = 6371;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const distance = 2 * radiusKm * Math.asin(Math.sqrt(haversine));
  return Math.max(12, Math.round(distance * 2.4));
}

function shiftForBusyWindows(currentDate: Date, startMinutes: number, busyWindows: BusyWindow[]) {
  const key = dayKey(currentDate);
  let nextStart = startMinutes;

  for (const window of busyWindows.filter((entry) => entry.date === key)) {
    const busyStart = parseTime(window.startTime);
    const busyEnd = parseTime(window.endTime);

    if (nextStart >= busyStart && nextStart < busyEnd) {
      nextStart = busyEnd;
    }
  }

  return nextStart;
}

function shiftForOpeningHours(card: DiscoveryCard, dayMinutes: number, dayName: string) {
  const matchingWindow = card.openingHours?.find((window) => window.days.includes(dayName as never));

  if (!matchingWindow) {
    return dayMinutes;
  }

  return Math.max(dayMinutes, parseTime(matchingWindow.open));
}

function maybeRollToNextDay(currentDate: Date, startMinutes: number) {
  if (startMinutes <= minutesPerDayEnd) {
    return { currentDate, startMinutes };
  }

  const nextDate = new Date(currentDate);
  nextDate.setDate(nextDate.getDate() + 1);
  return {
    currentDate: nextDate,
    startMinutes: minutesPerDayStart,
  };
}

function buildTimelineFallback(
  cards: DiscoveryCard[],
  dates?: { start?: string; end?: string },
  busyWindows: BusyWindow[] = [],
) {
  const startDate = dates?.start ? new Date(dates.start) : new Date("2026-06-12T09:00:00.000Z");
  const nodes: TimelineNode[] = [];
  let currentDate = new Date(startDate);
  let cursorMinutes = minutesPerDayStart;
  let previousCard: DiscoveryCard | undefined;

  for (const [index, card] of cards.entries()) {
    const dayName = currentDate
      .toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
      .toLowerCase() as "mon";
    const travelMinutes = haversineMinutes(previousCard?.coords, card.coords);
    cursorMinutes += index === 0 ? 0 : travelMinutes;
    cursorMinutes = shiftForBusyWindows(currentDate, cursorMinutes, busyWindows);
    cursorMinutes = shiftForOpeningHours(card, cursorMinutes, dayName);

    const rolled = maybeRollToNextDay(currentDate, cursorMinutes + card.recommendedDurationMinutes);
    currentDate = rolled.currentDate;
    cursorMinutes = rolled.startMinutes;

    const endMinutes = Math.min(cursorMinutes + card.recommendedDurationMinutes, minutesPerDayEnd);

    nodes.push({
      id: `timeline-${card.id}`,
      cardId: card.id,
      title: card.title,
      bucket: card.bucket,
      day: Math.floor((currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      startTime: formatTime(cursorMinutes),
      endTime: formatTime(endMinutes),
      durationMinutes: card.recommendedDurationMinutes,
      travelMinutesFromPrevious: index === 0 ? 0 : travelMinutes,
      note: card.summary,
      logistics:
        index === 0
          ? "Start with a low-friction stop so the day feels manageable."
          : `Travel about ${travelMinutes} minutes from the previous stop and re-check hours before leaving.`,
      warnings: card.warnings,
      priceSummary: card.priceSummary,
      coords: card.coords,
    });

    previousCard = card;
    cursorMinutes = endMinutes + 20;
  }

  return nodes;
}

function sanitizeJsonBlock(value: string) {
  const trimmed = value.trim();
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");

  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  return trimmed;
}

async function buildTimelineWithOpenAi(
  cards: DiscoveryCard[],
  dates?: { start?: string; end?: string },
  busyWindows: BusyWindow[] = [],
) {
  if (!openaiClient || process.env.VITEST) {
    return null;
  }

  try {
    const response = await Promise.race([
      openaiClient.responses.create({
        model: config.OPENAI_SYNTH_MODEL,
        input: [
          {
            role: "system",
            content:
              "You are creating a polished mock itinerary for a trip-planning UI. Return strict JSON only. Keep the user-selected order. Produce a realistic, readable timeline with plausible times, simple logistics notes, and feasible day grouping. Do not invent extra stops.",
          },
          {
            role: "user",
            content: JSON.stringify({
              dates,
              busyWindows,
              dayStart: "09:00",
              dayEnd: "18:30",
              cards: cards.map((card) => ({
                cardId: card.id,
                title: card.title,
                bucket: card.bucket,
                summary: card.summary,
                durationMinutes: card.recommendedDurationMinutes,
                coords: card.coords,
                warnings: card.warnings,
                openingHours: card.openingHours,
              })),
              output: {
                nodes: [
                  {
                    cardId: "selected card id",
                    day: 1,
                    startTime: "09:30",
                    endTime: "11:00",
                    durationMinutes: 90,
                    travelMinutesFromPrevious: 0,
                    note: "one short note",
                    logistics: "one short logistics line",
                  },
                ],
              },
            }),
          },
        ],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timeline openai timed out after ${config.OPENAI_STEP_TIMEOUT_MS}ms`)), config.OPENAI_STEP_TIMEOUT_MS),
      ),
    ]);

    const parsed = timelineResponseSchema.parse(JSON.parse(sanitizeJsonBlock(response.output_text ?? "")));
    const byCardId = new Map(cards.map((card) => [card.id, card] as const));

    const mappedNodes: Array<TimelineNode | null> = parsed.nodes.map((node) => {
        const card = byCardId.get(node.cardId);

        if (!card) {
          return null;
        }

        return {
          id: `timeline-${card.id}`,
          cardId: card.id,
          title: card.title,
          bucket: card.bucket,
          day: node.day,
          startTime: node.startTime,
          endTime: node.endTime,
          durationMinutes: node.durationMinutes,
          travelMinutesFromPrevious: node.travelMinutesFromPrevious,
          note: node.note,
          logistics: node.logistics,
          warnings: card.warnings,
          priceSummary: card.priceSummary,
          coords: card.coords,
        } satisfies TimelineNode;
      });

    return mappedNodes.filter((node): node is TimelineNode => node !== null);
  } catch {
    return null;
  }
}

export async function buildTimeline(
  cards: DiscoveryCard[],
  dates?: { start?: string; end?: string },
  busyWindows: BusyWindow[] = [],
) {
  const openAiNodes = await buildTimelineWithOpenAi(cards, dates, busyWindows);

  if (openAiNodes && openAiNodes.length === cards.length) {
    return openAiNodes;
  }

  return buildTimelineFallback(cards, dates, busyWindows);
}
