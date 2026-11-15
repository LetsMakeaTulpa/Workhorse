# Workhorse / FIELDWORK

Unified research workstation workspace. This branch consolidates the Venice Lite React/TypeScript interface with the earlier FIELDWORK FastAPI research backend while preserving both implementations.

## Project layout

- `src/` — Venice Lite React/Vite interface: chat workspace, model picker, tool/agent loop, search modes, dork helpers, saved results, local conversation state, and provider controls.
- `fieldwork-search/backend/` — FIELDWORK FastAPI service: Featherless server-side inference, streamed chat, persistent conversations, Exa + SearXNG retrieval, URL normalization, weighted reciprocal-rank fusion, source metadata, and API endpoints.
- `fieldwork-search/backend/static/` — original FIELDWORK PWA interface retained intact as a reference/fallback; it is not the root UI.
- `fieldwork-search/backend/tests/` — backend smoke and research tests.
- `fieldwork-search/render.yaml` — original backend deployment blueprint.

## Branch consolidation

The source UI comes from `venice-lite-html-implementation-e1d04` in Workhorse. The backend and its assets/tests come from `LetsMakeaTulpa/Tinkering` branch `search-chat-mvp`. The branch `copilot/workhorse-app-copy` was checked and contained no changes beyond `main`, so there was no additional code to import from it.

No changes were made to `main` or to the source branches.

## Current integration boundary

This is a source consolidation, not yet a fully wired single runtime. The React interface currently calls Featherless and several search providers from its client-side tool layer; the FastAPI service separately owns server-side Featherless inference, Exa/SearXNG search, and persistent conversations. The next integration step is to route the React app through the FastAPI API, move provider credentials to server environment variables, and expand the backend provider adapters to include Brave, Tavily, and Serper. Do not enter production credentials into the browser UI.

## Run the React interface

Requires Node.js 20+.

```bash
npm install
npm run dev
```

## Run the FastAPI backend

Requires Python 3.11+.

```bash
cd fieldwork-search
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and set server-side credentials. Then:

```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

API health: `/api/health`. API routes and deployment notes are documented in `fieldwork-search/README.md`.

## Important credentials

Keep all API keys in backend environment secrets. Never commit `.env` or expose provider keys in browser storage. Existing Venice Lite client-side settings are retained for compatibility during migration; they should be disabled or removed once the React interface is connected to the backend proxy.

## Current providers

- React tool layer: Featherless, Exa, Tavily, Brave, SearXNG, DuckDuckGo/Jina, GitHub, Wikipedia.
- FastAPI backend: Featherless, Exa, SearXNG with weighted RRF.
- Serper is not yet implemented in either code path.

## Next integration milestones

1. Add authenticated backend endpoints for model discovery and chat/search configuration.
2. Connect the React UI to backend chat streaming, model discovery, conversation persistence, and search endpoints.
3. Add Brave, Tavily, and Serper adapters to the backend; retain Exa and SearXNG.
4. Reconcile provider selection and query planning so the LLM orchestrates the provider portfolio.
5. Run typecheck, frontend build, backend tests, and an end-to-end smoke test.
6. Deploy only after server-side credentials and persistent database settings are configured.
