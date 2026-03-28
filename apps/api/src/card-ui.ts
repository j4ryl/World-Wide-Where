import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { DiscoveryCard } from "@planit/shared-schema";
import { z } from "zod";

import { config } from "./config";

const openaiClient = config.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: config.OPENAI_API_KEY,
    })
  : null;

const translatedCardsSchema = z.object({
  cards: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
      whyItFits: z.string().nullable().default(null),
      sourceLabel: z.string(),
      trustSummary: z.string(),
      warnings: z.array(z.string()),
    }),
  ).max(12),
});

const translatedSingleCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  whyItFits: z.string().nullable().default(null),
  sourceLabel: z.string(),
  trustSummary: z.string(),
  warnings: z.array(z.string()),
});

function cardPlanningStage(bucket: DiscoveryCard["bucket"]): DiscoveryCard["planningStage"] {
  switch (bucket) {
    case "food-hidden-gems":
      return "places";
    case "flights":
    case "hotels":
    case "car-rental":
    case "local-transport":
      return "logistics";
    case "local-advice":
      return "advice";
  }
}

function sanitizeImageUrl(url: string) {
  if (!url || url.startsWith("data:")) {
    return null;
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol === "http:") {
      parsed.protocol = "https:";
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function needsEnglishLocalization(card: DiscoveryCard) {
  const text = [card.title, card.summary, card.sourceLabel, card.whyItFits ?? ""].join(" ");
  return /[^\x00-\x7F]/.test(text);
}

function stillNeedsEnglish(text: string | null | undefined) {
  return Boolean(text && /[^\x00-\x7F]/.test(text));
}

async function withOpenAiTimeout<T>(promise: Promise<T>, label: string) {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${config.OPENAI_STEP_TIMEOUT_MS}ms`)), config.OPENAI_STEP_TIMEOUT_MS),
    ),
  ]);
}

function parseJsonObject<T>(value: string, schema: z.ZodSchema<T>) {
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
      return schema.parse(JSON.parse(candidate));
    } catch {
      // keep trying
    }
  }

  return null;
}

function buildTranslationPayload(cards: DiscoveryCard[]) {
  return {
    cards: cards.map((card) => ({
      id: card.id,
      title: card.title,
      summary: card.summary,
      whyItFits: card.whyItFits,
      sourceLabel: card.sourceLabel,
      trustSummary: card.trustSummary,
      warnings: card.warnings,
    })),
  };
}

async function translateBatchWithStructuredParse(cards: DiscoveryCard[]) {
  if (!openaiClient || cards.length === 0) {
    return null;
  }

  const response = await withOpenAiTimeout(
    openaiClient.responses.parse({
      model: config.OPENAI_SYNTH_MODEL,
      input: [
        {
          role: "system",
          content:
            "Translate travel card copy into concise, natural English for a consumer UI. Keep real place names accurate. Translate Chinese, Thai, Malay, and mixed-language titles into clean English. Do not invent details. Return JSON only.",
        },
        {
          role: "user",
          content: JSON.stringify(buildTranslationPayload(cards)),
        },
      ],
      text: {
        format: zodTextFormat(translatedCardsSchema, "translated_cards"),
      },
    }),
    "localizeCards:parse",
  );

  if (response.output_parsed) {
    return translatedCardsSchema.parse(response.output_parsed);
  }

  return parseJsonObject(response.output_text ?? "", translatedCardsSchema);
}

async function translateBatchWithJsonFallback(cards: DiscoveryCard[]) {
  if (!openaiClient || cards.length === 0) {
    return null;
  }

  const response = await withOpenAiTimeout(
    openaiClient.responses.create({
      model: config.OPENAI_SYNTH_MODEL,
      input: [
        {
          role: "system",
          content:
            "Translate each travel card into natural English for a consumer UI. Keep exact place names and brand names accurate. Return only valid JSON matching this shape: {\"cards\":[{\"id\":\"...\",\"title\":\"...\",\"summary\":\"...\",\"whyItFits\":\"... or null\",\"sourceLabel\":\"...\",\"trustSummary\":\"...\",\"warnings\":[\"...\"]}]}.",
        },
        {
          role: "user",
          content: JSON.stringify(buildTranslationPayload(cards)),
        },
      ],
    }),
    "localizeCards:create",
  );

  return parseJsonObject(response.output_text ?? "", translatedCardsSchema);
}

async function translateCards(cards: DiscoveryCard[]) {
  try {
    const parsed = await translateBatchWithStructuredParse(cards);

    if (parsed) {
      return parsed;
    }
  } catch {
    // Fallback below.
  }

  try {
    return await translateBatchWithJsonFallback(cards);
  } catch {
    return null;
  }
}

async function translateSingleCard(card: DiscoveryCard) {
  if (!openaiClient) {
    return null;
  }

  const response = await withOpenAiTimeout(
    openaiClient.responses.create({
      model: config.OPENAI_SYNTH_MODEL,
      input: [
        {
          role: "system",
          content:
            "Translate this travel card into clean, natural English for a consumer UI. Keep the actual place name accurate. Return only valid JSON with keys id, title, summary, whyItFits, sourceLabel, trustSummary, warnings.",
        },
        {
          role: "user",
          content: JSON.stringify(buildTranslationPayload([card]).cards[0]),
        },
      ],
    }),
    `localizeCards:single:${card.id}`,
  );

  return parseJsonObject(response.output_text ?? "", translatedSingleCardSchema);
}

async function localizeCards(cards: DiscoveryCard[]) {
  if (!openaiClient) {
    return cards;
  }

  const candidates = cards.filter(needsEnglishLocalization).slice(0, 12);

  if (candidates.length === 0) {
    return cards;
  }

  try {
    const parsed = await translateCards(candidates);

    if (!parsed) {
      return cards;
    }

    const translationMap = new Map(parsed.cards.map((card) => [card.id, card]));
    const localized = cards.map((card) => {
      const translated = translationMap.get(card.id);

      if (!translated) {
        return card;
      }

      return {
        ...card,
        originalTitle: card.originalTitle ?? card.title,
        originalSummary: card.originalSummary ?? card.summary,
        originalSourceLabel: card.originalSourceLabel ?? card.sourceLabel,
        title: translated.title,
        summary: translated.summary,
        whyItFits: translated.whyItFits ?? card.whyItFits,
        sourceLabel: translated.sourceLabel,
        trustSummary: translated.trustSummary,
        warnings: translated.warnings.length > 0 ? translated.warnings : card.warnings,
      };
    });

    const unresolved = localized.filter(
      (card) =>
        needsEnglishLocalization(card) &&
        (stillNeedsEnglish(card.title) || stillNeedsEnglish(card.sourceLabel)),
    );

    if (unresolved.length === 0) {
      return localized;
    }

    const repairedEntries = await Promise.all(
      unresolved.map(async (card) => {
        try {
          const translated = await translateSingleCard(card);
          return translated ? [card.id, translated] : null;
        } catch {
          return null;
        }
      }),
    );

    const repairedMap = new Map(
      repairedEntries.filter((entry): entry is [string, z.infer<typeof translatedSingleCardSchema>] => Boolean(entry)),
    );

    return localized.map((card) => {
      const repaired = repairedMap.get(card.id);

      if (!repaired) {
        return card;
      }

      return {
        ...card,
        originalTitle: card.originalTitle ?? card.title,
        originalSummary: card.originalSummary ?? card.summary,
        originalSourceLabel: card.originalSourceLabel ?? card.sourceLabel,
        title: repaired.title,
        summary: repaired.summary,
        whyItFits: repaired.whyItFits ?? card.whyItFits,
        sourceLabel: repaired.sourceLabel,
        trustSummary: repaired.trustSummary,
        warnings: repaired.warnings.length > 0 ? repaired.warnings : card.warnings,
      };
    });
  } catch {
    return cards;
  }
}

export async function prepareCardsForUi(cards: DiscoveryCard[]) {
  const normalized = cards.map((card) => ({
    ...card,
    planningStage: card.planningStage ?? cardPlanningStage(card.bucket),
    imageUrls: [...new Set(card.imageUrls.map(sanitizeImageUrl).filter((url): url is string => Boolean(url)))],
  }));
  const localized = await localizeCards(normalized);
  return localized;
}
