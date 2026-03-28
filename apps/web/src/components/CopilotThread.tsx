import type {
  DiscoverRequest,
  DiscoveryCard,
  DiscoveryRunSnapshot,
  FlightWatchDemoResult,
  TimelineNode,
} from "@planit/shared-schema";

type CopilotThreadProps = {
  request: DiscoverRequest;
  run: DiscoveryRunSnapshot | null;
  selectedCards: DiscoveryCard[];
  timelineNodes: TimelineNode[];
  watches: FlightWatchDemoResult[];
  onOpenFlightPreferences: () => void;
};

function nextStepCopy(selectedCards: DiscoveryCard[], timelineNodes: TimelineNode[], watchCount: number) {
  if (selectedCards.length === 0) {
    return "Pick a few places first. I will then fit the hotel and flights around those places.";
  }

  if (selectedCards.length > 0 && timelineNodes.length === 0) {
    return "You have enough places to shape the trip. Build the schedule next so the route becomes concrete.";
  }

  if (timelineNodes.length > 0 && watchCount === 0) {
    return "The route is taking shape. If you are still undecided on flights, watch a fare before booking.";
  }

  return "The trip has a workable shape. Refine timing, then open booking links when you are ready.";
}

export function CopilotThread({
  request,
  run,
  selectedCards,
  timelineNodes,
  watches,
  onOpenFlightPreferences,
}: CopilotThreadProps) {
  const visibleEvents = run?.events.slice(-6) ?? [];
  const shouldAskFlightPreferences =
    (request.prompt.toLowerCase().includes("flight") ||
      request.prompt.toLowerCase().includes("fly") ||
      request.prompt.toLowerCase().includes("airline")) &&
    !request.flightPreferences;

  return (
    <div className="copilot-thread">
      <article className="message-row assistant-row">
        <div className="message-avatar">AI</div>
        <div className="message-bubble assistant-bubble">
          <p>
            {run?.parsedSummary ??
              "Describe the trip you want. I will research places first, then fit the stay and flights around the route."}
          </p>
          <div className="message-meta">
            <span className={`status-pill status-${run?.status ?? "queued"}`}>{run?.status ?? "idle"}</span>
            <span>
              {request.origin && request.destination
                ? `${request.origin} to ${request.destination}`
                : "Route details can be added when needed"}
            </span>
            <span>
              {request.travelers?.adults ?? 2} adult{(request.travelers?.adults ?? 2) === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </article>

      {visibleEvents.length ? (
        visibleEvents.map((event) => (
          <article key={event.id} className="message-row assistant-row">
            <div className="message-avatar small-avatar">{String(event.progress).padStart(2, "0")}%</div>
            <div className="message-bubble stream-bubble">
              <p>{event.message}</p>
            </div>
          </article>
        ))
      ) : (
        <article className="message-row assistant-row">
          <div className="message-avatar small-avatar">..</div>
          <div className="message-bubble stream-bubble">
            <p>I will stream the research steps here once the search starts.</p>
          </div>
        </article>
      )}

      {shouldAskFlightPreferences ? (
        <article className="message-row assistant-row">
          <div className="message-avatar">AI</div>
          <div className="message-bubble assistant-bubble">
            <p>
              Before I compare flights, tell me what matters on the fare itself. Bags, meals, priority
              boarding, and direct-airline preference can change which option is actually best.
            </p>
            <div className="message-meta">
              <button className="secondary-button" type="button" onClick={onOpenFlightPreferences}>
                Add flight needs
              </button>
            </div>
          </div>
        </article>
      ) : null}

      <article className="message-row assistant-row">
        <div className="message-avatar">AI</div>
        <div className="message-bubble recommendation-bubble">
          <p>{nextStepCopy(selectedCards, timelineNodes, watches.length)}</p>
          <div className="message-meta">
            <span>{selectedCards.length} places selected</span>
            <span>{timelineNodes.length} schedule items</span>
            <span>{watches.length} fare watch{watches.length === 1 ? "" : "es"}</span>
          </div>
        </div>
      </article>
    </div>
  );
}
