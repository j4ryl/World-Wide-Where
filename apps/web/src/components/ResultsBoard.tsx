import { useEffect, useState } from "react";
import type { DiscoveryCard } from "@planit/shared-schema";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ExternalLink, MapPinned, Sparkles } from "lucide-react";

import { CardImageCarousel } from "./CardImageCarousel";
import { getPlaceImageUrls } from "../lib/place-image";

const bucketLabels: Record<DiscoveryCard["bucket"], string> = {
  flights: "Flights",
  hotels: "Hotels",
  "car-rental": "Car rental",
  "local-transport": "Routes",
  "food-hidden-gems": "Hidden gems",
  "local-advice": "Local advice",
};

const bucketDescriptions: Partial<Record<DiscoveryCard["bucket"], string>> = {
  "food-hidden-gems": "Restaurants, cafes, neighborhoods, and hidden spots that make the trip memorable.",
};

const bucketOrder: DiscoveryCard["bucket"][] = ["food-hidden-gems"];

type ResultsBoardProps = {
  cards: DiscoveryCard[];
  selectedPlaceIds: string[];
  selectedPlaces: DiscoveryCard[];
  onToggle: (cardId: string) => void;
  minimumSavedForNextStep: number;
  isSelectionConfirmed: boolean;
  onConfirmSelection: () => void;
};

function hasCjkText(value: string) {
  return /[\u3400-\u9fff]/.test(value);
}

function fallbackPlaceTitle(card: DiscoveryCard, index: number) {
  const summary = `${card.summary} ${card.whyItFits ?? ""}`.toLowerCase();

  if (summary.includes("coffee") || summary.includes("cafe")) {
    return `Cafe pick ${index + 1}`;
  }

  if (summary.includes("restaurant") || summary.includes("food")) {
    return `Food stop ${index + 1}`;
  }

  if (summary.includes("market")) {
    return `Market stop ${index + 1}`;
  }

  return `Hidden gem ${index + 1}`;
}

