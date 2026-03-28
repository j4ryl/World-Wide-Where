import OpenAI from "openai";
import type { DiscoveryCard } from "@planit/shared-schema";
import { z } from "zod";

import { config } from "./config";

const openaiClient = config.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: config.OPENAI_API_KEY,
    })
  : null;

async function withOpenAiTimeout<T>(promise: Promise<T>, label: string) {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${config.OPENAI_STEP_TIMEOUT_MS}ms`)), config.OPENAI_STEP_TIMEOUT_MS),
    ),
  ]);
}

const imageSearchResultSchema = z.object({
  imagePageUrls: z.array(z.string().url()).max(3),
});

const placeImageBuckets = new Set<DiscoveryCard["bucket"]>([
  "food-hidden-gems",
  "local-transport",
  "hotels",
]);

const genericPlacePatterns = [
  /\bthings to do\b/i,
  /\btop attractions\b/i,
  /\bbest of\b/i,
  /\btravel guide\b/i,
  /\bdestination guide\b/i,
  /\bitinerary\b/i,
  /\broute planning\b/i,
  /\btransport\b/i,
  /\bmap search\b/i,
  /\breviews\b/i,
  /\bhotels? in\b/i,
  /\bhotel deals\b/i,
  /\bcafe and food\b/i,
  /\bfood and cafe\b/i,
  /\brestaurants?\b/i,
  /\bneighborhoods?\b/i,
  /\btours?\b/i,
  /\bday trips?\b/i,
];

const stopTokens = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "bangkok",
  "singapore",
  "kuching",
  "switzerland",
  "hotel",
  "hotels",
  "restaurant",
  "restaurants",
  "cafe",
  "cafes",
]);

const googlePlaceTextSearchResponseSchema = z.object({
  places: z
    .array(
      z.object({
        displayName: z.object({ text: z.string() }).optional(),
        formattedAddress: z.string().optional(),
        photos: z.array(z.object({ name: z.string() })).optional(),
      }),
    )
    .default([]),
});

const googlePlacePhotoResponseSchema = z.object({
  photoUri: z.string().url(),
});

const legacyGooglePlaceFindResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        name: z.string().optional(),
        formatted_address: z.string().optional(),
        photos: z.array(z.object({ photo_reference: z.string() })).optional(),
      }),
    )
    .default([]),
});

function extractMetaTag(html: string, name: string) {
  const propertyPattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  const propertyMatch = html.match(propertyPattern)?.[1];

  if (propertyMatch) {
    return propertyMatch;
  }

  const reversePattern = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["'][^>]*>`,
    "i",
  );

  return html.match(reversePattern)?.[1];
}

function extractFirstImageTag(html: string) {
  const match = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i)?.[1];
  return match;
}

function extractInlineImageUrls(html: string) {
  const matches = html.match(/https?:\/\/[^"'\\\s>]+/g) ?? [];

  return matches.filter((candidate) => {
    const normalized = candidate.toLowerCase();

    return (
      (normalized.includes(".jpg") ||
        normalized.includes(".jpeg") ||
        normalized.includes(".png") ||
        normalized.includes(".webp") ||
        normalized.includes(".avif") ||
        normalized.includes("imageview2") ||
        normalized.includes("format/jpg") ||
        normalized.includes("format/png"))
    );
  });
}

function normalizeUrl(candidate: string, baseUrl: string) {
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return null;
  }
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stopTokens.has(token));
}

function looksGenericPlaceTitle(title: string) {
  return genericPlacePatterns.some((pattern) => pattern.test(title));
}

function buildGooglePlaceQuery(card: DiscoveryCard) {
  if (looksGenericPlaceTitle(card.title)) {
    return null;
  }

  const destinationHint =
    card.provenance
      .map((entry) => entry.label)
      .find((label) => /bangkok|kuching|switzerland|zurich|geneva|lucerne|bern|basel/i.test(label)) ?? "";

  const baseQuery = card.title.trim();
  const query = [baseQuery, destinationHint]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(", ");

  return query || null;
}

