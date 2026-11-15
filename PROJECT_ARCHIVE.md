# WORKHORSE — Project Archive
**Archive date:** 2026-11-14  
**Repository:** https://github.com/LetsMakeaTulpa/Workhorse  
**Working branch:** `fieldwork-unified`  
**Current branch commit:** `2bf9c8aac0155c487cea9a44e3eacd313f4ddf65`  
**Pull request:** https://github.com/LetsMakeaTulpa/Workhorse/pull/2

## 1. Project purpose

Workhorse is intended to be a search engine with an LLM interface — not merely a general chatbot with a search button. The LLM is the research operator: it interprets the user's request, selects and orchestrates search engines and search operators/dorks, synthesizes retrieved evidence, and proposes useful follow-up questions grounded in the collected results.

The intended default inference provider is Featherless.ai, with a user-selectable model. The user wants broad model choice and minimal unnecessary model/provider restrictions. API credentials must remain server-side and must never be committed to the repository or exposed in browser code.

## 2. Product requirements and intended capabilities

### Core research loop
1. User asks a question or enters a search task.
2. LLM interprets the task and decides which search engines, queries, operators, and dorks are appropriate.
3. Search providers run in parallel where appropriate.
4. Results are normalized, deduplicated, ranked, and presented with source links.
5. LLM synthesizes an answer grounded in retrieved results and distinguishes evidence from inference.
6. LLM proposes context-aware follow-up questions and secondary searches based on the actual result set.
7. User can refine, rerun, expand, or save the research session.

### Search and research controls
- Multiple selectable search engines and provider combinations.
- Search operators and advanced dorks, including reusable/savable dork presets.
- Named search configurations/presets.
- Search modes and alternative configurations previously referred to as **dark**, **deep**, and **Shodan**; preserve these as distinct configurations rather than silently collapsing them.
- Result views/tabs requested in earlier design work: **ANSWER**, **BY ENGINE**, and **SAVED**.
- Include Exa as a search provider.
- Keep the search engine layer extensible so additional providers can be added without rewriting orchestration.

### LLM and model controls
- Featherless.ai as the primary model gateway.
- User-selectable Featherless model.
- Save named model configurations.
- Keep model selection separate from search-provider selection so a user can save model/search combinations.
- Backend-only API key handling via environment variables.

### Persistence and library
- Save, share, rerun, and delete searches.
- Built-in library for saved searches, research sessions, dorks, model configurations, and search-engine combinations.
- Preserve source URLs and result metadata with saved sessions.
- Search history and library should be durable across sessions when deployed with persistent storage.

## 3. Current repository architecture

The current `fieldwork-unified` branch combines two previously separate codebases:

### Frontend — root
- React + TypeScript + Vite application.
- Main UI: `src/App.tsx`.
- State and provider definitions: `src/store.ts`.
- Tool/provider utilities: `src/tools.ts`.
- Entry point: `src/main.tsx`.
- Styling: `src/index.css`.
- Build configuration: `vite.config.js`.
- Package definitions: `package.json`, `package-lock.json`.

### Backend — `fieldwork-search/`
- FastAPI backend.
- Main API: `backend/main.py`.
- Configuration: `backend/config.py`.
- Persistence/database layer: `backend/database.py`.
- Data models and schemas: `backend/models.py`, `backend/schemas.py`.
- Prompt definitions: `backend/prompts.py`.
- Featherless provider adapter: `backend/providers/featherless.py`.
- Search provider and aggregation logic: `backend/providers/search.py`.
- Research service: `backend/services/research.py`.
- Static web client assets: `backend/static/`.
- Tests: `backend/tests/`.
- Environment template: `.env.example`.
- Python dependencies: `requirements.txt`.
- Render deployment definition: `render.yaml`.

### Existing backend capabilities recorded in the project
- Featherless inference integration.
- Exa and SearXNG search integrations.
- Weighted Reciprocal Rank Fusion (RRF) for result aggregation.
- Persistent conversation/session foundations.
- FastAPI service and test scaffolding.

### Existing frontend provider references
The current UI provider definitions include Exa, Tavily, DuckDuckGo, SearXNG, Brave, GitHub, and Wikipedia. These frontend references do not by themselves prove that every provider is connected to the backend or fully operational.

## 4. Integration status — important

**The repository is consolidated, but the product is not yet a fully integrated application.**

The React UI and FastAPI backend currently coexist in one repository. The frontend still contains its original client-side/direct-provider path; the backend has its own Featherless and search implementation. The following integration work remains:

1. Make the React UI call the FastAPI backend for model inference and research orchestration.
2. Move all provider credentials and authenticated calls to the backend.
3. Connect model discovery/selection to Featherless and persist model choices.
4. Connect search-provider selection and dork controls to backend adapters.
5. Normalize provider results and return citations/source metadata to the UI.
6. Connect answer synthesis and result-grounded follow-up questions to the same research session.
7. Implement complete save/share/rerun/delete behavior and a durable library.
8. Add/finish provider adapters (including Brave, Tavily, Serper, and any other selected providers); do not assume UI-only references are implemented.
9. Add integration tests for the complete user journey.
10. Verify deployment, persistent storage, and secrets configuration.