export function ResultsBoard({
  cards,
  selectedPlaceIds,
  selectedPlaces,
  onToggle,
  minimumSavedForNextStep,
  isSelectionConfirmed,
  onConfirmSelection,
}: ResultsBoardProps) {
  const [paginationByBucket, setPaginationByBucket] = useState<
    Partial<Record<DiscoveryCard["bucket"], { page: number; direction: -1 | 0 | 1 }>>
  >({});

  const groupedCards = bucketOrder
    .map((bucket) => [bucket, cards.filter((card) => card.bucket === bucket)] as const)
    .filter(([, bucketCards]) => bucketCards.length > 0);
  const hasUnlockedNextStep = selectedPlaceIds.length >= minimumSavedForNextStep;
  const cardsSignature = cards.map((card) => card.id).join("|");
  const pageSize = 3;

  useEffect(() => {
    setPaginationByBucket({});
  }, [cardsSignature]);

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Places</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-950">Start with the places you actually want to build the trip around.</h3>
        </div>
        <div className="rounded-full bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white">
          {selectedPlaceIds.length} saved
        </div>
      </div>

      {hasUnlockedNextStep ? (
        <div className="mt-4 rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          You’ve saved enough places. Flights unlock below.
        </div>
      ) : null}

      {groupedCards.length ? (
        <div className="mt-5 space-y-6">
          {groupedCards.map(([bucket, bucketCards]) => (
            <div key={bucket}>
              {(() => {
                const pageState = paginationByBucket[bucket] ?? { page: 0, direction: 0 as const };
                const totalPages = Math.max(1, Math.ceil(bucketCards.length / pageSize));
                const currentPage = Math.min(pageState.page, totalPages - 1);
                const visibleCards = bucketCards.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

                function changePage(nextPage: number, direction: -1 | 1) {
                  setPaginationByBucket((current) => ({
                    ...current,
                    [bucket]: {
                      page: Math.max(0, Math.min(nextPage, totalPages - 1)),
                      direction,
                    },
                  }));
                }

                return (
                  <>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                    <MapPinned className="h-3.5 w-3.5" />
                    {bucketLabels[bucket]}
                  </div>
                  {bucketDescriptions[bucket] ? (
                    <p className="mt-2 text-sm text-slate-500">{bucketDescriptions[bucket]}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {totalPages > 1 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => changePage(currentPage - 1, -1)}
                        disabled={currentPage === 0}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
                        aria-label="Previous attractions"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <p className="min-w-[3.5rem] text-center text-sm text-slate-500">
                        {currentPage + 1}/{totalPages}
                      </p>
                      <button
                        type="button"
                        onClick={() => changePage(currentPage + 1, 1)}
                        disabled={currentPage === totalPages - 1}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
                        aria-label="Next attractions"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">{bucketCards.length} options</p>
                  )}
                </div>
              </div>

              <div className="overflow-hidden">
                <AnimatePresence custom={pageState.direction} initial={false} mode="wait">
                  <motion.div
                    key={`${bucket}-${currentPage}`}
                    custom={pageState.direction}
                    initial={{ x: pageState.direction >= 0 ? 36 : -36, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: pageState.direction >= 0 ? -36 : 36, opacity: 0 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    className="grid gap-3 md:grid-cols-3"
                  >
                {visibleCards.map((card, index) => {
                  const isSelected = selectedPlaceIds.includes(card.id);
                  const imageUrls = getPlaceImageUrls(card);
                  const sourceUrl = card.provenance[0]?.url ?? card.bookingLink;
                  const sourceLabel = "Powered by Tinyfish";
                  const displayTitle = hasCjkText(card.title)
                    ? fallbackPlaceTitle(card, currentPage * pageSize + index)
                    : card.title;

                  return (
                    <article
                      key={card.id}
                      className={`overflow-hidden rounded-[24px] border p-3 transition ${
                        isSelected
                          ? "border-slate-900 bg-slate-950 text-white shadow-[0_20px_60px_rgba(15,23,42,0.22)]"
                          : "border-slate-200 bg-slate-50/60 hover:border-slate-300"
                      }`}
                    >
                      <div className="grid gap-3">
                        <CardImageCarousel title={displayTitle} imageUrls={imageUrls} compact />
                        <div>
                          <h4 className="line-clamp-2 text-base font-semibold">{displayTitle}</h4>
                          <p className={`mt-2 line-clamp-3 text-sm leading-6 ${isSelected ? "text-white/78" : "text-slate-600"}`}>
                            {card.summary}
                          </p>
                          {card.whyItFits ? (
                            <p className={`mt-2 line-clamp-2 text-xs leading-5 ${isSelected ? "text-white/68" : "text-slate-500"}`}>
                              {card.whyItFits}
                            </p>
                          ) : null}
                        </div>

                        <div className={`rounded-[18px] px-3 py-2 text-xs ${isSelected ? "bg-white/6 text-white/78" : "bg-white text-slate-600"}`}>
                          <p>{sourceLabel}</p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            className={`inline-flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-sm font-semibold ${
                              isSelected ? "bg-white text-slate-950" : "bg-slate-950 text-white"
                            }`}
                            type="button"
                            onClick={() => onToggle(card.id)}
                          >
                            <Sparkles className="h-4 w-4" />
                            {isSelected ? "Saved" : "Save place"}
                          </button>
                          {sourceUrl ? (
                            <a
                              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-sm font-semibold ${
                                isSelected ? "bg-white/10 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"
                              }`}
                              href={sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink className="h-4 w-4" />
                              Source
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
                  </motion.div>
                </AnimatePresence>
              </div>
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          I’ll surface restaurants, neighborhoods, and hidden gems here as I find them.
        </div>
      )}

      {hasUnlockedNextStep ? (
        <div className={`mt-5 rounded-[24px] border p-4 ${isSelectionConfirmed ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50/80"}`}>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Selected attractions</p>
          <h4 className="mt-2 text-lg font-semibold text-slate-950">These are the attractions</h4>
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedPlaces.map((card, index) => {
              const displayTitle = hasCjkText(card.title) ? fallbackPlaceTitle(card, index) : card.title;

              return (
                <span
                  key={card.id}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${isSelectionConfirmed ? "bg-white text-slate-900 ring-1 ring-emerald-200" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
                >
                  {displayTitle}
                </span>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {!isSelectionConfirmed ? (
              <button
                type="button"
                onClick={onConfirmSelection}
                className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Continue with these attractions
              </button>
            ) : (
              <div className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
                Flights unlocked
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