function scoreGooglePlaceMatch(
  card: DiscoveryCard,
  placeName: string | undefined,
  formattedAddress: string | undefined,
  photoCount: number,
) {
  const titleTokens = tokenize(card.title);
  const nameTokens = tokenize(placeName ?? "");
  const addressTokens = tokenize(formattedAddress ?? "");
  const overlapWithName = titleTokens.filter((token) => nameTokens.includes(token)).length;
  const overlapWithAddress = titleTokens.filter((token) => addressTokens.includes(token)).length;
  const hasPhotos = photoCount > 0 ? 2 : 0;

  return overlapWithName * 4 + overlapWithAddress + hasPhotos;
}

function buildLegacyGooglePlacePhotoUrl(photoReference: string) {
  if (!config.GOOGLE_PLACES_API_KEY) {
    return null;
  }

  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1600&photo_reference=${encodeURIComponent(photoReference)}&key=${encodeURIComponent(config.GOOGLE_PLACES_API_KEY)}`;
}

function isGooglePlacePhotoUrl(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    return (
      hostname === "maps.googleapis.com" ||
      hostname === "places.googleapis.com" ||
      hostname.endsWith(".googleusercontent.com")
    );
  } catch {
    return false;
  }
}

function buildImageProxyUrl(imageUrl: string) {
  return `${config.API_PUBLIC_BASE_URL}/api/image-proxy?src=${encodeURIComponent(imageUrl)}`;
}

async function fetchGooglePlacePhotoUri(photoName: string) {
  if (!config.GOOGLE_PLACES_API_KEY) {
    return null;
  }

  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=1400&skipHttpRedirect=true`,
      {
        headers: {
          "X-Goog-Api-Key": config.GOOGLE_PLACES_API_KEY,
        },
      },
    );

    if (!response.ok) {
      return null;
    }

    const payload = googlePlacePhotoResponseSchema.parse(await response.json());
    return payload.photoUri;
  } catch {
    return null;
  }
}

