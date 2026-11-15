---
name: search-chat-ui
description: Use when implementing the primary chat interface, selectors, result rendering, source cards, follow-up chips, saved-search controls, or Library navigation.
---

# Search-chat interface

## Primary layout
The default screen is a focused search chat:
- Conversation/search history in a compact left rail.
- Main conversation stream in the center.
- Composer anchored at the bottom.
- A compact configuration row attached to the composer with dropdowns for LLM, search engines, and dork recipes.
- A Library entry in primary navigation.
- Optional settings for advanced retrieval behavior without crowding the default view.

## Composer controls
- LLM dropdown: searchable Featherless model list; selected model is visible.
- Search-engine dropdown: multi-select of configured providers, with saved combinations.
- Dork dropdown: select one recipe or a saved combination; provide a builder/edit action.
- Preset dropdown: load a saved complete configuration.
- Search button/Enter submits; Shift+Enter inserts a newline.

## Conversation rendering
Render the interaction as a sequence of typed blocks:
- User query.
- Search plan/status with providers and query variants.
- Search result groups or ranked result cards.
- Synthesized answer with inline citations.
- Follow-up question suggestions.
- Error/partial-success notices.
The user should be able to expand a result, inspect source metadata, open the original URL, or switch to BY ENGINE inspection without losing the ANSWER view.

## Navigation and views
Preserve a clear three-way distinction:
- ANSWER: synthesized response and follow-up questions.
- BY ENGINE: results grouped by provider, with query and rank details.
- SAVED: saved searches and saved items; Library provides broader organization.
Do not make the default experience look like a dashboard of unrelated widgets.

## Interaction requirements
- Users can rerun, save, share, rename, archive, and delete from the relevant conversation/search context.
- Follow-up suggestions submit a linked search with inherited configuration.
- Configuration changes are explicit and visible.
- Loading, empty, provider-error, and partial-result states are designed, not left blank.
- Responsive layout works on narrow screens without hiding critical controls.

## Acceptance tests
- Keyboard submission and multiline input work.
- All selectors update the actual backend request.
- Results render with citations and provider provenance.
- Follow-up chips trigger the expected linked search.
- Save/share/rerun/delete actions are wired to persistence, not decorative.
