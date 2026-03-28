import type { DiscoveryCard } from "@planit/shared-schema";
import { ShieldAlert } from "lucide-react";

type LocalAdvicePanelProps = {
  cards: DiscoveryCard[];
};

export function LocalAdvicePanel({ cards }: LocalAdvicePanelProps) {
  const visibleCards = cards.slice(0, 2);

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-amber-50 p-3 text-amber-700 ring-1 ring-amber-100">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Keep in mind</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-950">A couple of practical notes before you lock the trip.</h3>
        </div>
      </div>

      {visibleCards.length ? (
        <div className="mt-5 space-y-3">
          {visibleCards.map((card) => (
            <article key={card.id} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
              <h4 className="text-lg font-semibold text-slate-900">{card.title}</h4>
              <p className="mt-2 text-sm leading-7 text-slate-600">{card.summary}</p>
              {card.warnings[0] ? (
                <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {card.warnings[0]}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          Disruption warnings, weather caveats, or closure notes will appear here when the agent finds them.
        </div>
      )}
    </section>
  );
}
