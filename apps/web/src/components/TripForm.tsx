import { useEffect, useMemo, useState } from "react";
import type { BusyWindow, DiscoverRequest, FlightPreferences } from "@planit/shared-schema";
import { z } from "zod";

type TripFormProps = {
  value: DiscoverRequest;
  onChange: (nextValue: DiscoverRequest) => void;
  onSubmit: () => void;
  isLoading: boolean;
};

type SheetKey = "origin" | "destination" | "dates" | "travelers" | "busyWindows" | "flightPreferences" | null;

const originOptions = ["Singapore", "Kuala Lumpur", "Jakarta", "Bangkok", "Hong Kong"];
const destinationOptions = ["Kuching", "Tokyo", "Seoul", "Switzerland", "Taipei"];

const launchSchema = z.object({
  origin: z.string().trim().min(1),
  destination: z.string().trim().min(1),
  dates: z.object({
    start: z.string().min(1),
    end: z.string().min(1),
  }),
});

function updateBusyWindow(
  busyWindows: BusyWindow[],
  id: string,
  key: keyof BusyWindow,
  value: string,
) {
  return busyWindows.map((window) => (window.id === id ? { ...window, [key]: value } : window));
}

function promptNeedsFlightPreferences(value: DiscoverRequest) {
  const prompt = value.prompt.toLowerCase();

  return (
    (prompt.includes("flight") || prompt.includes("fly") || prompt.includes("airline")) &&
    !value.flightPreferences
  );
}

function ensureFlightPreferences(value: DiscoverRequest, patch: Partial<FlightPreferences>) {
  return {
    baggage: value.flightPreferences?.baggage ?? "cabin_only",
    boarding: value.flightPreferences?.boarding ?? "no_preference",
    meals: value.flightPreferences?.meals ?? "no_preference",
    fareStyle: value.flightPreferences?.fareStyle ?? "balanced",
    sellerPreference: value.flightPreferences?.sellerPreference ?? "any",
    ...patch,
  } satisfies FlightPreferences;
}

function formatFlightPreferenceChip(preferences: FlightPreferences | undefined) {
  if (!preferences) {
    return "I will ask";
  }

  const baggageMap = {
    no_bag: "No bag",
    cabin_only: "Cabin bag",
    one_checked_bag: "1 checked bag",
    two_checked_bags: "2 checked bags",
  } as const;

  return baggageMap[preferences.baggage];
}

