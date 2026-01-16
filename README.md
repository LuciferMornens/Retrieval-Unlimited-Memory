# RUM - Retrieval Unlimited Memory

> **Persistent memory system for AI agents with instant, precise retrieval.**

RUM gives AI coding agents the ability to remember across sessions. No more starting from scratch—agents can learn from past work, avoid repeating mistakes, and build on previous knowledge.

## Why RUM?

AI agents forget everything between sessions. RUM fixes this:

- **Remember what worked** — Store successful approaches for reuse
- **Learn from failures** — Failed attempts are valuable; don't repeat them
- **Share knowledge** — Agents can read and write to each other's memories
- **Scale understanding** — Atomic memories synthesize into long-term wisdom

## Features

| Feature | Description |
|---------|-------------|
| **16 MCP Tools** | Full memory lifecycle: store, recall, update, delete, trace, link |
| **5-Layer Memories** | Intent → Perception → Reasoning → Actions → Outcome |
| **Depth Control** | Retrieve at 5 levels: summary (~20 tokens) to complete (~500+ tokens) |
| **Knowledge Hierarchy** | Memories → Chapters → Wisdom (progressive synthesis) |
| **Semantic Search** | BGE-M3 embeddings via Ollama or OpenAI |
| **Cross-Agent Access** | Agents maintain individual identity but can collaborate |
| **Auto-Resume** | `resume` without agent_id automatically finds your last session |
| **Zero-Load Architecture** | Start empty, retrieve only when needed |

## Quick Start

### 1. Install

```bash
git clone https://github.com/LuciferMornens/Retrieval-Unlimited-Memory.git
cd Retrieval-Unlimited-Memory
npm install
npm run build
```

### 2. Configure Your AI Client

Add RUM to your MCP configuration:

<details>
<summary><b>Claude Code / Amp Code</b></summary>

Add to `~/.claude.json` (Claude Code) or your Amp MCP config:

```json
{
  "mcpServers": {
    "rum": {
      "command": "node",
      "args": ["/absolute/path/to/rum/dist/index.js", "your-project-name"],
      "env": {
        "RUM_EMBEDDING_PROVIDER": "ollama",
        "RUM_EMBEDDING_MODEL": "bge-m3",
        "RUM_EMBEDDING_URL": "http://localhost:11434"
      }
    }
  }
}
```

Or using OpenAI embeddings:

```json
{
  "mcpServers": {
    "rum": {
      "command": "node",
      "args": ["/absolute/path/to/rum/dist/index.js", "your-project-name"],
      "env": {
        "RUM_EMBEDDING_PROVIDER": "openai",
        "OPENAI_API_KEY": "sk-your-key-here"
      }
    }
  }
}
```

</details>

<details>
<summary><b>OpenAI Codex CLI</b></summary>

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.rum]
command = "node"
args = ["/absolute/path/to/rum/dist/index.js", "your-project-name"]

[mcp_servers.rum.env]
RUM_EMBEDDING_PROVIDER = "ollama"
RUM_EMBEDDING_MODEL = "bge-m3"
RUM_EMBEDDING_URL = "http://localhost:11434"
```

Or with OpenAI embeddings:

```toml
[mcp_servers.rum]
command = "node"
args = ["/absolute/path/to/rum/dist/index.js", "your-project-name"]

[mcp_servers.rum.env]
RUM_EMBEDDING_PROVIDER = "openai"
OPENAI_API_KEY = "sk-your-key-here"
```

</details>

<details>
<summary><b>Claude Desktop</b></summary>

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "rum": {
      "command": "node",
      "args": ["/absolute/path/to/rum/dist/index.js", "your-project-name"],
      "env": {
        "RUM_EMBEDDING_PROVIDER": "ollama",
        "RUM_EMBEDDING_MODEL": "bge-m3",
        "RUM_EMBEDDING_URL": "http://localhost:11434"
      }
    }
  }
}
```

</details>

### 3. (Optional) Set Up Semantic Search

For semantic search, run Ollama with BGE-M3:

```bash
# Install Ollama: https://ollama.ai
ollama pull bge-m3
ollama serve
```

Or use OpenAI by setting `RUM_EMBEDDING_PROVIDER=openai` and providing `OPENAI_API_KEY`.

> RUM works without embeddings—you just won't have semantic search.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `identity` | Register/resume agent identity (auto-resumes last agent if no ID) |
| `store` | Store a memory with 5-layer structure |
| `recall` | Retrieve memories (all project memories, filterable) |
| `list` | List only YOUR agent's memories |
| `update_memory` | Patch an existing memory |
| `check_file` | Check for memories about a file before editing |
| `trace` | Trace causal chains between memories |
| `link` | Create relationships between memories |
| `create_chapter` | Group related memories into chapters |
| `list_chapters` | Query chapters |
| `synthesize` | Create wisdom from chapters |
| `recall_wisdom` | Retrieve synthesized wisdom |
| `delete_memory` | Delete a memory |
| `delete_chapter` | Delete a chapter |
| `delete_wisdom` | Delete wisdom |
| `reset_all` | Reset entire database (requires confirmation) |

## How Agents Use RUM

### Session Workflow

1. **Start**: Always try `{action: "resume"}` first—it auto-resumes your last agent
2. **Recall**: Check what's already known before starting work
3. **Check**: Before editing files, check for relevant memories
4. **Work**: Do the task
5. **Store**: After meaningful work, store what you learned (include failures!)

### Quick Reference

```javascript
// Start session (auto-resume)
identity({ action: "resume" })

// First time only
identity({ action: "register", type: "main" })

// Check what's been done
recall({ depth: "summary", limit: 10 })

// Before editing a file
check_file({ file_path: "src/index.ts" })

// Store after completing work
store({
  intent: { goal: "Fix auth bug", task_type: "bug_fix" },
  outcome: { success: true, summary: "Fixed token validation" },
  importance: 0.7
})
```

### Depth Levels

| Level | Tokens | Use When |
|-------|--------|----------|
| `summary` | ~20 | Quick scan |
| `outcome` | ~50 | Need to know what happened |
| `reasoning` | ~150 | Need to understand decisions |
| `full` | ~300 | Need most context |
| `complete` | ~500+ | Need everything |

## Storage

Data is stored per-project in:

```
~/.rum/projects/{project-id}/{project-id}.rum.db
```

Each project has isolated memory.

## Development

```bash
npm run dev       # Watch mode
npm run build     # Build
npm run typecheck # Type check
npm test          # Run tests (289 passing)
```

## Architecture

```
src/
├── index.ts                 # MCP server entry point
├── types.ts                 # TypeScript types & Zod schemas
├── storage/
│   └── database.ts          # SQLite storage layer
└── core/
    ├── memory-service.ts    # Store, recall, trace, list, link
    ├── identity-service.ts  # Agent registration & sessions
    ├── embedding-service.ts # BGE-M3/OpenAI embeddings
    ├── chapter-service.ts   # Chapter management
    ├── synthesis-service.ts # Wisdom generation
    └── trigger-service.ts   # Proactive notifications
```

## Documentation

See `docs/rum/` for detailed specs:

- [Architecture](docs/rum/architecture.md) — System components, data flow
- [Memory Schema](docs/rum/memory-schema.md) — 5-layer structure
- [Retrieval API](docs/rum/retrieval-api.md) — All MCP tools
- [Agent Identity](docs/rum/agent-identity.md) — Individual identity model
- [Triggers](docs/rum/triggers.md) — Proactive notifications

## License

MIT

---

**Built for AI agents that learn.**
