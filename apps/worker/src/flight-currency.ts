import { z } from "zod";

const priceFieldSchema = z.object({
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

const hotelFieldSchema = z.object({
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

const currencyRatesToSgd: Record<string, number> = {
  SGD: 1,
  USD: 1.35,
  EUR: 1.47,
  GBP: 1.72,
  CHF: 1.54,
  AUD: 0.89,
  NZD: 0.82,
  CAD: 0.99,
  MYR: 0.30,
  THB: 0.039,
  IDR: 0.000083,
  PHP: 0.024,
  HKD: 0.17,
  CNY: 0.19,
  JPY: 0.009,
  KRW: 0.001,
  TWD: 0.042,
  VND: 0.000053,
};

const symbolCurrencyMap: Record<string, string> = {
  "S$": "SGD",
  SGD: "SGD",
  "US$": "USD",
  USD: "USD",
  "$": "USD",
  "A$": "AUD",
  AUD: "AUD",
  "C$": "CAD",
  CAD: "CAD",
  EUR: "EUR",
  "€": "EUR",
  GBP: "GBP",
  "£": "GBP",
  CHF: "CHF",
  MYR: "MYR",
  RM: "MYR",
  THB: "THB",
  "฿": "THB",
  HKD: "HKD",
  CNY: "CNY",
  RMB: "CNY",
  JPY: "JPY",
  "¥": "JPY",
  KRW: "KRW",
  PHP: "PHP",
  IDR: "IDR",
  TWD: "TWD",
  VND: "VND",
};

function formatSgd(value: number, forceCents = false) {
  const rounded = Math.round(value * 100) / 100;

  if (forceCents) {
    return `SGD ${rounded.toFixed(2)}`;
  }

  return Number.isInteger(rounded) ? `SGD ${rounded}` : `SGD ${rounded.toFixed(2)}`;
}

function detectCurrencyPrefix(value: string) {
  const normalized = value.trim().toUpperCase();
  const tokens = ["S$", "US$", "A$", "C$", "SGD", "USD", "EUR", "GBP", "CHF", "MYR", "RM", "THB", "฿", "HKD", "CNY", "RMB", "JPY", "¥", "KRW", "PHP", "IDR", "TWD", "VND", "$"];
  return tokens.find((token) => normalized.startsWith(token.toUpperCase()));
}

function parseMoney(value: string | undefined) {
  if (!value) {
    return null;
  }

  const currencyToken = detectCurrencyPrefix(value);
  const amountMatch = value.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)/);

  if (!currencyToken || !amountMatch) {
    return null;
  }

  const currency = symbolCurrencyMap[currencyToken.toUpperCase()] ?? symbolCurrencyMap[currencyToken] ?? currencyToken.toUpperCase();
  const amount = Number(amountMatch[1]);
  const rate = currencyRatesToSgd[currency];

  if (!Number.isFinite(amount) || !rate) {
    return null;
  }

  return {
    currency,
    amount,
    sgdValue: amount * rate,
    original: value,
  };
}

function normalizeMoneyField(value: string | undefined) {
  if (!value) {
    return { value: undefined as string | undefined, note: null as string | null };
  }

  const parsed = parseMoney(value);

  if (!parsed) {
    return { value, note: null };
  }

  if (parsed.currency === "SGD") {
    return { value: formatSgd(parsed.amount, value.includes(".")), note: null };
  }

  return {
    value: formatSgd(parsed.sgdValue),
    note: `Original observed fare: ${parsed.original}`,
  };
}

function pushNote(notes: string[], note: string | null) {
  if (note && !notes.includes(note)) {
    notes.push(note);
  }
}

export function normalizeFlightObservationToSgd(input: z.input<typeof priceFieldSchema>) {
  const observation = priceFieldSchema.parse(input);
  const baseFare = normalizeMoneyField(observation.baseFare);
  const totalFare = normalizeMoneyField(observation.totalFare);
  const checkedBagPrice = normalizeMoneyField(observation.checkedBagPrice);
  const notes = [...observation.notes];

  for (const note of [baseFare.note, totalFare.note, checkedBagPrice.note]) {
    pushNote(notes, note);
  }

  return {
    ...observation,
    baseFare: baseFare.value,
    totalFare: totalFare.value,
    checkedBagPrice: checkedBagPrice.value,
    notes,
  };
}

export function normalizeHotelObservationToSgd(input: z.input<typeof hotelFieldSchema>) {
  const observation = hotelFieldSchema.parse(input);
  const nightlyRate = normalizeMoneyField(observation.nightlyRate);
  const totalStayPrice = normalizeMoneyField(observation.totalStayPrice);
  const notes = [...observation.notes];

  pushNote(notes, nightlyRate.note);
  pushNote(notes, totalStayPrice.note);

  return {
    ...observation,
    nightlyRate: nightlyRate.value,
    totalStayPrice: totalStayPrice.value,
    notes,
  };
}
