# World Wide Where

World Wide Where is a trip-planning monorepo built around one idea: the travel web is fragmented, noisy, and hard to automate unless the workflow is tightly controlled.

Flights live across metasearch pages, aggregators, and airline sites. Hotels live across OTAs and direct hotel pages. Local transport lives on operator sites. Good places to visit often show up on travel blogs, social posts, and forum threads. World Wide Where turns that fragmented surface area into a deterministic pipeline that can research, verify, normalize, and schedule trip options with Tinyfish browser runs where static scraping is not enough.

## What This Repo Does

- Accepts a structured trip request.
- Breaks the request into deterministic planning buckets:
  - `food-hidden-gems`
  - `local-advice`
  - `hotels`
  - `local-transport`
  - `flights`
  - `car-rental`
- Uses source registries, seed data, and live scouting to find candidate pages.
- Plans small, explicit Tinyfish jobs for hard pages.
- Streams extraction progress back to the UI.
- Normalizes extracted results into shared card schemas.
- Dedupes and enriches cards for the trip board.
- Builds a timeline from selected cards, dates, and busy windows.

The result is not "ask an AI and hope." The result is a staged workflow with controlled buckets, controlled source coverage, bounded browser automation, and typed outputs.

## Why Tinyfish Matters Here

Travel pages are frequently bad targets for simple HTML scraping:

- flight pages are dynamic and often reorder results
- hotel pages hide cancellation and breakfast terms behind interactive UI
- transport pages can be stateful or region-specific
- blog and social pages often need a browser session to render usable content

World Wide Where uses Tinyfish in the worker layer for pages that need a real browser. That keeps the extraction step deterministic enough to reason about:

- the API decides which domains are allowed
- the worker sends an explicit goal for each page
- Tinyfish is expected to stay on the requested domain
- streamed events are converted into typed progress messages
- extracted observations are normalized into flight and hotel structures
- if Tinyfish fails or is unavailable, the worker falls back to a local simulated extractor

## Hackathon Pitch: How We Use Tinyfish

If you need a short explanation for judges, use this:

> We use Tinyfish as the browser automation layer for the messy part of travel planning. Our API first decides exactly which flight, hotel, transport, and place pages are worth checking, then our worker sends Tinyfish small, domain-bounded jobs with explicit goals. Tinyfish opens the real page, extracts the visible facts we care about, streams progress back to our app, and we normalize the result into structured itinerary cards instead of raw scraped text.

The practical value is:

- Tinyfish handles dynamic sites that static scraping misses
- we keep the workflow deterministic by constraining domains and goals
- the app gets live progress and structured outputs, not just screenshots
- extracted data feeds directly into ranking, comparison, and itinerary planning

In this project, Tinyfish is not the planner. It is the browser execution layer inside a larger deterministic pipeline.

## Deterministic Workflow

```text
DiscoverRequest
  -> search plan
  -> source selection
  -> Tinyfish job planning
  -> browser extraction
  -> structured card synthesis
  -> dedupe + image enrichment
  -> timeline generation
```

### 1. Intake a structured trip request

The API accepts a `DiscoverRequest` with:

- free-text trip brief
- origin and destination
- dates
- traveler counts
- flight preferences
- hotel preferences
- busy windows
- discovery mode: `hybrid`, `live`, or `cache`

This is defined in `packages/shared-schema/src/schemas.ts`.

### 2. Convert the prompt into a search plan

`apps/api/src/planner.ts` turns the request into a `SearchPlan`:

- infers trip length
- infers relevant search buckets
- forces a place-discovery bucket for trip-planning prompts
- orders buckets for conversation flow
- adds freshness and budget notes

The bucket order is deliberate. Place discovery is foregrounded first, then local advice, then logistics.

### 3. Find sources in a controlled way

World Wide Where does not rely on one giant open-ended browse step.

It combines:

- seed cards from `data/cache.seed.json`
- source registry entries from `data/sources.json`
- flight registry entries from `data/flight-sources.json`
- live source discovery through the API layer

Flights get extra control. The code uses a dedicated registry and deterministic fallback coverage so one sponsored fare page does not dominate the answer. The fallback flight mix is intentionally balanced:

- one metasearch source
- up to three aggregators
- one direct or regional airline source

Asia-heavy routes are biased toward Asia-relevant providers.

### 4. Plan bounded Tinyfish jobs

`apps/api/src/discovery-agent.ts` converts source candidates into a small set of extraction jobs. The important design rule is that goals are narrow and sequential, not vague.

Each job includes:

- `url`
- `domain`
- `bucket`
- `platform`
- `promptHint`
- explicit `goal`
- `browserProfile`
- timeout

This is the key to deterministic browser automation. Instead of "research this trip," each Tinyfish run gets a constrained task like:

- compare public fares for this exact route
- extract visible breakfast and cancellation terms
- pull out named places from a specific guide page

### 5. Run Tinyfish in the worker

`apps/worker/src/index.ts` is the browser-extraction service.

It provides:

- `POST /tasks/extract`
- `POST /tasks/extract-stream`

Behavior:

- jobs are queued with global and per-domain concurrency limits
- the worker calls Tinyfish SSE at `/v1/automation/run-sse`
- streamed provider events are normalized into:
  - `started`
  - `progress`
  - `live_url`
  - `completed`
  - `fallback`
  - `error`
- hostname checks prevent navigation drift outside the allowed domain
- flight and hotel results are parsed into structured observations
- currency strings are normalized for comparison
- if Tinyfish is missing or stalls, the worker falls back automatically

That combination is what makes the pipeline robust against a fragmented online travel stack.

### 6. Synthesize typed travel cards

