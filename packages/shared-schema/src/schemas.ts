import { z } from "zod";

export const bucketSchema = z.enum([
  "flights",
  "hotels",
  "car-rental",
  "local-transport",
  "food-hidden-gems",
  "local-advice",
]);

export const trustTagSchema = z.enum([
  "Official Schedule",
  "Official Stay",
  "Verified Partner",
  "Local Tip",
  "Hidden Gem",
  "Local Advice",
]);

export const verificationStateSchema = z.enum([
  "pending",
  "cached",
  "verified",
  "live",
  "unverified",
]);

export const planningStageSchema = z.enum(["places", "logistics", "advice"]);

export const sourceKindSchema = z.enum([
  "official",
  "partner",
  "guide",
  "forum",
  "social",
]);

export const provenanceSchema = z.object({
  label: z.string(),
  url: z.string().url(),
  kind: sourceKindSchema,
  lastChecked: z.string(),
  note: z.string().optional(),
});

export const coordsSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

export const openingWindowSchema = z.object({
  days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])),
  open: z.string(),
  close: z.string(),
});

export const priceSummarySchema = z.object({
  touristPrice: z.string().nullable(),
  localPrice: z.string().nullable(),
});

export const flightOfferDetailsSchema = z.object({
  airline: z.string().nullable().default(null),
  seller: z.string().nullable().default(null),
  route: z.string().nullable().default(null),
  baseFare: z.string().nullable().default(null),
  totalFare: z.string().nullable().default(null),
  baggagePolicy: z.string().nullable().default(null),
  checkedBagPrice: z.string().nullable().default(null),
  boardingPolicy: z.string().nullable().default(null),
  mealPolicy: z.string().nullable().default(null),
  fareClass: z.string().nullable().default(null),
  preferencesMatched: z.array(z.string()).default([]),
  preferencesMissing: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});

export const hotelOfferDetailsSchema = z.object({
  propertyName: z.string().nullable().default(null),
  nightlyRate: z.string().nullable().default(null),
  totalStayPrice: z.string().nullable().default(null),
  breakfastIncluded: z.boolean().nullable().default(null),
  freeCancellation: z.boolean().nullable().default(null),
  payLaterAvailable: z.boolean().nullable().default(null),
  neighborhood: z.string().nullable().default(null),
  cancellationPolicy: z.string().nullable().default(null),
  roomType: z.string().nullable().default(null),
  preferencesMatched: z.array(z.string()).default([]),
  preferencesMissing: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});

export const discoveryCardSchema = z.object({
  id: z.string(),
  bucket: bucketSchema,
  planningStage: planningStageSchema.optional(),
  title: z.string(),
  originalTitle: z.string().optional(),
  summary: z.string(),
  originalSummary: z.string().optional(),
  whyItFits: z.string().optional(),
  imageUrls: z.array(z.string().url()).default([]),
  trustTag: trustTagSchema,
  trustSummary: z.string(),
  credibilityNotes: z.array(z.string()).default([]),
  verificationState: verificationStateSchema,
  sourceLabel: z.string(),
  originalSourceLabel: z.string().optional(),
  recommendedDurationMinutes: z.number().int().positive(),
  priceSummary: priceSummarySchema.optional(),
  flightOffer: flightOfferDetailsSchema.optional(),
  hotelOffer: hotelOfferDetailsSchema.optional(),
  coords: coordsSchema.optional(),
  warnings: z.array(z.string()).default([]),
  quotes: z.array(z.string()).default([]),
  openingHours: z.array(openingWindowSchema).optional(),
  bookingLink: z.string().url().optional(),
  provenance: z.array(provenanceSchema),
});

export const busyWindowSchema = z.object({
  id: z.string(),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  label: z.string(),
});

export const flightPreferencesSchema = z.object({
  baggage: z.enum(["no_bag", "cabin_only", "one_checked_bag", "two_checked_bags"]),
  boarding: z.enum(["no_preference", "priority_preferred", "priority_required"]),
  meals: z.enum(["no_preference", "meal_preferred", "meal_required"]),
  fareStyle: z.enum(["cheapest", "balanced", "extras_included"]),
  sellerPreference: z.enum(["any", "direct_preferred", "direct_only"]),
});

