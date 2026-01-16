# RUM Agent Identity

## Philosophy

Each agent is an **individual** with its own memories, experience, and perspective — like humans on a team.

- Agents don't share a hive mind
- Each agent builds its own understanding
- Agents can access each other's memories (read and write)
- Identity persists across sessions

## Identity Model

```typescript
interface AgentIdentity {
  id: string;                    // Unique ID: "agent_{uuid}"
  type: "main" | "subagent";
  
  // Hierarchy
  parent_id: string | null;      // For subagents: who spawned them
  children: string[];            // Agents this one spawned
  
  // Context
  project_id: string;            // Agents are project-scoped
  
  // Lifecycle
  created_at: number;
  last_active_at: number;
  session_count: number;
  
  // Stats
  memory_count: number;
  success_rate: number;          // % of successful outcomes
  
  // Optional metadata
  specialization?: string;       // "frontend", "backend", "testing", etc.
  capabilities?: string[];       // What this agent is good at
}
```

## Identity Lifecycle

### 1. Registration

When an agent first starts in a project:

```
Agent spawns
    ↓
identity({ action: "register", type: "main" })
    ↓
RUM creates identity record
    ↓
Returns agent_id
    ↓
All subsequent store calls use this agent_id
```

For subagents:
```
Main agent spawns subagent for task
    ↓
Subagent: identity({ 
  action: "register", 
  type: "subagent", 
  parent_id: "agent_main_xxx" 
})
    ↓
RUM creates identity with parent link
    ↓
Subagent works, stores memories
    ↓
Main agent can query subagent's memories
```

### 2. Session Continuity

Identity persists across sessions:

```
Session 1:
  Agent registers → agent_id = "agent_abc123"
  Agent works, stores memories
  Session ends

Session 2 (next day):
  Agent: identity({ action: "resume", agent_id: "agent_abc123" })
  RUM: Validates identity, updates last_active_at
  Agent continues with same identity
  Previous memories accessible
```

### 3. Identity Discovery

Agent can check its own identity:

```
identity({ action: "info" })

Response:
{
  "agent_id": "agent_abc123",
  "type": "main",
  "project_id": "project_xyz",
  "created_at": 1705363200,
  "memory_count": 47,
  "success_rate": 0.89,
  "children": ["agent_sub001", "agent_sub002"]
}
```

## Agent Relationships

```
                    ┌─────────────┐
                    │ Main Agent  │
                    │ agent_main  │
                    └──────┬──────┘
                           │ spawns
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │ SubAgent A  │ │ SubAgent B  │ │ SubAgent C  │
    │ agent_sub01 │ │ agent_sub02 │ │ agent_sub03 │
    │ (frontend)  │ │ (backend)   │ │ (testing)   │
    └─────────────┘ └─────────────┘ └─────────────┘
```

### Access Rules

| Action | Own Memories | Parent's Memories | Sibling's Memories | Child's Memories |
|--------|--------------|-------------------|--------------------|--------------------|
| Read | ✅ | ✅ | ✅ | ✅ |
| Write | ✅ | ❌ | ❌ | ❌ |
| Link | ✅ (own) | ✅ (link to) | ✅ (link to) | ✅ (link to) |

**Key rule:** Agents can only **write** to their own memories, but can **read** and **link to** any agent's memories in the same project.

## Cross-Agent Queries

### Querying Another Agent's Memories

```typescript
// SubAgent A wants to know what SubAgent B did
recall({
  agent_id: "agent_sub02",        // Query B's memories
  file: "src/api/auth.ts",
  depth: "reasoning"
})
```

### Querying All Project Memories

```typescript
// Find all work on auth.ts regardless of agent
recall({
  file: "src/api/auth.ts",
  // No agent_id filter = all agents
  depth: "outcome",
  limit: 10
})
```

### Finding Related Agents

```typescript
// Who else worked on this file?
recall({
  file: "src/api/auth.ts",
  depth: "summary"
})

// Response includes agent_id for each memory
// Agent can then query specific agents for more detail
```

## Agent Specialization (Optional)

Agents can declare specialization for smarter routing:

```typescript
identity({
  action: "register",
  type: "subagent",
  parent_id: "agent_main",
  metadata: {
    specialization: "testing",
    capabilities: ["unit_tests", "integration_tests", "e2e"]
  }
})
```

This enables:
- Main agent can route tasks to appropriate subagent
- Triggers can prioritize memories from specialized agents
- Future: automatic subagent selection based on task type

## Identity Persistence Storage

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('main', 'subagent')),
  parent_id TEXT REFERENCES agents(id),
  project_id TEXT NOT NULL,
  
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  session_count INTEGER DEFAULT 1,
  
  memory_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  
  specialization TEXT,
  capabilities JSON,
  metadata JSON,
  
  UNIQUE(project_id, id)
);

CREATE INDEX idx_agents_project ON agents(project_id);
CREATE INDEX idx_agents_parent ON agents(parent_id);
CREATE INDEX idx_agents_type ON agents(type);
```

## Session Management

### Session Tracking

Each interaction period is a session:

```typescript
interface Session {
  id: string;                    // "session_{uuid}"
  agent_id: string;
  started_at: number;
  ended_at: number | null;       // Null if active
  
  // Session stats
  memories_created: number;
  queries_made: number;
  
  // Context
  initial_intent?: string;       // What the session was for
  final_outcome?: string;        // How it ended
}
```

### Session Lifecycle

```
Agent resumes identity
    ↓
New session created automatically
    ↓
Agent works (memories tagged with session_id)
    ↓
Session ends (explicit or timeout)
    ↓
Session record finalized
```

## Orphaned Agents

When a main agent disappears without cleanup:

```
Subagent's parent no longer active
    ↓
Subagent becomes "orphaned"
    ↓
Can still be resumed independently
    ↓
Memories preserved
```

Orphaned agents are not deleted — their memories may be valuable.

## Identity in Triggers

Triggers can use identity for smarter notifications:

```
Agent A works on auth.ts
    ↓
RUM: "Agent B (testing specialist) worked on this"
    ↓
Higher relevance than generic "another agent worked on this"
```

## Future Considerations

### Agent Reputation

Track agent reliability over time:
- Success rate
- Accuracy of predictions
- Quality of reasoning

### Agent Evolution

Allow agents to "learn" preferences:
- Preferred approaches for certain task types
- Known pitfalls to avoid
- Coding style preferences

### Team Formation

Multiple specialized agents working together:
- Main agent orchestrates
- Subagents handle specialized tasks
- Shared project memory with individual perspectives

### Identity Merging

If two agents did very similar work:
- Detect overlap
- Offer to merge memories
- Preserve both perspectives
