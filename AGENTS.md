# Workhorse agent instructions

Workhorse is a search engine with an LLM chat interface. It is not a generic chatbot or an all-purpose agent desktop.

## Product contract
- The main screen is a chat/search workspace.
- The user chooses a Featherless.ai model, one or more search engines, and optional dork recipes from visible selectors.
- The selected LLM interprets the query, plans searches, invokes the configured search adapters, synthesizes retrieved evidence, and proposes grounded follow-up questions.
- Search results, source citations, engine-level results, and follow-up suggestions appear in the conversation.
- Users can save, share, rerun, rename, archive, and delete searches/conversations.
- A built-in Library stores saved searches, sources, collections, and reusable configurations.
- Users can save reusable combinations of LLM + search engines + dork recipes as named presets.

## Scope
Use the existing Workhorse unified branch as the integration base. Reuse and reconcile the Venice Lite frontend, FIELDWORK search backend, Chatterless conversation lifecycle patterns, and the Mistral/Featherless provider work where present. Inspect code before assuming a feature exists. Preserve original source branches.

Do not merge Night Map, Day Map, mapping foundations, or Nexus Tartaria into this product.

## Architecture principles
- Keep provider credentials server-side. Never expose API keys in browser bundles, logs, client storage, or error messages.
- Treat the LLM as the search planner and synthesis layer; search engines remain independent retrieval providers.
- Keep search orchestration deterministic and inspectable. Record the plan, providers called, query variants, timestamps, result IDs, ranking, and citations.
- Normalize provider outputs into one source schema while retaining provider-specific metadata.
- Use reciprocal-rank fusion or another explicitly tested ranking strategy; never silently discard provenance.
- Separate conversations, search runs, source records, saved presets, and library collections in the data model.
- Make provider failures partial: one unavailable engine should not erase successful results from others.
- Do not claim a search occurred unless a provider call actually succeeded.
- Do not fabricate citations, result URLs, provider availability, model capabilities, or test results.

## Required workflow
1. Read the relevant skill in `.agents/skills/` before changing that area.
2. Inspect the current implementation and tests; map existing behavior before replacing anything.
3. Prefer incremental changes that preserve working functionality.
4. Add or update tests with every behavior change.
5. Run the relevant test suite and build; report exact commands and outcomes.
6. Update documentation and environment examples. Never commit real secrets.
7. Keep changes on the active feature branch and summarize changed files, tests, and known gaps.

## Definition of done
A feature is not complete merely because its UI exists. It must be wired end-to-end, persist correctly, handle errors, protect secrets, have tests, and be documented.
