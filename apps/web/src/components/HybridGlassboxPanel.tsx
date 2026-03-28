import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";

type HybridGlassboxPanelProps = {
  phaseLabel: string;
  title: string;
  summary: string;
  preview: string;
  userView: ReactNode;
  accent?: "sky" | "amber" | "emerald";
};

const accentMap = {
  sky: {
    chip: "bg-sky-50 text-sky-700 ring-sky-100",
    border: "border-sky-200/80",
    glow: "shadow-[0_30px_80px_rgba(14,165,233,0.15)]",
  },
  amber: {
    chip: "bg-amber-50 text-amber-700 ring-amber-100",
    border: "border-amber-200/80",
    glow: "shadow-[0_30px_80px_rgba(245,158,11,0.16)]",
  },
  emerald: {
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    border: "border-emerald-200/80",
    glow: "shadow-[0_30px_80px_rgba(16,185,129,0.16)]",
  },
} as const;

export function HybridGlassboxPanel({
  phaseLabel,
  title,
  summary,
  preview,
  userView,
  accent = "sky",
}: HybridGlassboxPanelProps) {
  const accentClasses = accentMap[accent];

  return (
    <article className="flex gap-3">
      <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className={`w-full max-w-[48rem] rounded-[28px] border bg-white p-5 shadow-sm ${accentClasses.border}`}>
        <div>
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ring-1 ${accentClasses.chip}`}>
            {phaseLabel}
          </div>
          <h3 className="mt-3 text-xl font-semibold text-slate-950">{title}</h3>
          <p className="mt-2 text-sm leading-7 text-slate-600">{summary}</p>
          {preview ? <p className="mt-4 text-sm text-slate-500">{preview}</p> : null}
        </div>

        <div className="mt-5">{userView}</div>
      </div>
    </article>
  );
}
