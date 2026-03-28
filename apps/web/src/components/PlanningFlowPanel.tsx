import type { DiscoveryCard } from "@planit/shared-schema";

const flowSteps: Array<{
  title: string;
  description: string;
  buckets: DiscoveryCard["bucket"][];
}> = [
  {
    title: "1. Pick the places first",
    description: "Choose the attractions, routes, and hidden gems that actually make the trip worth taking.",
    buckets: ["food-hidden-gems", "local-transport"],
  },
  {
    title: "2. Let the app suggest the stay and arrival",
    description: "Once the places are clear, the hotel and flight suggestions can fit the geography instead of fighting it. If you are not ready to book yet, watch the fare first.",
    buckets: ["hotels", "flights", "car-rental"],
  },
  {
    title: "3. Keep the warnings in view",
    description: "Warnings are informational. They should guide the plan, not become selectable stops.",
    buckets: ["local-advice"],
  },
];

type PlanningFlowPanelProps = {
  cards: DiscoveryCard[];
  selectedCardIds: string[];
  onBuildSchedule: () => void;
  isBuildingSchedule: boolean;
};

export function PlanningFlowPanel({
  cards,
  selectedCardIds,
  onBuildSchedule,
  isBuildingSchedule,
}: PlanningFlowPanelProps) {
  return (
    <section className="panel quick-actions-panel">
      <div className="section-header">
        <div>
          <div className="eyebrow">How people usually plan</div>
          <h2>Build the trip in a more natural order</h2>
        </div>
        <span className="section-copy">{selectedCardIds.length} selected</span>
      </div>

      <div className="flow-list">
        {flowSteps.map((step) => {
          const matchingCards = cards.filter((card) => step.buckets.includes(card.bucket));
          const selectedCount = matchingCards.filter((card) => selectedCardIds.includes(card.id)).length;

          return (
            <article key={step.title} className={`flow-step ${selectedCount > 0 ? "flow-step-active" : ""}`}>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
              <span>
                {selectedCount}/{matchingCards.length || 0} chosen
              </span>
            </article>
          );
        })}
      </div>

      <p className="empty-copy">
        The hard part is not finding options. It is making the places, stay, and flights fit each
        other without backtracking. This flow starts with the places first.
      </p>

      <button
        className="primary-button"
        type="button"
        disabled={selectedCardIds.length === 0 || isBuildingSchedule}
        onClick={onBuildSchedule}
      >
        {isBuildingSchedule ? "Building schedule..." : "Build trip schedule"}
      </button>
    </section>
  );
}
