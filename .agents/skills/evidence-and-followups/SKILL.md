---
name: evidence-and-followups
description: Use when implementing source fetching, citation handling, answer synthesis, evidence inspection, or data-grounded follow-up suggestions.
---

# Evidence synthesis and follow-up questions

## Evidence contract
The model must distinguish:
- Retrieved source material: provider result or fetched page content.
- Evidence-backed statements: synthesis supported by one or more source IDs.
- Unverified interpretation: model reasoning that is not directly established by sources.
- Follow-up proposal: a suggested next question or search, not a factual finding.

Every source must have a stable internal ID and retain URL, title, provider, query, retrieval time, rank, snippet, and fetched-content status.

## Citations
- Cite claims inline using stable source IDs that resolve to visible source cards.
- Never fabricate citations or cite a source that was not part of the current search context.
- Preserve source provenance when deduplicating.
- Clearly mark unavailable, blocked, truncated, or stale source content.
- When sources disagree, state the disagreement and show the relevant sources rather than forcing false consensus.

## Synthesis
- Ground the answer in retrieved content.
- Prefer direct page content over snippets when fetching is enabled and successful.
- State search coverage: engines used, queries run, and material limitations.
- Keep the answer useful even when only partial results are available.
- Do not claim exhaustive coverage unless the system can demonstrate it.

## Follow-up generation
Generate a short set of follow-up questions from the actual result set. Useful categories include:
- Narrow a date range, place, organization, person, or technical topic.
- Verify a key claim against an independent source.
- Explore a contradiction or missing perspective.
- Find primary documents, datasets, filings, or archived material.
- Expand a promising result into a deeper search.
Each suggestion should carry a structured intent and optional prefilled query plan. Clicking it should create a new linked search run, preserving the parent run and its configuration unless the user changes settings.

## Acceptance tests
- Every factual citation resolves to a source in the run.
- Follow-up suggestions reference actual entities, claims, gaps, or sources from retrieved data.
- Suggestions are not presented as retrieved facts.
- Source disagreement and partial retrieval are handled explicitly.
