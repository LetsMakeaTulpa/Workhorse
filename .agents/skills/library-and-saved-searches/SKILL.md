---
name: library-and-saved-searches
description: Use when implementing search history, saving/rerunning/sharing/deleting searches, collections, source library, or reusable model/search/dork presets.
---

# Library, history, and reusable configurations

## Core entities
Keep these concepts distinct in the data model:
- Conversation: ordered user/assistant messages and UI state.
- Search run: immutable record of a query execution, selected model, engine set, dork set, plan, results, and timestamps.
- Source: normalized evidence item with stable ID and provenance.
- Saved search: user-curated search run or repeatable query definition.
- Preset: named combination of model + search engines + dork recipes + mode/settings.
- Collection: user-organized group of searches and sources.
- Share record: controlled view of a conversation or search run.

## Required actions
- Save and unsave a search.
- Rerun a search, creating a new run linked to the original rather than overwriting history.
- Rename and archive conversations/searches.
- Delete with clear confirmation and consistent cascading/retention behavior.
- Share a read-only view with a revocable token or equivalent access control.
- Save, edit, duplicate, and delete model/search/dork presets.
- Add sources and searches to Library collections.
- Export a search with its answer, queries, engine coverage, and source citations.

## Data integrity
- A rerun is a new immutable run; preserve prior results.
- A preset stores IDs and versioned configuration, not secrets.
- If a provider or model is removed, show the preset as unavailable and allow repair.
- Sharing must never expose API keys, private environment values, or unrelated conversations.
- Deletion semantics must be documented and tested.
- Support relational persistence (SQLite for local/small deployments; PostgreSQL for hosted deployment) through a consistent data-access layer.

## Acceptance tests
- Save/rerun/archive/delete behavior persists across sessions.
- Reruns link to their parent run and preserve the original.
- Shared links expose only intended content and can be revoked.
- Presets restore the exact model, engine, and dork configuration.
- Library search/filtering finds saved runs, sources, collections, and presets.