async function searchGooglePlaceImageUrls(card: DiscoveryCard) {
  const query = buildGooglePlaceQuery(card);

  if (!config.GOOGLE_PLACES_API_KEY || !query) {
    return [];
  }

  try {
    const legacyResponse = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=name,formatted_address,photos&key=${encodeURIComponent(config.GOOGLE_PLACES_API_KEY)}`,
    );

    if (legacyResponse.ok) {
      const legacyPayload = legacyGooglePlaceFindResponseSchema.parse(await legacyResponse.json());
      const rankedLegacyCandidates = legacyPayload.candidates
        .filter((candidate) => (candidate.photos?.length ?? 0) > 0)
        .sort(
          (left, right) =>
            scoreGooglePlaceMatch(card, right.name, right.formatted_address, right.photos?.length ?? 0) -
            scoreGooglePlaceMatch(card, left.name, left.formatted_address, left.photos?.length ?? 0),
        );

      const legacyPhotoUrls = rankedLegacyCandidates
        .flatMap((candidate) => (candidate.photos ?? []).map((photo) => buildLegacyGooglePlacePhotoUrl(photo.photo_reference)))
        .filter((photoUrl): photoUrl is string => Boolean(photoUrl))
        .slice(0, 3);

      if (legacyPhotoUrls.length > 0) {
        return [...new Set(legacyPhotoUrls)];
      }
    }

    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": config.GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "places.displayName.text,places.formattedAddress,places.photos.name",
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: "en",
        maxResultCount: 3,
      }),
    });

    if (!response.ok) {
      return [];
    }

    const payload = googlePlaceTextSearchResponseSchema.parse(await response.json());
    const rankedPlaces = payload.places
      .filter((place) => (place.photos?.length ?? 0) > 0)
      .sort(
        (left, right) =>
          scoreGooglePlaceMatch(card, right.displayName?.text, right.formattedAddress, right.photos?.length ?? 0) -
          scoreGooglePlaceMatch(card, left.displayName?.text, left.formattedAddress, left.photos?.length ?? 0),
      );

    const photoUris: string[] = [];

    for (const place of rankedPlaces.slice(0, 2)) {
      for (const photo of (place.photos ?? []).slice(0, 3)) {
        const photoUri = await fetchGooglePlacePhotoUri(photo.name);

        if (photoUri) {
          photoUris.push(photoUri);
        }

        if (photoUris.length >= 3) {
          return [...new Set(photoUris)].slice(0, 3);
        }
      }
    }

    return [...new Set(photoUris)].slice(0, 3);
  } catch {
    return [];
  }
}

function buildImageFetchHeaders() {
  return {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3.1 Safari/605.1.15",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-SG,en;q=0.9",
  };
}

async function fetchImageFromPage(url: string) {
  try {
    const response = await fetch(url, {
      headers: buildImageFetchHeaders(),
    });

    if (!response.ok) {
      return [];
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.startsWith("image/")) {
      return [url];
    }

    const html = await response.text();
    const candidates = [
      extractMetaTag(html, "og:image"),
      extractMetaTag(html, "twitter:image"),
      extractMetaTag(html, "og:image:url"),
      extractFirstImageTag(html),
      ...extractInlineImageUrls(html).slice(0, 8),
    ]
      .map((candidate) => (candidate ? normalizeUrl(candidate, url) : null))
      .filter((candidate): candidate is string => Boolean(candidate));

    return [...new Set(candidates)];
  } catch {
    return [];
  }
}

async function searchPlaceImagePages(card: DiscoveryCard) {
  if (!openaiClient) {
    return [];
  }

  try {
    const response = await withOpenAiTimeout(openaiClient.responses.create({
      model: config.OPENAI_IMAGE_MODEL,
      tools: [{ type: "web_search_preview", search_context_size: "low" }],
      input: [
        {
          role: "system",
          content:
            "Find photo pages for exact travel places. Prefer official operator pages, official tourism pages, or Wikimedia Commons. Avoid stock photo galleries, generic destination pages, and unrelated listicles. Return JSON only.",
        },
        {
          role: "user",
          content: JSON.stringify({
            title: card.title,
            summary: card.summary,
            destinationHint: card.provenance.map((entry) => entry.label),
            existingPages: card.provenance.map((entry) => entry.url),
            output: {
              imagePageUrls: ["up to 3 webpage URLs that likely contain a real photo of this exact place"],
            },
          }),
        },
      ],
    }), `searchPlaceImagePages:${card.id}`);

    const payload = imageSearchResultSchema.parse(JSON.parse(response.output_text));
    return payload.imagePageUrls;
  } catch {
    return [];
  }
}

async function resolveCardImageUrls(card: DiscoveryCard) {
  const googlePlaceImages = await searchGooglePlaceImageUrls(card);

  if (googlePlaceImages.length > 0) {
    return googlePlaceImages.map((imageUrl) =>
      isGooglePlacePhotoUrl(imageUrl) ? buildImageProxyUrl(imageUrl) : imageUrl,
    );
  }

  const candidatePages = [
    ...card.provenance.map((entry) => entry.url),
    ...(card.bookingLink ? [card.bookingLink] : []),
  ];

  const seen = new Set<string>();
  const orderedPages = candidatePages.filter((url) => {
    if (seen.has(url)) {
      return false;
    }

    seen.add(url);
    return true;
  });

  let imageUrls: string[] = [];

  for (const pageUrl of orderedPages.slice(0, 2)) {
    const found = await fetchImageFromPage(pageUrl);
    imageUrls = [...new Set([...imageUrls, ...found])];

    if (imageUrls.length >= 2) {
      return imageUrls.slice(0, 3);
    }
  }

  const searchedPages = await searchPlaceImagePages(card);

  for (const pageUrl of searchedPages) {
    const found = await fetchImageFromPage(pageUrl);
    imageUrls = [...new Set([...imageUrls, ...found])];

    if (imageUrls.length >= 2) {
      break;
    }
  }

  return imageUrls.slice(0, 3);
}

export async function enrichCardImages(cards: DiscoveryCard[]) {
  const relevantCards = cards.filter(
    (card) => placeImageBuckets.has(card.bucket) && card.imageUrls.length === 0,
  );

  if (relevantCards.length === 0) {
    return cards;
  }

  const imageMap = new Map<string, string[]>();

  await Promise.all(
    relevantCards.map(async (card) => {
      const imageUrls = await resolveCardImageUrls(card);

      if (imageUrls.length > 0) {
        imageMap.set(card.id, imageUrls);
      }
    }),
  );

  return cards.map((card) =>
    imageMap.has(card.id)
      ? {
          ...card,
          imageUrls: imageMap.get(card.id)!,
        }
      : card,
  );
}

export const __private__ = {
  looksGenericPlaceTitle,
  buildGooglePlaceQuery,
  scoreGooglePlaceMatch,
};
