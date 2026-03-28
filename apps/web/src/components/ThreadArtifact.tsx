import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";

type ThreadArtifactProps = {
  title: string;
  summary: string;
  children: ReactNode;
};

export function ThreadArtifact({ title, summary, children }: ThreadArtifactProps) {
  return (
    <article className="flex gap-3">
      <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="w-full max-w-[48rem] rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Structured artifact</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-950">{title}</h3>
          <p className="mt-2 text-sm leading-7 text-slate-600">{summary}</p>
        </div>
        {children}
      </div>
    </article>
  );
}
