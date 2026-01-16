# RUM Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         AI Agent Runtime                         │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐    │
│  │   Main    │  │ SubAgent  │  │ SubAgent  │  │ SubAgent  │    │
│  │   Agent   │  │    001    │  │    002    │  │    003    │    │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘    │
│        │              │              │              │           │
└────────┼──────────────┼──────────────┼──────────────┼───────────┘
         │              │              │              │
         └──────────────┴──────────────┴──────────────┘
                                │
                    MCP Protocol (stdio/SSE)
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                         RUM Server                               │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Trigger Engine                        │   │
│  │  • File touch detector                                   │   │
│  │  • Intent matcher                                        │   │
│  │  • Conflict detector                                     │   │
│  │  • Pattern recognizer                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Retrieval Engine                       │   │
│  │  • Structural queries (SQL)                              │   │
│  │  • Temporal queries (time-based index)                   │   │
│  │  • Causal queries (graph traversal)                      │   │
│  │  • Semantic queries (embeddings — last resort)           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Storage Layer                         │   │
│  │                                                          │   │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │   │
│  │   │   SQLite    │  │   Vector    │  │    Graph    │    │   │
│  │   │  (struct)   │  │   Index     │  │   Index     │    │   │
│  │   └─────────────┘  └─────────────┘  └─────────────┘    │   │
│  │                          │                               │   │
│  │                          ▼                               │   │
│  │              project_name.rum.db                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. MCP Interface Layer

RUM exposes itself as an MCP server with these tools:

| Tool | Purpose |
|------|---------|
| `store` | Store a new memory |
| `update_memory` | Update an existing memory (PATCH-style) |
| `recall` | Retrieve memories (explicit query) |
| `list` | List agent's own memories |
| `link` | Create relationship between memories |
| `identity` | Register/resume agent identity |
| `create_chapter` | Create chapter manually or auto-detect |
| `list_chapters` | Query chapters with filters |
| `synthesize` | Create wisdom from chapters |
| `recall_wisdom` | Retrieve wisdom entries |

And these notifications (server → agent):

| Notification | Purpose |
|--------------|---------|
| `rum://memory_available` | Triggered memory offer |
| `rum://conflict_warning` | About to repeat a past failure |

### 2. Trigger Engine

Watches agent actions and proactively offers relevant memories.

```
Agent Action          Trigger Type         Response
─────────────────────────────────────────────────────
Opens file X    →    file_touch      →    "N agents touched X"
States intent Y →    intent_match    →    "Similar task attempted"
About to do Z   →    conflict_check  →    "⚠️ Z failed before"
Starts task     →    pattern_match   →    "Related task memory"
```

**Trigger flow:**

```
1. Agent performs action (file open, task start, etc.)
2. RUM intercepts via MCP resource subscription
3. Trigger engine checks rules against memory index
4. If match found:
   a. Compose minimal summary (~50 tokens)
   b. Send notification to agent
   c. Agent can ignore or request details
```

### 3. Retrieval Engine

Multi-strategy retrieval prioritized by precision:

```
Query: "What happened with auth.ts?"

Strategy 1: Structural (SQL)
  → SELECT * FROM memories WHERE files_touched LIKE '%auth.ts%'
  → EXACT matches, fast, preferred

Strategy 2: Temporal  
  → Filter by time range if specified
  → "What did we do yesterday?"

Strategy 3: Causal (Graph)
  → MATCH (m:Memory)-[:CAUSED]->(n:Memory) WHERE n.id = X
  → "What led to this decision?"

Strategy 4: Semantic (Embeddings)
  → Vector similarity search
  → LAST RESORT when others return nothing
  → Lower confidence, flag as "fuzzy match"
```

### 4. Storage Layer

Single-file database per project: `{project_name}.rum.db`

**SQLite tables:**
- `agents` — identity registry
- `memories` — core memory storage (includes embedding blob)
- `memory_files` — file associations
- `memory_links` — relationships between memories
- `chapters` — narrative groupings of memories
- `chapter_memories` — chapter-memory associations
- `wisdom` — synthesized project-level knowledge
- `wisdom_chapters` — wisdom-chapter associations

**Embedding storage:**
- Embeddings stored as BLOB (Float32Array buffer)
- Supports multiple providers: Ollama (local), OpenAI (cloud)
- Default: bge-m3 via Ollama (1024 dimensions, 72% retrieval accuracy)
- Cosine similarity for semantic search

**Graph relationships:**
- Stored as edges in `memory_links`
- Supports causal chains via traversal

### 5. Agent Identity Manager

Each agent gets a persistent identity:

```
Agent Identity {
  id: "agent_uuid",
  type: "main" | "subagent",
  created_at: timestamp,
  parent_id: nullable (for subagents),
  project_id: "project_uuid",
  session_history: [session_ids]
}
```

**Identity lifecycle:**

```
New agent spawns
      ↓
identity({ action: "register", type: "subagent", parent: "main_agent_id" })
      ↓
RUM creates identity, returns agent_id
      ↓
All store calls tagged with agent_id
      ↓
Agent completes task
      ↓
Identity persists for future recall
      ↓
Future: agent can "resume" identity for continuity
```

## Data Flow

### Storing a Memory

```
1. Agent completes meaningful work unit
2. Agent calls store({
     intent: "Fix JWT expiry bug",
     perception: "Found token refresh missing",
     reasoning: "Chose to add refresh interceptor because...",
     actions: [
       { file: "auth.ts", operation: "edit", lines: "45-67" },
       { command: "npm test", result: "pass" }
     ],
     outcome: { success: true, learning: "Need retry on 401" },
     links: { caused_by: "mem_previous_id" }
   })
3. RUM validates and stores in SQLite
4. Updates indexes (file index, vector embeddings, graph edges)
5. Returns memory_id for future reference
```

### Retrieving a Memory

```
1. Trigger fires OR agent explicitly calls recall
2. recall({
     scope: "file",
     target: "auth.ts",
     depth: "reasoning",
     include_failures: true,
     limit: 3
   })
3. Retrieval engine executes strategy cascade
4. Returns memories with confidence scores
5. Agent integrates relevant context
```

## File Structure

```
~/.rum/
├── config.json              # Global RUM configuration
├── projects/
│   ├── project_abc/
│   │   ├── project_abc.rum.db   # All memories for this project
│   │   └── embeddings.bin       # Vector index cache
│   └── project_xyz/
│       ├── project_xyz.rum.db
│       └── embeddings.bin
└── logs/
    └── rum.log
```

## Performance Considerations

| Operation | Target Latency | Strategy |
|-----------|---------------|----------|
| Trigger check | <10ms | In-memory index of recent files/intents |
| Structural query | <50ms | SQLite with proper indexes |
| Causal traversal | <100ms | Limited depth (max 5 hops) |
| Semantic query | <200ms | Pre-computed embeddings, cached |

## Security Model

- **Project isolation** — memories never leak across projects
- **Agent isolation** — agents can only write to own memories
- **Read access** — agents can read other agents' memories (same project)
- **No external network** — all storage local, embeddings computed locally
- **Sensitive data** — diff content stored as hashes, full content optional
