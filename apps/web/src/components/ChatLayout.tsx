import type { ReactNode } from "react";
import { Bot } from "lucide-react";

type ChatLayoutProps = {
  headerTitle: string;
  headerBody: string;
  children: ReactNode;
  composer: ReactNode;
};

export function ChatLayout({ headerTitle, headerBody, children, composer }: ChatLayoutProps) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(15,23,42,0.08),_transparent_24%),linear-gradient(180deg,_#f8fafc,_#eef2ff)] text-slate-950">
      <div className="mx-auto w-full max-w-5xl px-0 sm:px-6">
        <section className="flex min-h-screen flex-col border-x border-white/60 bg-white/50 shadow-[0_0_0_1px_rgba(255,255,255,0.28)] backdrop-blur-xl sm:my-4 sm:min-h-[calc(100vh-2rem)] sm:rounded-[28px] sm:border sm:border-white/70 sm:shadow-[0_24px_80px_rgba(15,23,42,0.10)]">
          <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/72 backdrop-blur-xl">
            <div className="mx-auto flex w-full max-w-3xl items-start gap-3 px-4 py-3.5 sm:px-6">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white/90 text-slate-700 shadow-sm">
                <Bot className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-base font-semibold tracking-tight text-slate-950 sm:text-lg">
                  {headerTitle}
                </h1>
                <p className="mt-1 text-sm leading-6 text-slate-600">{headerBody}</p>
              </div>
            </div>
          </header>

          <div className="flex-1">
            <div className="mx-auto w-full max-w-3xl px-4 py-5 pb-28 sm:px-6 sm:py-7 sm:pb-32">{children}</div>
          </div>

          <footer className="sticky bottom-0 z-20 border-t border-slate-200/70 bg-white/78 backdrop-blur-xl">
            <div className="mx-auto w-full max-w-3xl px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2.5 sm:px-6">
              {composer}
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}
