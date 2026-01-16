# RUM — Retrieval Unlimited Memory

> A persistent memory system for AI agents that enables instant, precise retrieval without polluting context windows.

## The Problem

AI coding agents (Amp, Cursor, Claude Code, etc.) are limited by context windows (~128-200k tokens). Current solutions:

- **Compaction/summarization** — loses detail
- **Handoffs** — loses continuity  
- **RAG** — imprecise, chunks destroy context
- **Markdown files** — unstructured, no query capability

When sub-agents complete work, we only get summaries. The reasoning, failed attempts, and decision chains are lost forever.

## The Solution

RUM provides:

1. **Zero-load architecture** — agents start with empty context, retrieve only when needed
2. **Structured memory** — not text chunks, but atomic units with intent, reasoning, actions, outcomes
3. **Individual agent memory** — each agent has its own memory (like humans), with read access to others
4. **System-driven triggers** — RUM watches agent actions and offers relevant memories
5. **Multi-path retrieval** — temporal, structural, causal, and semantic queries

## Core Principles

| Principle | Description |
|-----------|-------------|
| **Never dump** | Zero memories loaded at start |
| **Offer, don't force** | System suggests, agent decides |
| **Precision over similarity** | Exact matches before fuzzy |
| **Preserve reasoning** | Store the "why", not just "what" |
| **Failed attempts matter** | What didn't work is as valuable as what did |

## Knowledge Hierarchy

RUM organizes knowledge in three progressive layers:

```
Individual Memories (atomic work units)
         ↓
    Chapters (narrative groupings)
         ↓
    Wisdom (project-level insights)
```

- **Memories** — Individual units of meaningful work with intent, reasoning, actions, and outcomes
- **Chapters** — Group related memories into narrative units with synthesized summaries and learnings
- **Wisdom** — Distill multiple chapters into consolidated project-level knowledge, patterns, and best practices

## Documentation

- [Architecture Overview](./architecture.md)
- [Memory Schema](./memory-schema.md) — Includes Chapter and Wisdom schemas
- [Trigger System](./triggers.md)
- [Retrieval API](./retrieval-api.md)
- [Agent Identity](./agent-identity.md)

## Quick Example

```
Agent starts working on auth.ts
         ↓
RUM detects file touch
         ↓
RUM checks memory index
         ↓
[RUM] Memory available:
  • Agent-002 modified auth.ts (2 days ago) — fixed JWT expiry
  • Agent-003 attempted refactor — failed (race condition)
  
  → recall("mem_abc123") for details
         ↓
Agent decides: needs the failure context
         ↓
recall("mem_agent003_auth", depth: "reasoning")
         ↓
Returns: full reasoning chain of what was tried and why it failed
         ↓
Agent avoids same mistake, succeeds
```

## Status

✅ **Implementation Phase** — Core features including Chapters and Wisdom synthesis available.
