---
name: provider-routing
description: Use when implementing Featherless.ai model discovery, model selection, LLM requests, provider adapters, streaming, fallback behavior, or credentials.
---

# LLM provider routing

## Primary provider
Featherless.ai is the primary LLM provider. The user must be able to choose the exact available model from a live or refreshable model catalogue. Do not hardcode one model as the only option.

## Responsibilities
- Implement a provider-neutral interface for model listing, chat completion, and streaming.
- Implement Featherless as a first-class adapter using its documented API contract.
- Preserve optional provider adapters already present (including Mistral) without making them mandatory for the core search flow.
- Store provider name, model ID, display name, capabilities, and configuration separately.
- Allow a saved preset to reference a model/provider pair; validate that it still exists before execution.
- Surface model/provider errors clearly and preserve the user's prompt and search configuration for retry.

## Security
- All API keys remain in backend environment variables or a managed secret store.
- Never send provider keys to the browser, local storage, URL parameters, client logs, or generated share links.
- Provide an `.env.example` containing variable names and safe placeholders only.
- Redact authorization headers and secrets from logs and exceptions.
- Do not ask the user to paste secrets into chat.

## Search-planner behavior
The selected model acts as planner and synthesizer:
- Interpret the question and identify entities, date ranges, constraints, and likely source types.
- Propose a bounded set of search queries and selected dork recipes.
- Invoke only engines enabled in the current configuration.
- Use structured tool/function calls where supported; otherwise use a validated JSON planning contract.
- Never assume every Featherless model supports native tool calling. Detect capability or use the backend-controlled planning fallback.
- Keep planning separate from execution so the user can inspect what will be searched.

## Streaming
Stream assistant status and answer tokens where supported. Search execution should emit explicit stages (planning, searching, ranking, synthesizing, complete/partial failure). Do not stream fabricated result content before retrieval has completed.

## Acceptance tests
- Model catalogue loads and handles provider errors.
- User can select and persist a model.
- Requests route to the selected model.
- Streaming and non-streaming paths are tested.
- Missing/invalid credentials fail safely.
- No secret appears in frontend bundles, API responses, logs, or test snapshots.