Do not describe the frontend and backend as already integrated until these items have been implemented and tested.

## 5. Preview and deployment state

A GitHub Actions workflow exists at `.github/workflows/preview.yml`. It is intended to build the Vite frontend and deploy it to GitHub Pages on pushes to `fieldwork-unified`.

The most recent recorded workflow run for commit `2bf9c8a` completed with **failure** (run #1, attempt 4). Therefore, the GitHub Pages preview URL is **not verified live**. Inspect the failed run and logs before claiming a working preview:
https://github.com/LetsMakeaTulpa/Workhorse/actions/runs/43353777244

The workflow currently builds the frontend only. GitHub Pages cannot host the FastAPI backend. A separate backend host and persistent database are required for a live full-stack product. Keep deployment choices compatible with the user's $0/no-credit-card preference where feasible; disclose limits and avoid paid trials or surprise costs.

## 6. Repository structure snapshot

```text
Workhorse/
├── .github/workflows/preview.yml
├── README.md
├── index.html
├── package.json
├── package-lock.json
├── src/
│   ├── App.tsx
│   ├── index.css
│   ├── main.tsx
│   ├── store.ts
│   └── tools.ts
├── tsconfig.json
├── vite.config.js
└── fieldwork-search/
    ├── .env.example
    ├── README.md
    ├── render.yaml
    ├── requirements.txt
    └── backend/
        ├── config.py
        ├── database.py
        ├── main.py
        ├── models.py
        ├── prompts.py
        ├── schemas.py
        ├── providers/
        │   ├── featherless.py
        │   └── search.py
        ├── services/
        │   └── research.py
        ├── static/
        └── tests/
```

## 7. Development principles and constraints

- Preserve existing code and functionality; integrate rather than casually replace.
- Keep the frontend visual and approachable; avoid requiring the user to work in a terminal where a browser-based workflow is possible.
- Prefer managed/cloud deployment, but do not assume free tiers are permanent or require no card.
- Never ask the user to paste API secrets into chat. Use environment variables/secrets in the backend host.
- Keep the system modular: model providers, search providers, dork templates, ranking, synthesis, persistence, and UI should be separable.
- Preserve named research modes and saved configurations.
- Show source provenance and avoid presenting unsupported LLM claims as search evidence.
- Treat the current branch as working/integration branch. PR #2 is the consolidation review path; do not assume it has been merged.

## 8. Immediate work queue

### P0 — get the existing branch healthy
- Inspect and fix the failed GitHub Actions preview workflow.
- Run the frontend production build.
- Run backend tests.
- Record exact build/test outcomes in the README or a status file.

### P1 — connect the product
- Establish the frontend-to-FastAPI API contract.
- Route chat/research requests through the backend.
- Verify Featherless model selection and inference.
- Verify Exa/SearXNG search and RRF output.
- Display source-linked results and answer synthesis in the UI.

### P2 — fulfill the product brief
- Search engine and dork builder.
- Saved model/search configurations.
- Library CRUD and shareable search records.
- Follow-up question generation grounded in retrieved data.
- ANSWER / BY ENGINE / SAVED views.
- Dark / Deep / Shodan configurations.
- Additional search provider adapters and integration tests.

### P3 — deploy full stack
- Frontend hosting.
- Backend hosting.
- Persistent database/storage.
- Server-side secrets.
- End-to-end smoke test from browser to model to search to saved library.

## 9. Important links

- Repository: https://github.com/LetsMakeaTulpa/Workhorse
- Working branch: https://github.com/LetsMakeaTulpa/Workhorse/tree/fieldwork-unified
- Consolidation PR #2: https://github.com/LetsMakeaTulpa/Workhorse/pull/2
- Actions: https://github.com/LetsMakeaTulpa/Workhorse/actions
- Failed preview run: https://github.com/LetsMakeaTulpa/Workhorse/actions/runs/43353777244
- Preview workflow source: https://github.com/LetsMakeaTulpa/Workhorse/blob/fieldwork-unified/.github/workflows/preview.yml
- Source ZIP for working branch: https://github.com/LetsMakeaTulpa/Workhorse/archive/refs/heads/fieldwork-unified.zip

## 10. Scope and completeness note

This archive captures the project brief, requirements, architecture, repository snapshot, known integration gaps, deployment state, and next work queue available on 2026-11-14. It is not a verbatim export of every ChatGPT message, every external account, or every historical file ever associated with the project. The Git repository and its Git history remain the authoritative source for committed code. Do not put API keys, passwords, tokens, private personal data, or unrelated project material in this archive.