After extraction, the API synthesizes cards for the board:

- flight cards
- hotel cards
- transport cards
- place cards
- local advice cards

Cards carry structured fields such as:

- trust tag
- trust summary
- provenance URLs
- quotes
- warnings
- price summaries
- flight observations
- hotel observations
- coordinates when available

Cards are then deduped and lightly ranked so the strongest evidence survives.

### 7. Enrich the board

The pipeline can add place images and continuously stream partial board updates while the run is still active. This gives a progressive UI without changing the deterministic backend stages.

### 8. Build the itinerary timeline

The API exposes:

- `POST /api/timeline`
- `POST /api/timeline/recalculate`

Timeline generation respects:

- user-selected card order
- trip dates
- busy windows
- rough travel time between coordinates
- opening-hour windows when present

There is an OpenAI-assisted timeline path and a deterministic fallback scheduler. If the model output is missing or invalid, the fallback builder still produces a usable itinerary.

## What "Fully Automated" Means In This Repo

World Wide Where already automates:

- request parsing
- source scouting
- live browser extraction
- result normalization
- card synthesis
- timeline generation

The remaining policy choice is which discovered cards should be scheduled. Today the API expects `selectedCardIds` for timeline creation.

If you want a completely hands-off itinerary run, add a small deterministic policy layer between discovery and timeline generation. A practical policy is:

1. choose 1 hotel with the strongest preference match
2. choose 1 to 2 transport cards needed for access
3. choose 3 to 6 specific `food-hidden-gems` cards with concrete names and coordinates
4. treat `local-advice` as warnings, not scheduled stops
5. optionally keep flights as bookable references instead of timeline nodes

That policy can live in the web app, the API, or an external orchestrator.

## Repo Layout

- `apps/web`: React + Vite trip-planning UI
- `apps/api`: discovery orchestration, card synthesis, timeline generation
- `apps/worker`: Tinyfish and fallback extraction worker
- `packages/shared-schema`: shared Zod schemas for requests, runs, cards, and timelines
- `data/`: seeded cards, source registries, and cache files

## Local Development

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Fill the keys you need:

- `OPENAI_API_KEY` for live planning, synthesis, and timeline generation
- `TINYFISH_API_KEY` for live browser extraction on hard pages
- `TINYFISH_BASE_URL` for the Tinyfish endpoint
- `TINYFISH_BROWSER_PROFILE` for `lite` or `stealth`
- `GOOGLE_PLACES_API_KEY` if you want live place-image enrichment
- `VITE_MAPBOX_TOKEN` if you want the live map

3. Install dependencies:

```bash
npm install
```

4. Start the full stack:

```bash
npm run dev
```

5. Open the app at [http://localhost:5173](http://localhost:5173).

## Useful Environment Variables

These settings are especially relevant to deterministic Tinyfish workflows:

- `DISCOVERY_MODE`
  - `hybrid`: combine live research with cached safety nets
  - `live`: prefer live-only behavior
  - `cache`: use saved seed research
- `WORKER_GLOBAL_CONCURRENCY`
  - caps total worker jobs
- `WORKER_PER_DOMAIN_CONCURRENCY`
  - prevents hammering one site
- `VERIFY_FETCH_TIMEOUT_MS`
  - verification timeout for API-side fetches
- `OPENAI_WEB_SEARCH_TIMEOUT_MS`
  - cap for search-heavy model steps
- `PUBLIC_APP_URL`
  - allowed origin for API and worker CORS

## API Flow

### Start a discovery run

```bash
curl -X POST http://localhost:3000/api/discover \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Plan a 4 day Kuching trip with cafes, local food, one nature day, and practical weather advice",
    "origin": "Singapore",
    "destination": "Kuching",
    "dates": {
      "start": "2026-06-12",
      "end": "2026-06-15"
    },
    "travelers": {
      "adults": 2,
      "children": 0
    },
    "flightPreferences": {
      "baggage": "cabin_only",
      "boarding": "no_preference",
      "meals": "no_preference",
      "fareStyle": "balanced",
      "sellerPreference": "direct_preferred"
    },
    "hotelPreferences": {
      "freeCancellation": "preferred",
      "breakfast": "preferred",
      "payment": "pay_later_preferred",
      "style": "balanced",
      "areaPreference": "walkable central area",
      "starPreference": "three_plus"
    },
    "busyWindows": [],
    "mode": "hybrid",
    "pricingMode": "public"
  }'
```

The API returns a `runId`.

### Stream run progress

```bash
curl -N http://localhost:3000/api/runs/<runId>/stream
```

This streams planner, scout, verify, extract, partial-board, fallback, and done events.

### Read the final run snapshot

```bash
curl http://localhost:3000/api/runs/<runId>
```

### Build a timeline from chosen cards

```bash
curl -X POST http://localhost:3000/api/timeline \
  -H "Content-Type: application/json" \
  -d '{
    "runId": "<runId>",
    "selectedCardIds": ["card-1", "card-2", "card-3"],
    "dates": {
      "start": "2026-06-12",
      "end": "2026-06-15"
    },
    "busyWindows": []
  }'
```

## Commands

```bash
npm run dev
npm run build
npm run typecheck
npm run test
```

## Why This Matters

Planning a trip usually means jumping between airline sites, hotel apps, maps, blogs, TikToks, and random forum posts. World Wide Where brings that into one flow.

- it finds the useful pages
- it uses Tinyfish to read the hard ones
- it turns messy travel research into clear options
- it helps people move from inspiration to an actual itinerary faster

For the hackathon, the main idea is simple: instead of making users do all the tab-hopping themselves, we let the system do the research work and return something structured, usable, and easy to act on.
