# RUM - Retrieval Unlimited Memory

> Persistent memory system for AI agents with instant, precise retrieval.

## Build & Run

```bash
npm install
npm run build
npm start [project-id]
```

## Development

```bash
npm run dev  # Watch mode with tsx
```

## Typecheck

```bash
npm run typecheck
```

## Project Structure

```
src/
├── index.ts              # MCP server entry point
├── types.ts              # All TypeScript types & Zod schemas
├── storage/
│   └── database.ts       # SQLite storage layer
└── core/
    ├── memory-service.ts   # Store, recall, trace, list, link
    ├── identity-service.ts # Agent registration & sessions
    ├── trigger-service.ts  # Proactive memory notifications
    ├── chapter-service.ts  # Chapter management
    └── synthesis-service.ts # Wisdom generation
```

## Documentation

Full specs and architecture in `docs/rum/`:

- [README](docs/rum/README.md) - Overview and principles
- [Architecture](docs/rum/architecture.md) - System components, data flow
- [Memory Schema](docs/rum/memory-schema.md) - 5-layer memory structure
- [Triggers](docs/rum/triggers.md) - Proactive notification system
- [Retrieval API](docs/rum/retrieval-api.md) - MCP tools specification
- [Agent Identity](docs/rum/agent-identity.md) - Individual identity model

## MCP Tools

| Tool | Purpose |
|------|---------|
| `identity` | Register/resume agent identity |
| `store` | Store a memory with 5-layer structure |
| `update_memory` | Update an existing memory by ID (PATCH-style) |
| `recall` | Retrieve memories across the entire project (exact, structural, semantic) |
| `trace` | Trace causal chains between memories |
| `list` | List only the current agent's memories |
| `link` | Create memory relationships |
| `check_file` | Check for file-related memories (trigger) |
| `create_chapter` | Create chapter manually or auto-detect by tag clustering |
| `list_chapters` | Query chapters with filters (time range, tags) |
| `synthesize` | Create wisdom from chapters |
| `recall_wisdom` | Retrieve wisdom entries by ID or query |
| `delete_memory` | Delete a memory and related links/files/chapters |
| `delete_chapter` | Delete a chapter and related chapter/wisdom relationships |
| `delete_wisdom` | Delete a wisdom entry and its chapter references |
| `reset_all` | Delete all data in this project database. Requires confirmation: `confirmation="RESET_ALL"` |

## Storage

Data stored in `~/.rum/projects/{project_id}/{project_id}.rum.db`

## Key Concepts

- **Zero-load architecture**: Agents start with empty context, retrieve only when needed
- **5-layer memories**: Intent → Perception → Reasoning → Actions → Outcome
- **Individual identity**: Each agent has its own memory, can access others' memories
- **Depth control**: summary (~20 tokens) to complete (~500 tokens)
- **System-driven triggers**: RUM offers relevant memories, agent decides
- **Knowledge hierarchy**: Memories → Chapters → Wisdom (progressive synthesis)

## How to Use RUM (for AI Agents)

### Session Workflow

1. **Start**: Always try `{action: "resume"}` first - it auto-resumes your last agent. Only use `register` if resume fails (first-time setup).
2. **Recall**: Check what's already known before starting work
3. **Check**: Before editing files, check for relevant past memories
4. **Work**: Do the task
5. **Store**: After meaningful work, store what you learned (include failures!)
6. **Update**: Use `update_memory` to patch existing memories if needed

### Quick Reference

| When | Tool | Example |
|------|------|---------|
| Starting session | `identity` | `{action: "resume"}` (auto-resume last main agent), `{action: "resume", agent_id: "agent_xxx"}`, or `{action: "register", type: "main"}` |
| What's been done? | `recall` | `{depth: "summary", limit: 10}` |
| Before editing file | `check_file` | `{file_path: "src/index.ts"}` |
| Search by topic | `recall` | `{intent: "authentication", depth: "outcome"}` |
| After finishing work | `store` | Full 5-layer memory with intent, outcome, etc. |
| Fix/expand memory | `update_memory` | `{memory_id: "mem_xxx", outcome: {...}}` |

### Depth Levels (token budget control)

| Level | Tokens | Use When |
|-------|--------|----------|
| `summary` | ~20 | Quick scan of what exists |
| `outcome` | ~50 | Need to know what happened |
| `reasoning` | ~150 | Need to understand decisions |
| `full` | ~300 | Need most context |
| `complete` | ~500+ | Need everything including actions |

**Tip**: Start with `summary`, load more only if needed.

**Note**: `list` is scoped to your current agent, while `recall` queries all project memories unless you filter by `agent_id`.

### When to Store Memories

**DO store after**:
- Fixing bugs (especially failures - they're valuable!)
- Implementing features
- Making design decisions
- Learning something important about the codebase
- Failed attempts (prevents repeating mistakes)

**DON'T store for**:
- Trivial file reads
- Simple searches
- No meaningful work done

### Importance Scale

| Score | Meaning |
|-------|---------|
| 0.3-0.5 | Routine work |
| 0.6-0.8 | Significant changes |
| 0.9-1.0 | Critical decisions, architecture changes |

### Cross-Agent Collaboration

- Use `target_agent_id` in `store` to write memories for another agent
- Use `agent_id` filter in `recall` to read another agent's memories
- Each agent maintains individual identity but can collaborate