export const hotelPreferencesSchema = z.object({
  freeCancellation: z.enum(["required", "preferred", "not_needed"]),
  breakfast: z.enum(["required", "preferred", "not_needed"]),
  payment: z.enum(["pay_later_preferred", "prepay_ok", "pay_at_property_preferred"]),
  style: z.enum(["cheapest", "balanced", "upscale"]),
  areaPreference: z.string().default(""),
  starPreference: z.enum(["any", "three_plus", "four_plus", "five_star_only"]),
});

export const discoverRequestSchema = z.object({
  prompt: z.string().min(1),
  origin: z.string().default(""),
  destination: z.string().default(""),
  dates: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
    })
    .optional(),
  travelers: z
    .object({
      adults: z.number().int().min(1).default(2),
      children: z.number().int().min(0).default(0),
    })
    .optional(),
  flightPreferences: flightPreferencesSchema.optional(),
  hotelPreferences: hotelPreferencesSchema.optional(),
  busyWindows: z.array(busyWindowSchema).default([]),
  mode: z.enum(["hybrid", "live", "cache"]).default("hybrid"),
  pricingMode: z.enum(["public", "local"]).default("public"),
});

export const searchPlanSchema = z.object({
  tripBrief: z.string(),
  destination: z.string(),
  tripLengthDays: z.number().int().positive(),
  buckets: z.array(bucketSchema),
  freshnessNotes: z.array(z.string()),
  budgetNotes: z.array(z.string()),
});

export const sourceCandidateSchema = z.object({
  id: z.string(),
  bucket: bucketSchema,
  label: z.string(),
  platform: z.string().optional(),
  previewImageUrl: z.string().url().optional(),
  domain: z.string(),
  url: z.string().url(),
  kind: sourceKindSchema,
  region: z.string(),
  requiresBrowser: z.boolean(),
  loginRequired: z.boolean().default(false),
  credibilityGoal: z.string().optional(),
});

export const extractionJobSchema = z.object({
  id: z.string(),
  runId: z.string(),
  cardId: z.string(),
  sourceId: z.string().optional(),
  url: z.string().url(),
  domain: z.string(),
  bucket: bucketSchema,
  platform: z.string().optional(),
  sourceKind: sourceKindSchema.default("guide"),
  promptHint: z.string(),
  goal: z.string().optional(),
  browserProfile: z.enum(["lite", "stealth"]).default("lite"),
  proxyCountry: z.string().optional(),
  timeoutMs: z.number().int().positive(),
});

export const extractionResultSchema = z.object({
  jobId: z.string(),
  cardId: z.string(),
  quote: z.string(),
  warning: z.string().optional(),
  verificationState: verificationStateSchema,
  details: z.array(z.string()).default([]),
  flightObservation: flightOfferDetailsSchema.optional(),
  hotelObservation: hotelOfferDetailsSchema.optional(),
  credibilitySignals: z.array(z.string()).default([]),
  sourceSummary: z.string().optional(),
});

export const runEventSchema = z.object({
  id: z.string(),
  type: z.enum([
    "planner",
    "scout",
    "verify",
    "extract",
    "synthesize",
    "partial_board",
    "fallback",
    "done",
    "error",
  ]),
  message: z.string(),
  timestamp: z.string(),
  progress: z.number().min(0).max(100),
  bucket: bucketSchema.optional(),
  meta: z
    .object({
      jobId: z.string().optional(),
      cardId: z.string().optional(),
      domain: z.string().optional(),
      platform: z.string().optional(),
      liveUrl: z.string().url().optional(),
      providerStatus: z.string().optional(),
    })
    .optional(),
});

export const discoveryRunSnapshotSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  request: discoverRequestSchema,
  plan: searchPlanSchema.optional(),
  cards: z.array(discoveryCardSchema),
  events: z.array(runEventSchema),
  parsedSummary: z.string().optional(),
  updatedAt: z.string(),
});

export const runStreamMessageSchema = z.object({
  event: runEventSchema,
  run: discoveryRunSnapshotSchema,
});

export const runExpandRequestSchema = z.object({
  buckets: z.array(bucketSchema).min(1),
  selectedCardIds: z.array(z.string()).default([]),
  flightPreferences: flightPreferencesSchema.optional(),
  hotelPreferences: hotelPreferencesSchema.optional(),
});

