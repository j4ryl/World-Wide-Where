import type { FlightWatchDemoResult, SentryAlert } from "@planit/shared-schema";

type SentryPanelProps = {
  alerts: SentryAlert[];
  watches: FlightWatchDemoResult[];
};

export function SentryPanel({ alerts, watches }: SentryPanelProps) {
  return (
    <section className="panel">
      <div className="section-header">
        <div>
          <div className="eyebrow">Trip watch</div>
          <h2>Watch fares before booking, then watch the trip itself</h2>
        </div>
      </div>

      {watches.length ? (
        <div className="warning-stack">
          {watches.map((watch) => (
            <article key={watch.watchId} className="warning-card">
              <div className="card-topline">
                <span className="trust-badge">Watching fares</span>
                <span className="verification-text">{watch.status}</span>
              </div>
              <h4>{watch.title}</h4>
              <p>{watch.summary}</p>
              {watch.alert ? <p className="warning-copy">{watch.alert.trigger}</p> : null}
              <p className="fit-copy">{watch.alert?.suggestedAction ?? watch.recommendedChannel}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-copy">
          If you are not ready to book flights yet, watch a fare first. The demo will surface a cached price-drop alert for that route.
        </p>
      )}

      {alerts.length ? (
        <div className="warning-stack">
          {alerts.map((alert) => (
            <article key={alert.id} className="warning-card">
              <div className="card-topline">
                <span className="trust-badge">{alert.status === "action_needed" ? "Watch triggered" : "Draft ready"}</span>
                {alert.holdWindow ? <span className="verification-text">{alert.holdWindow}</span> : null}
              </div>
              <h4>{alert.title}</h4>
              <p>{alert.summary}</p>
              <p className="warning-copy">{alert.trigger}</p>
              <p className="fit-copy">{alert.suggestedAction}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-copy">
          Once the trip is shaped, this panel can also show route warnings like weather, closures, or disruption checks.
        </p>
      )}
    </section>
  );
}
