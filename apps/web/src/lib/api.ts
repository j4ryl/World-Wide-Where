import type {
  BookingLinkResult,
  DiscoverRequest,
  DiscoveryRunSnapshot,
  FlightWatchDemoResult,
  HotelPreferences,
  RunExpandRequest,
  RunStreamMessage,
  SentryAlert,
  SentryScope,
  TimelineNode,
} from "@planit/shared-schema";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export function createRun(input: DiscoverRequest) {
  return request<{ runId: string }>("/api/discover", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchRun(runId: string) {
  return request<DiscoveryRunSnapshot>(`/api/runs/${runId}`);
}

export function expandRun(input: {
  runId: string;
  buckets: RunExpandRequest["buckets"];
  selectedCardIds?: string[];
  flightPreferences?: DiscoverRequest["flightPreferences"];
  hotelPreferences?: HotelPreferences;
}) {
  return request<{ runId: string; buckets: string[] }>(`/api/runs/${input.runId}/expand`, {
    method: "POST",
    body: JSON.stringify({
      buckets: input.buckets,
      selectedCardIds: input.selectedCardIds ?? [],
      flightPreferences: input.flightPreferences,
      hotelPreferences: input.hotelPreferences,
    }),
  });
}

export function buildTimelineRequest(input: {
  runId?: string;
  selectedCardIds: string[];
  destination: string;
  dates?: { start?: string; end?: string };
  busyWindows: DiscoverRequest["busyWindows"];
}) {
  return request<{ nodes: TimelineNode[] }>("/api/timeline", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function recalculateTimelineRequest(input: {
  runId?: string;
  nodes: TimelineNode[];
  destination: string;
  dates?: { start?: string; end?: string };
  busyWindows: DiscoverRequest["busyWindows"];
}) {
  return request<{ nodes: TimelineNode[] }>("/api/timeline/recalculate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchBookingLink(input: { cardId: string; runId?: string }) {
  return request<BookingLinkResult>("/api/book-link", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchSentryDemo(input: { origin: string; destination: string; scope?: SentryScope }) {
  return request<{ alerts: SentryAlert[] }>("/api/sentry/demo", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function startFlightWatchDemo(input: {
  origin: string;
  destination: string;
  cardId: string;
  title: string;
}) {
  return request<FlightWatchDemoResult>("/api/flight-watch/demo", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function subscribeToRun(runId: string, onMessage: (message: RunStreamMessage) => void) {
  const stream = new EventSource(`${API_BASE_URL}/api/runs/${runId}/stream`);

  stream.onmessage = (event) => {
    const payload = JSON.parse(event.data) as RunStreamMessage;
    onMessage(payload);
  };

  return stream;
}