export const timelineNodeSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  title: z.string(),
  bucket: bucketSchema,
  day: z.number().int().positive(),
  startTime: z.string(),
  endTime: z.string(),
  durationMinutes: z.number().int().positive(),
  travelMinutesFromPrevious: z.number().int().nonnegative(),
  note: z.string(),
  logistics: z.string(),
  warnings: z.array(z.string()).default([]),
  priceSummary: priceSummarySchema.optional(),
  coords: coordsSchema.optional(),
});

export const timelineRequestSchema = z.object({
  runId: z.string().optional(),
  selectedCardIds: z.array(z.string()).min(1),
  destination: z.string(),
  dates: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
    })
    .optional(),
  busyWindows: z.array(busyWindowSchema).default([]),
});

export const timelineRecalculateRequestSchema = z.object({
  runId: z.string().optional(),
  nodes: z.array(timelineNodeSchema).min(1),
  destination: z.string(),
  dates: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
    })
    .optional(),
  busyWindows: z.array(busyWindowSchema).default([]),
});

export const offerGroupSchema = z.object({
  id: z.string(),
  title: z.string(),
  bucket: bucketSchema,
  bestValue: z.string(),
  options: z.array(z.string()),
});

export const bookingLinkResultSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  providerLabel: z.string(),
  notes: z.array(z.string()),
  preparedAt: z.string(),
});

export const sentryAlertSchema = z.object({
  id: z.string(),
  status: z.enum(["monitoring", "action_needed", "drafted"]),
  title: z.string(),
  summary: z.string(),
  trigger: z.string(),
  suggestedAction: z.string(),
  holdWindow: z.string().optional(),
});

export const sentryScopeSchema = z.enum(["prebooking", "postplanning"]);

export const sentryDemoRequestSchema = z.object({
  origin: z.string(),
  destination: z.string(),
  scope: sentryScopeSchema.optional(),
});

export const flightWatchDemoRequestSchema = z.object({
  origin: z.string(),
  destination: z.string(),
  cardId: z.string(),
  title: z.string(),
});

export const flightWatchDemoResultSchema = z.object({
  watchId: z.string(),
  status: z.enum(["watching"]),
  title: z.string(),
  summary: z.string(),
  recommendedChannel: z.string(),
  alert: sentryAlertSchema.optional(),
});

export const hotelComparisonRequestSchema = z.object({
  hotelName: z.string().min(1),
  destination: z.string().min(1),
  dates: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
    })
    .optional(),
  hotelPreferences: hotelPreferencesSchema.optional(),
});

export const hotelComparisonOfferSchema = z.object({
  sourceLabel: z.string(),
  bookingLink: z.string().url(),
  hotelOffer: hotelOfferDetailsSchema,
  priceSummary: priceSummarySchema.optional(),
});

export const hotelComparisonResultSchema = z.object({
  hotelName: z.string(),
  destination: z.string(),
  offers: z.array(hotelComparisonOfferSchema),
  bestValueSummary: z.string(),
  preparedAt: z.string(),
});

export type Bucket = z.infer<typeof bucketSchema>;
export type BusyWindow = z.infer<typeof busyWindowSchema>;
export type BookingLinkResult = z.infer<typeof bookingLinkResultSchema>;
export type Coords = z.infer<typeof coordsSchema>;
export type DiscoverRequest = z.infer<typeof discoverRequestSchema>;
export type DiscoveryCard = z.infer<typeof discoveryCardSchema>;
export type DiscoveryRunSnapshot = z.infer<typeof discoveryRunSnapshotSchema>;
export type ExtractionJob = z.infer<typeof extractionJobSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export type FlightPreferences = z.infer<typeof flightPreferencesSchema>;
export type HotelPreferences = z.infer<typeof hotelPreferencesSchema>;
export type RunExpandRequest = z.infer<typeof runExpandRequestSchema>;
export type OfferGroup = z.infer<typeof offerGroupSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
export type RunStreamMessage = z.infer<typeof runStreamMessageSchema>;
export type SearchPlan = z.infer<typeof searchPlanSchema>;
export type SentryAlert = z.infer<typeof sentryAlertSchema>;
export type SentryScope = z.infer<typeof sentryScopeSchema>;
export type SourceCandidate = z.infer<typeof sourceCandidateSchema>;
export type TimelineNode = z.infer<typeof timelineNodeSchema>;
export type FlightWatchDemoResult = z.infer<typeof flightWatchDemoResultSchema>;
export type HotelComparisonResult = z.infer<typeof hotelComparisonResultSchema>;
