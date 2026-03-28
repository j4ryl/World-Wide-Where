import type { DiscoveryRunSnapshot } from "@planit/shared-schema";

type ProgressPanelProps = {
  run: DiscoveryRunSnapshot | null;
};

export function ProgressPanel({ run }: ProgressPanelProps) {
  return (
    <section className="panel terminal-panel">
      <div className="section-header">
        <div>
          <div className="eyebrow">What the app is checking</div>
          <h2>Research updates</h2>
        </div>
        <span className={`status-pill status-${run?.status ?? "queued"}`}>{run?.status ?? "idle"}</span>
      </div>

      {run?.parsedSummary ? <p className="parsed-summary">{run.parsedSummary}</p> : null}

      <div className="terminal-shell">
        {run?.events.length ? (
          run.events.map((event) => (
            <div key={event.id} className="terminal-line">
              <span className="terminal-progress">{String(event.progress).padStart(3, " ")}%</span>
              <span>{event.message}</span>
            </div>
          ))
        ) : (
          <div className="terminal-line">
            <span className="terminal-progress">---</span>
            <span>Enter a trip request to start collecting results.</span>
          </div>
        )}
      </div>
    </section>
  );
}
