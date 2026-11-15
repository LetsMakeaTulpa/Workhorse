# Workhorse — Search Intelligence

Workhorse is a search engine with an LLM face. The user chooses a Featherless.ai model, one or more search engines, and optional dork rules. The selected model plans query expansions; the backend runs the enabled search providers, ranks and deduplicates the results, and gives the retrieved evidence to the model for a cited answer and grounded follow-up questions.

## Primary experience

- Focused chat/search interface, not a general-purpose agent dashboard.
- Featherless model selector backed by live model discovery.
- Search engine multi-select: Exa, SearXNG, Brave, Tavily, and Serper.
- Dork builder for site, filetype, title, URL, exact phrase, exclusion, and date operators.
- Standard and Deep retrieval modes.
- LLM query planning using the selected Featherless model, followed by concurrent retrieval.
- Unified ranked results, provider-by-provider inspection, source provenance, and citations.
- Follow-up questions generated after evidence retrieval.
- Conversation history with rename, archive/restore, delete, and shareable read-only snapshots.
- Library for saved searches and reusable model + engine + dork configurations.

## Repository layout

- \`src/SearchApp.tsx\`, \`src/SearchApp.css\` — focused Workhorse search interface.
- \`src/App.tsx\` — retained Venice Lite interface/source; not the current entry point.
- \`fieldwork-search/backend/\` — FastAPI search and LLM service.
- \`fieldwork-search/backend/providers/\` — Featherless and search-provider adapters.
- \`fieldwork-search/backend/tests/\` — backend tests.
- \`.agents/skills/\` — Workhorse product, UI, provider, search, evidence, library, and quality skills.

## Run the frontend

Requires Node.js 22+.

\`\`\`bash
npm ci
npm run typecheck
npm run dev
\`\`\`

The frontend can render without a backend, but live search requires a running Workhorse API. Open **Model & connection settings** and enter the API base URL. Leave it blank when the frontend and API are served from the same origin.

## Run the backend

Requires Python 3.11+.

\`\`\`bash
cd fieldwork-search
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
\`\`\`

Copy \`.env.example\` to \`.env\`, configure server-side credentials, then:

\`\`\`bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
\`\`\`

API health: \`/api/health\`. The React frontend uses \`/api/config\`, \`/api/models\`, \`/api/conversations\`, and \`/api/chat/stream\`.

## Server configuration

All API keys remain on the server. Do not paste them into the browser or commit them.

- \`FEATHERLESS_API_KEY\` — required for model planning and answer generation.
- \`FEATHERLESS_BASE_URL\` — defaults to \`https://api.featherless.ai/v1\`.
- \`FEATHERLESS_MODEL_ID\` — fallback model if the request omits a model.
- \`EXA_API_KEY\` — optional Exa semantic search.
- \`SEARXNG_URL\` — optional trusted SearXNG instance with JSON output enabled.
- \`BRAVE_API_KEY\` — optional Brave Search API.
- \`TAVILY_API_KEY\` — optional Tavily search.
- \`SERPER_API_KEY\` — optional Serper search.
- \`DATABASE_URL\` — SQLite locally; PostgreSQL for durable hosted conversation history.
- \`APP_PASSWORD\` — optional single-password access gate; set it for public deployment.
- \`CORS_ORIGINS\` — comma-separated allowed frontend origins.

A provider is selectable in the interface but only returns results when its server credential or endpoint is configured. Provider failures are reported individually; successful providers can still return results.

## Search and synthesis flow

1. The user asks a question and chooses a model, engines, and dorks.
2. The selected model creates a bounded query plan. If planning fails, Workhorse falls back to the literal query.
3. Enabled providers run concurrently for each planned query.
4. Results are normalized, canonicalized, deduplicated, and ranked using weighted Reciprocal Rank Fusion.
5. Workhorse sends source excerpts to the selected model as untrusted reference material.
6. The model writes an answer with numbered citations and proposes follow-up searches.
7. The original conversation, messages, sources, and provider status are persisted by the backend.

Dork syntax is passed through as query text. Operator support varies by provider; the UI does not claim that every engine interprets every operator identically.

## Current persistence boundary

Conversation history is stored by the backend database. Saved-search entries and model/engine/dork presets currently use browser local storage, so they are available in the same browser profile but are not yet synchronized across devices. Share links are read-only snapshots encoded into the URL; they do not expose server credentials.

## Preview and deployment

The \`workhorse-search-engine-skills\` branch is configured to build and publish the frontend preview through GitHub Pages after backend tests and frontend typechecking pass. The static preview still needs a configured API endpoint to run live searches.

The Render blueprint in \`fieldwork-search/render.yaml\` deploys the FastAPI backend. Configure the environment variables in the Render service. For durable hosted conversation history, use PostgreSQL rather than an ephemeral local SQLite file. Add the GitHub Pages origin to \`CORS_ORIGINS\` if using a separate API host.

## Known next steps

1. Move saved searches and configuration presets from browser storage into the backend Library API.
2. Add provider-aware dork compatibility and explicit Shodan search profiles.
3. Add page fetching/full-text extraction so synthesis can use page content beyond search snippets.
4. Add more research adapters and primary-source catalogs.
5. Add share-link revocation and stronger per-user identity if the app becomes multi-user.
6. Add integration tests for the full query-plan → search → synthesis → follow-up flow.
