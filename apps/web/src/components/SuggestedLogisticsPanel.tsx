import type { DiscoveryCard, FlightPreferences } from "@planit/shared-schema";
import { BedDouble, Check, MapPinned, Plane, Sparkles, TrendingUp } from "lucide-react";

function centroid(cards: DiscoveryCard[]) {
  const coords = cards.map((card) => card.coords).filter(Boolean);

  if (coords.length === 0) {
    return null;
  }

  const lat = coords.reduce((sum, point) => sum + point!.lat, 0) / coords.length;
  const lng = coords.reduce((sum, point) => sum + point!.lng, 0) / coords.length;
  return { lat, lng };
}

function distanceScore(card: DiscoveryCard, center: { lat: number; lng: number } | null) {
  if (!center || !card.coords) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.hypot(card.coords.lat - center.lat, card.coords.lng - center.lng);
}

function parseAmount(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function formatPrice(value: string | null | undefined) {
  if (!value) {
    return "Live fare on source";
  }

  if (/[A-Za-z$€£¥฿]/.test(value)) {
    return value;
  }

  const amount = parseAmount(value);
  return amount === null ? "Live fare on source" : `SGD ${Math.round(amount)}`;
}

function compactSourceLabel(value: string) {
  return value
    .replace(/\s+Singapore\s+to\s+.+$/i, "")
    .replace(/\s+flights?$/i, "")
    .replace(/\s+route search.*$/i, "")
    .replace(/\s+search hub.*$/i, "")
    .replace(/\s+hotels?\s+in\s+.+$/i, "")
    .trim();
}

function flightPriceLabel(card: DiscoveryCard) {
  return formatPrice(
    card.flightOffer?.totalFare ??
      card.flightOffer?.baseFare ??
      card.priceSummary?.touristPrice,
  );
}

function hotelPriceLabel(card: DiscoveryCard) {
  return formatPrice(card.priceSummary?.touristPrice);
}

function isProbablyDirect(card: DiscoveryCard) {
  const label = `${card.flightOffer?.seller ?? ""} ${card.sourceLabel}`.toLowerCase();
  return /airline|airlines|airways|singapore airlines|scoot|thai airasia|jetstar|ana|jal|korean air/.test(label);
}

function flightPreferenceScore(card: DiscoveryCard, flightBudget: number | undefined, preferences?: FlightPreferences) {
  const price = parseAmount(card.flightOffer?.totalFare ?? card.flightOffer?.baseFare ?? card.priceSummary?.touristPrice);
  const matched = card.flightOffer?.preferencesMatched.length ?? 0;
  const missing = card.flightOffer?.preferencesMissing.length ?? 0;

  let score = matched * 30 - missing * 22;

  if (preferences?.sellerPreference === "direct_only" || preferences?.sellerPreference === "direct_preferred") {
    score += isProbablyDirect(card) ? 14 : preferences.sellerPreference === "direct_only" ? -18 : -6;
  }

  if (preferences?.fareStyle === "extras_included") {
    score += matched * 10;
  }

  if (price !== null) {
    if (flightBudget) {
      score += price <= flightBudget ? 28 : -Math.min(42, Math.round((price - flightBudget) / 10));
    }

    if (preferences?.fareStyle === "cheapest") {
      score += 240 - price / 5;
    } else if (preferences?.fareStyle === "extras_included") {
      score += 120 - price / 18;
    } else {
      const target = flightBudget ?? price;
      score += 140 - Math.abs(target - price) / 6;
    }
  } else {
    score -= 12;
  }

  return score;
}

function flightExplanation(card: DiscoveryCard) {
  const matched = card.flightOffer?.preferencesMatched ?? [];
  const missing = card.flightOffer?.preferencesMissing ?? [];

  if (matched.length) {
    return `Matches: ${matched.slice(0, 2).join(", ")}${missing.length ? ` • Missing: ${missing.slice(0, 1).join(", ")}` : ""}`;
  }

  if (card.flightOffer?.notes[0]) {
    return card.flightOffer.notes[0];
  }

  return card.summary;
}

function hotelExplanation(card: DiscoveryCard) {
  return card.whyItFits ?? card.summary;
}

type SuggestedLogisticsPanelProps = {
  cards: DiscoveryCard[];
  selectedPlaceCards: DiscoveryCard[];
  selectedCardIds: string[];
  watchedFlightCardIds: string[];
  isWatchingFlight: boolean;
  onToggle: (cardId: string) => void;
  onWatchFlight: (card: DiscoveryCard) => void;
  selectedPlaceCount: number;
  mode: "flights" | "hotels";
  flightBudget?: number;
  flightPreferences?: FlightPreferences;
  isComplete?: boolean;
  liveAction?: {
    href: string;
    label: string;
  };
};

const panelCopy = {
  flights: {
    label: "Flights",
    title: "Best fare first",
    summary: "I’m ranking these against the current fare preferences and budget, then keeping the list short.",
    empty: "I’m still pulling flight options that fit the trip.",
    priceLabel: "Best fare seen",
    primary: {
      idle: "Choose flight",
      active: "Flight chosen",
    },
    Icon: Plane,
  },
  hotels: {
    label: "Stay",
    title: "A few bases that fit the route",
    summary: "These stays are trimmed down to the ones that make the saved places easiest to reach.",
    empty: "I’m still narrowing the better hotel areas for the places you saved.",
    priceLabel: "Nightly",
    primary: {
      idle: "Choose stay",
      active: "Stay chosen",
    },
    Icon: BedDouble,
  },
} as const;

export function SuggestedLogisticsPanel({
  cards,
  selectedPlaceCards,
  selectedCardIds,
  watchedFlightCardIds,
  isWatchingFlight,
  onToggle,
  onWatchFlight,
  selectedPlaceCount,
  mode,
  flightBudget,
  flightPreferences,
  isComplete = false,
  liveAction,
}: SuggestedLogisticsPanelProps) {
  const center = centroid(selectedPlaceCards);
  const copy = panelCopy[mode];
  const rankedSuggestions = cards
    .slice()
    .sort((left, right) => {
      if (mode === "flights") {
        return flightPreferenceScore(right, flightBudget, flightPreferences) - flightPreferenceScore(left, flightBudget, flightPreferences);
      }

      return distanceScore(left, center) - distanceScore(right, center);
    })
    .slice(0, mode === "flights" ? 3 : 4);

  const topSuggestion = rankedSuggestions[0];
  const otherSuggestions = rankedSuggestions.slice(1);
  const StatusIcon = isComplete ? Check : Sparkles;
  const checkedCount = cards.length;
  const statusCopy = isComplete
    ? checkedCount > 0
      ? mode === "flights"
        ? {
            label: "Live search finished",
            body: `I already checked ${checkedCount} fare source${checkedCount === 1 ? "" : "s"} for this route and kept the strongest ${rankedSuggestions.length}.`,
          }
        : {
            label: "Stay search finished",
            body: `I already checked ${checkedCount} stay option${checkedCount === 1 ? "" : "s"} and kept the ones that best fit the saved places.`,
          }
      : mode === "flights"
        ? {
            label: "Live search finished",
            body: "This pass already ran, but it did not return a usable flight shortlist.",
          }
        : {
            label: "Stay search finished",
            body: "This pass already ran, but it did not return a usable stay shortlist.",
          }
    : mode === "flights"
      ? {
          label: "Checking live fares",
          body: copy.empty,
        }
      : {
          label: "Checking stays",
          body: copy.empty,
        };

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">{copy.label}</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-950">{copy.title}</h3>
          <p className="mt-2 text-sm leading-7 text-slate-600">{copy.summary}</p>
        </div>
        <div className="rounded-full bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white">
          {rankedSuggestions.length}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
        <MapPinned className="h-4 w-4 text-slate-400" />
        Built around {selectedPlaceCount} saved place{selectedPlaceCount === 1 ? "" : "s"}.
      </div>

      <div className="mt-3 rounded-[22px] border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <StatusIcon className={`h-4 w-4 ${isComplete ? "text-emerald-600" : "text-sky-600"}`} />
          <p className="text-sm font-semibold text-slate-900">{statusCopy.label}</p>
        </div>
        <p className="mt-1 text-sm leading-6 text-slate-600">{statusCopy.body}</p>
        {liveAction ? (
          <a
            href={liveAction.href}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center rounded-full bg-slate-950 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            {liveAction.label}
          </a>
        ) : null}
      </div>

      {topSuggestion ? (
        <div className="mt-5 space-y-3">
          <article className={`rounded-[26px] border p-4 ${selectedCardIds.includes(topSuggestion.id) ? "border-slate-900 bg-slate-950 text-white shadow-[0_20px_60px_rgba(15,23,42,0.22)]" : "border-slate-200 bg-slate-50/80"}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${selectedCardIds.includes(topSuggestion.id) ? "bg-white/10 text-white" : "bg-slate-900 text-white"}`}>
                    Best match
                  </span>
                  {mode === "flights" && topSuggestion.flightOffer?.preferencesMatched.length ? (
                    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${selectedCardIds.includes(topSuggestion.id) ? "bg-white/10 text-white/80" : "bg-emerald-50 text-emerald-700"}`}>
                      <Check className="h-3.5 w-3.5" />
                      {topSuggestion.flightOffer.preferencesMatched.slice(0, 2).join(", ")}
                    </span>
                  ) : null}
                </div>
                <h4 className="mt-3 text-lg font-semibold">
                  {mode === "flights" ? compactSourceLabel(topSuggestion.sourceLabel) || topSuggestion.title : topSuggestion.title}
                </h4>
                <p className={`mt-2 text-sm leading-7 ${selectedCardIds.includes(topSuggestion.id) ? "text-white/78" : "text-slate-600"}`}>
                  {mode === "flights" ? flightExplanation(topSuggestion) : hotelExplanation(topSuggestion)}
                </p>
              </div>

              <div className={`rounded-[20px] px-4 py-3 text-right ${selectedCardIds.includes(topSuggestion.id) ? "bg-white/10" : "bg-white ring-1 ring-slate-200"}`}>
                <p className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${selectedCardIds.includes(topSuggestion.id) ? "text-white/60" : "text-slate-500"}`}>
                  {copy.priceLabel}
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {mode === "flights" ? flightPriceLabel(topSuggestion) : hotelPriceLabel(topSuggestion)}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
                  selectedCardIds.includes(topSuggestion.id) ? "bg-white text-slate-950" : "bg-slate-950 text-white"
                }`}
                type="button"
                onClick={() => onToggle(topSuggestion.id)}
              >
                <Sparkles className="h-4 w-4" />
                {selectedCardIds.includes(topSuggestion.id) ? copy.primary.active : copy.primary.idle}
              </button>
              {mode === "flights" ? (
                <button
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
                    selectedCardIds.includes(topSuggestion.id) ? "bg-white/10 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"
                  }`}
                  type="button"
                  disabled={watchedFlightCardIds.includes(topSuggestion.id) || isWatchingFlight}
                  onClick={() => onWatchFlight(topSuggestion)}
                >
                  <TrendingUp className="h-4 w-4" />
                  {watchedFlightCardIds.includes(topSuggestion.id) ? "Watching" : "Watch fare"}
                </button>
              ) : null}
            </div>
          </article>

          {otherSuggestions.length ? (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-2">
              {otherSuggestions.map((card) => {
                const selected = selectedCardIds.includes(card.id);
                const Icon = copy.Icon;

                return (
                  <article
                    key={card.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-[18px] px-3 py-3 ${selected ? "bg-slate-950 text-white" : "bg-white"}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${selected ? "text-white/80" : "text-slate-400"}`} />
                        <p className="truncate text-sm font-semibold">
                          {mode === "flights" ? compactSourceLabel(card.sourceLabel) || card.title : card.title}
                        </p>
                      </div>
                      <p className={`mt-1 truncate text-sm ${selected ? "text-white/70" : "text-slate-500"}`}>
                        {mode === "flights" ? flightExplanation(card) : hotelExplanation(card)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className={`text-xs ${selected ? "text-white/60" : "text-slate-500"}`}>{copy.priceLabel}</p>
                        <p className="text-sm font-semibold">
                          {mode === "flights" ? flightPriceLabel(card) : hotelPriceLabel(card)}
                        </p>
                      </div>
                      <button
                        className={`rounded-full px-3.5 py-2 text-sm font-semibold ${
                          selected ? "bg-white text-slate-950" : "bg-slate-950 text-white"
                        }`}
                        type="button"
                        onClick={() => onToggle(card.id)}
                      >
                        {selected ? "Chosen" : "Choose"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          {isComplete
            ? mode === "flights"
              ? "I couldn't get a usable flight shortlist from this pass yet."
              : "I couldn't get a usable stay shortlist from this pass yet."
            : copy.empty}
        </div>
      )}
    </section>
  );
}
