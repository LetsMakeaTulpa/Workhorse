---
name: product-contract
description: Use when defining scope, prioritizing features, reviewing UX, or deciding whether a proposed change belongs in Workhorse. Keeps the product focused on an LLM-fronted search engine.
---

# Workhorse product contract

## Product identity
Workhorse is a search engine with an LLM face. The chat interface is the primary interaction surface; the model is the conversational search planner and evidence synthesizer. It is not primarily a generic chatbot, autonomous desktop agent, or broad AI operating system.

## Primary user loop
1. User enters a natural-language research question.
2. User selects a Featherless model, search-engine configuration, and optional dork configuration.
3. The model interprets intent and creates a visible search plan.
4. The backend runs searches against selected providers and dork recipes.
5. Results appear in the chat stream, with source cards, citations, and optional engine-by-engine inspection.
6. The model synthesizes findings and offers follow-up questions that are grounded in retrieved data.
7. User follows a suggestion, edits/reruns the search, or saves/shares/deletes it.

## Core capabilities
- Featherless model selection, discovery, and per-search model choice.
- Search-engine multi-select and saved engine combinations.
- Dork builder, dork presets, and saved dork combinations.
- LLM-led query interpretation, expansion, and search planning.
- Search result display in the chat conversation.
- Evidence-grounded synthesis with source-level citations.
- Follow-up question suggestions generated from actual search results.
- Save, share, rerun, rename, archive, and delete searches/conversations.
- Built-in Library for saved searches, sources, collections, and presets.
- Saved configurations combining model + engines + dorks.
- Search modes/presets, including standard/deep and preserved specialist profiles such as Shodan where supported.

## Product boundaries
- Do not make Council mode, autonomous background agents, maps, game mechanics, or general productivity workspaces part of the core product.
- Advanced tools may exist behind explicit controls, but must not clutter the default search flow.
- Do not silently substitute an unselected model or provider. Show the effective configuration.
- Do not present generated suggestions as findings. Distinguish retrieved evidence, model synthesis, and proposed next searches.

## UX acceptance criteria
- A new user can submit a query without configuring every advanced option.
- The active model, engines, and dork preset are visible and editable at the chat composer.
- Search results and citations are readable inline in the conversation.
- Follow-ups are actionable and can be run with one click.
- Saved searches and presets can be found again in the Library.
- Destructive actions require a clear confirmation or reversible archive path.
