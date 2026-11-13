# FIELDWORK — Search & Chat

FIELDWORK is a source-first research chat application. It sends retrieval requests to independent providers, merges and deduplicates returned pages, then gives the model excerpts with source identifiers so answers can cite them.

This project lives in its own directory and branch inside the Tinkering repository. It does not modify the root Flask Hello World app or any other project.

## Current build

- Featherless chat with server-side API-key handling and streamed tokens.
- Live model discovery from Featherless GET /v1/models.
- Preferred model IDs: darkc0de/XORTRON-RICO-v3 and darkc0de/XORTRON-AgentRICO. These are experimental catalog entries; the app verifies availability against the connected account.
- Parallel Exa semantic search and SearXNG metasearch.
- Provider-specific normalization, URL deduplication, and weighted reciprocal-rank fusion.
- Standard and Deep retrieval modes.
- Search excerpts are marked as untrusted reference material. Source cards and numbered citations remain visible.
- Persistent conversations, rename, archive/restore, delete, and Markdown export.
- Responsive desktop/mobile layout and installable PWA shell.
- SQLite locally; PostgreSQL/Supabase-compatible DATABASE_URL for hosted persistence.
- Optional single-password access gate for private deployments.

## Run locally

Requires Python 3.11 or newer.

1. Open a terminal in this directory.
2. Create and activate a virtual environment.
   - Windows: python -m venv .venv
   - Windows activation: .venv\Scripts\activate
   - Linux/macOS activation: source .venv/bin/activate
3. Install packages: pip install -r requirements.txt
4. Copy .env.example to .env and add your credentials.
5. Start: uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
6. Open http://localhost:8000

No npm build, Docker, or Linux subsystem is required for the first version.

## Server environment

- FEATHERLESS_API_KEY is required for model responses.
- EXA_API_KEY enables Exa semantic search.
- SEARXNG_URL enables a SearXNG instance with JSON output enabled.
- APP_PASSWORD should be set to a long random value before public deployment.
- DATABASE_URL can remain SQLite locally. For cloud use a PostgreSQL/Supabase connection string.

Never paste API keys into the chat UI or commit them to Git. The app does not send secret values to the browser.

## Model behavior

The model picker is backed by Featherless live model discovery. The current default is darkc0de/XORTRON-RICO-v3; the optional agent-variant ID is darkc0de/XORTRON-AgentRICO. The public catalog can list experimental models that are unavailable to a particular account or plan. The connected account's /v1/models response is the check; inference errors are surfaced instead of silently switching models.

AgentRICO is currently exposed as a model choice. This first release does not assume native tool calling works for that model and does not execute model-generated code. Search orchestration is controlled by the backend.

## Search behavior

Exa uses POST https://api.exa.ai/search with semantic retrieval and highlights. Standard mode uses automatic retrieval; Deep mode uses Exa deep retrieval and requests more results.

SearXNG uses the configured instance's /search API with format=json. JSON output and categories depend on that instance's settings. FIELDWORK does not hard-code a random public instance; configure one you trust.

SearXNG is a metasearch layer, not a guarantee of dark-web access. It queries only engines enabled by the instance operator. Tor/.onion retrieval is a separate connector and is not configured in this release.

## Cloud deployment

A Render blueprint is included. Set the environment variables in the Render service. For durable conversations, point DATABASE_URL to PostgreSQL (Supabase is compatible using its Postgres connection string). Render's local filesystem is not durable storage. Free web services may sleep, and model/search API usage may incur provider costs.

For private deployment, set APP_PASSWORD. The browser stores it in the current tab's session storage and sends it in a custom request header over HTTPS. This is a single-user access gate, not multi-user identity management.

## Next milestones

1. Verify RICO v3 and AgentRICO on the connected Featherless plan; measure latency and test native function calling separately.
2. Add Exa page contents/crawl and source-inspection view.
3. Add Brave, Tavily, academic sources (OpenAlex/Crossref/arXiv), GitHub, Reddit, and Internet Archive adapters.
4. Add multi-hop research workflows, query decomposition, a critic/verification pass, and human approval.
5. Add file uploads and project-based archives.
6. Add semantic retrieval over prior chats, notes, and sources.
7. Add MCP integrations behind per-tool permission controls.

## API documentation

Featherless completions: https://featherless.ai/docs/completions
Featherless models: https://featherless.ai/docs/api-reference-models
Exa search: https://exa.ai/docs/reference/search
SearXNG search API: https://docs.searxng.org/dev/search_api