export function TripForm({ value, onChange, onSubmit, isLoading }: TripFormProps) {
  const [activeSheet, setActiveSheet] = useState<SheetKey>(null);

  useEffect(() => {
    const openFlightPreferences = () => {
      setActiveSheet("flightPreferences");
    };

    window.addEventListener("planit:open-flight-preferences", openFlightPreferences);

    return () => {
      window.removeEventListener("planit:open-flight-preferences", openFlightPreferences);
    };
  }, []);

  const summaryChips = useMemo(
    () => [
      { key: "origin" as const, label: "Origin", value: value.origin || "Add" },
      { key: "destination" as const, label: "Destination", value: value.destination || "Add" },
      {
        key: "dates" as const,
        label: "Dates",
        value:
          value.dates?.start && value.dates?.end ? `${value.dates.start} to ${value.dates.end}` : "Add",
      },
      {
        key: "travelers" as const,
        label: "Travelers",
        value: `${value.travelers?.adults ?? 2} adult${(value.travelers?.adults ?? 2) === 1 ? "" : "s"}${(value.travelers?.children ?? 0) > 0 ? `, ${value.travelers?.children} child` : ""}`,
      },
      {
        key: "busyWindows" as const,
        label: "Busy times",
        value: value.busyWindows.length ? `${value.busyWindows.length} blocked` : "Optional",
      },
      {
        key: "flightPreferences" as const,
        label: "Flight needs",
        value: formatFlightPreferenceChip(value.flightPreferences),
      },
    ],
    [value],
  );

  function openMissingFieldSheet() {
    const result = launchSchema.safeParse({
      origin: value.origin,
      destination: value.destination,
      dates: {
        start: value.dates?.start ?? "",
        end: value.dates?.end ?? "",
      },
    });

    if (result.success) {
      return false;
    }

    const path = result.error.issues[0]?.path[0];

    if (path === "origin" || path === "destination" || path === "dates") {
      setActiveSheet(path);
      return true;
    }

    setActiveSheet("dates");
    return true;
  }

  function openContextualPreferenceSheet() {
    if (promptNeedsFlightPreferences(value)) {
      setActiveSheet("flightPreferences");
      return true;
    }

    return false;
  }

  return (
    <>
      <article className="message-row user-row composer-message-row">
        <div className="message-avatar">You</div>
        <div className="message-bubble user-bubble composer-bubble">
          <div className="composer-heading">
            <div className="eyebrow">Trip copilot</div>
            <h1>Start with a message. I will ask for details only when they matter.</h1>
            <p className="hero-copy">
              Say what kind of trip you want in plain language. I will research places first, then
              fit the stay and flights around the route.
            </p>
          </div>

          <div className="composer-shell">
        <label className="field prompt-field">
          <span>Your trip message</span>
          <textarea
            value={value.prompt}
            onChange={(event) => onChange({ ...value, prompt: event.target.value })}
            placeholder="Example: I need a 3-day trip to Kuching. Find me reliable boat schedules to Bako National Park, hidden-gem cafe spots, then suggest the hotel and flights that fit those places best."
            rows={6}
          />
        </label>

        <div className="context-chip-row">
          {summaryChips.map((chip) => (
            <button
              key={chip.key}
              className="context-chip"
              type="button"
              onClick={() => setActiveSheet(chip.key)}
            >
              <span>{chip.label}</span>
              <strong>{chip.value}</strong>
            </button>
          ))}
        </div>

        <div className="composer-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() =>
              onChange({
                prompt:
                  "I need a 3-day trip to Kuching. Find me reliable boat schedules to Bako National Park, a local car rental, hidden-gem cafe spots, then suggest the hotel and flights that fit those places best.",
                origin: "Singapore",
                destination: "Kuching",
                travelers: { adults: 2, children: 0 },
                dates: {
                  start: "2026-06-12",
                  end: "2026-06-14",
                },
                flightPreferences: {
                  baggage: "one_checked_bag",
                  boarding: "no_preference",
                  meals: "no_preference",
                  fareStyle: "balanced",
                  sellerPreference: "direct_preferred",
                },
                busyWindows: [],
                mode: "hybrid",
                pricingMode: "public",
              })
            }
          >
            Use sample prompt
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              if (openMissingFieldSheet()) {
                return;
              }

              if (openContextualPreferenceSheet()) {
                return;
              }

              onSubmit();
            }}
            disabled={isLoading || !value.prompt.trim()}
          >
            {isLoading ? "Starting search..." : "Send to copilot"}
          </button>
        </div>
          </div>
        </div>
      </article>

      {activeSheet ? (
        <div className="glass-sheet-backdrop" role="presentation" onClick={() => setActiveSheet(null)}>
          <div className="glass-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <div>
                <div className="eyebrow">Trip details</div>
                <h2>
                  {activeSheet === "origin" && "Where are you flying from?"}
                  {activeSheet === "destination" && "Where are you planning to go?"}
                  {activeSheet === "dates" && "When is the trip?"}
                  {activeSheet === "travelers" && "Who is traveling?"}
                  {activeSheet === "busyWindows" && "What times should stay blocked?"}
                  {activeSheet === "flightPreferences" && "What matters on the flight?"}
                </h2>
              </div>
              <button className="ghost-button" type="button" onClick={() => setActiveSheet(null)}>
                Close
              </button>
            </div>

            {activeSheet === "origin" ? (
              <label className="field">
                <span>Origin</span>
                <select value={value.origin} onChange={(event) => onChange({ ...value, origin: event.target.value })}>
                  <option value="">Select origin</option>
                  {originOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {activeSheet === "destination" ? (
              <label className="field">
                <span>Destination</span>
                <select
                  value={value.destination}
                  onChange={(event) => onChange({ ...value, destination: event.target.value })}
                >
                  <option value="">Select destination</option>
                  {destinationOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {activeSheet === "dates" ? (
              <div className="field-grid">
                <label className="field">
                  <span>Start date</span>
                  <input
                    type="date"
                    value={value.dates?.start ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        dates: {
                          start: event.target.value,
                          end: value.dates?.end,
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>End date</span>
                  <input
                    type="date"
                    value={value.dates?.end ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        dates: {
                          start: value.dates?.start,
                          end: event.target.value,
                        },
                      })
                    }
                  />
                </label>
              </div>
            ) : null}

            {activeSheet === "travelers" ? (
              <div className="field-grid">
                <label className="field">
                  <span>Adults</span>
                  <input
                    min={1}
                    type="number"
                    value={value.travelers?.adults ?? 2}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        travelers: {
                          adults: Number(event.target.value),
                          children: value.travelers?.children ?? 0,
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Children</span>
                  <input
                    min={0}
                    type="number"
                    value={value.travelers?.children ?? 0}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        travelers: {
                          adults: value.travelers?.adults ?? 2,
                          children: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
              </div>
            ) : null}

            {activeSheet === "busyWindows" ? (
              <>
                <div className="busy-header">
                  <div>
                    <h2>Busy times</h2>
                    <p>Add any times that should stay blocked so the schedule avoids them.</p>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      onChange({
                        ...value,
                        busyWindows: [
                          ...value.busyWindows,
                          {
                            id: crypto.randomUUID(),
                            date: value.dates?.start ?? "",
                            startTime: "13:00",
                            endTime: "15:00",
                            label: "Busy",
                          },
                        ],
                      })
                    }
                  >
                    Add busy time
                  </button>
                </div>
                {value.busyWindows.length > 0 ? (
                  <div className="busy-list">
                    {value.busyWindows.map((window) => (
                      <div key={window.id} className="busy-row">
                        <input
                          type="date"
                          value={window.date}
                          onChange={(event) =>
                            onChange({
                              ...value,
                              busyWindows: updateBusyWindow(value.busyWindows, window.id, "date", event.target.value),
                            })
                          }
                        />
                        <input
                          type="time"
                          value={window.startTime}
                          onChange={(event) =>
                            onChange({
                              ...value,
                              busyWindows: updateBusyWindow(
                                value.busyWindows,
                                window.id,
                                "startTime",
                                event.target.value,
                              ),
                            })
                          }
                        />
                        <input
                          type="time"
                          value={window.endTime}
                          onChange={(event) =>
                            onChange({
                              ...value,
                              busyWindows: updateBusyWindow(
                                value.busyWindows,
                                window.id,
                                "endTime",
                                event.target.value,
                              ),
                            })
                          }
                        />
                        <input
                          value={window.label}
                          onChange={(event) =>
                            onChange({
                              ...value,
                              busyWindows: updateBusyWindow(value.busyWindows, window.id, "label", event.target.value),
                            })
                          }
                        />
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() =>
                            onChange({
                              ...value,
                              busyWindows: value.busyWindows.filter((entry) => entry.id !== window.id),
                            })
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-copy">No blocked times yet. Add one if you already know part of the day is taken.</p>
                )}
              </>
            ) : null}

            {activeSheet === "flightPreferences" ? (
              <div className="field-grid">
                <label className="field">
                  <span>Baggage</span>
                  <select
                    value={value.flightPreferences?.baggage ?? "cabin_only"}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        flightPreferences: ensureFlightPreferences(value, {
                          baggage: event.target.value as FlightPreferences["baggage"],
                        }),
                      })
                    }
                  >
                    <option value="no_bag">No bag</option>
                    <option value="cabin_only">Cabin bag only</option>
                    <option value="one_checked_bag">One checked bag</option>
                    <option value="two_checked_bags">Two checked bags</option>
                  </select>
                </label>
                <label className="field">
                  <span>Priority boarding</span>
                  <select
                    value={value.flightPreferences?.boarding ?? "no_preference"}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        flightPreferences: ensureFlightPreferences(value, {
                          boarding: event.target.value as FlightPreferences["boarding"],
                        }),
                      })
                    }
                  >
                    <option value="no_preference">No preference</option>
                    <option value="priority_preferred">Preferred</option>
                    <option value="priority_required">Required</option>
                  </select>
                </label>
                <label className="field">
                  <span>Meals</span>
                  <select
                    value={value.flightPreferences?.meals ?? "no_preference"}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        flightPreferences: ensureFlightPreferences(value, {
                          meals: event.target.value as FlightPreferences["meals"],
                        }),
                      })
                    }
                  >
                    <option value="no_preference">No preference</option>
                    <option value="meal_preferred">Preferred</option>
                    <option value="meal_required">Required</option>
                  </select>
                </label>
                <label className="field">
                  <span>Compare fares by</span>
                  <select
                    value={value.flightPreferences?.fareStyle ?? "balanced"}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        flightPreferences: ensureFlightPreferences(value, {
                          fareStyle: event.target.value as FlightPreferences["fareStyle"],
                        }),
                      })
                    }
                  >
                    <option value="cheapest">Cheapest fare</option>
                    <option value="balanced">Best balance</option>
                    <option value="extras_included">Extras included</option>
                  </select>
                </label>
                <label className="field">
                  <span>Where to book</span>
                  <select
                    value={value.flightPreferences?.sellerPreference ?? "any"}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        flightPreferences: ensureFlightPreferences(value, {
                          sellerPreference: event.target.value as FlightPreferences["sellerPreference"],
                        }),
                      })
                    }
                  >
                    <option value="any">Any seller</option>
                    <option value="direct_preferred">Direct airline preferred</option>
                    <option value="direct_only">Direct airline only</option>
                  </select>
                </label>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
