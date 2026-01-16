# RUM Memory Schema

## Core Philosophy

Memories are **atomic units of meaningful work**, not arbitrary text chunks.

Each memory captures a complete thought cycle:
- What was the agent trying to do? (Intent)
- What did it observe? (Perception)
- How did it decide what to do? (Reasoning)
- What did it actually do? (Actions)
- What happened? (Outcome)

## Memory Structure

### Primary Memory Object

```typescript
interface Memory {
  // Identity
  id: string;                    // Unique memory ID: "mem_{uuid}"
  agent_id: string;              // Which agent created this
  project_id: string;            // Which project this belongs to
  
  // Timestamps
  created_at: number;            // Unix timestamp
  session_id: string;            // Which session this was created in
  
  // The Five Layers
  intent: Intent;
  perception: Perception;
  reasoning: Reasoning;
  actions: Action[];
  outcome: Outcome;
  
  // Relationships
  links: MemoryLinks;
  
  // Metadata
  tags: string[];                // User/agent defined tags
  importance: number;            // 0-1, for retrieval ranking
  access_count: number;          // How often retrieved
  last_accessed: number | null;  // Last retrieval timestamp
}
```

## Chapters (Narrative Units)

Chapters group related memories into narrative units with synthesized summaries,
learnings, and time ranges.

```typescript
interface Chapter {
  id: string;                    // Unique chapter ID: "chapter_{uuid}"
  project_id: string;

  created_at: number;
  updated_at: number;

  title?: string;
  summary: string;               // Auto-generated from constituent memories
  learnings?: string[];          // Synthesized learnings

  start_ts: number;              // First memory timestamp
  end_ts: number;                // Last memory timestamp

  tags?: string[];
  topics?: string[];
  origin: "manual" | "auto";     // Manual or auto-detected
}
```

Chapters are linked to memories via a join table:

```typescript
interface ChapterMemory {
  chapter_id: string;
  memory_id: string;
  position?: number;             // Ordering within the chapter
}
```

## Wisdom (Knowledge Synthesis)

Wisdom distills multiple chapters into consolidated, project-level knowledge.

```typescript
interface Wisdom {
  id: string;                    // Unique wisdom ID: "wisdom_{uuid}"
  project_id: string;

  created_at: number;
  updated_at: number;

  summary: string;               // Compressed representation
  insights?: string[];           // Consolidated insights
  patterns?: string[];           // Patterns across chapters
  best_practices?: string[];     // Practical recommendations
  tags?: string[];

  start_ts: number;              // Earliest chapter start
  end_ts: number;                // Latest chapter end
}
```

Wisdom entries reference the chapters they were synthesized from:

```typescript
interface WisdomChapter {
  wisdom_id: string;
  chapter_id: string;
}
```

### Layer 1: Intent

What was the agent trying to accomplish?

```typescript
interface Intent {
  goal: string;                  // High-level objective
  task_type: TaskType;           // Classification for matching
  context: string;               // Why this task was needed
  constraints: string[];         // Limitations or requirements
}

type TaskType = 
  | "bug_fix"
  | "feature_add"
  | "refactor"
  | "investigation"
  | "test_write"
  | "documentation"
  | "optimization"
  | "security_fix"
  | "dependency_update"
  | "configuration"
  | "other";
```

**Example:**
```json
{
  "goal": "Fix JWT token expiry causing logout",
  "task_type": "bug_fix",
  "context": "Users reporting random logouts after 1 hour",
  "constraints": ["Don't break existing sessions", "Must be backwards compatible"]
}
```

### Layer 2: Perception

What did the agent observe about the codebase/situation?

```typescript
interface Perception {
  observations: Observation[];
  relevant_files: FileContext[];
  patterns_noticed: string[];
  anomalies: string[];
}

interface Observation {
  what: string;                  // What was observed
  where: string;                 // File/location
  significance: string;          // Why it matters
}

interface FileContext {
  path: string;
  relevance: string;             // Why this file matters
  state_summary: string;         // Key info about file state
}
```

**Example:**
```json
{
  "observations": [
    {
      "what": "Token refresh logic missing from auth interceptor",
      "where": "src/auth/interceptor.ts",
      "significance": "Causes 401 on token expiry instead of refresh"
    },
    {
      "what": "Refresh endpoint exists but unused",
      "where": "src/api/auth.ts:45",
      "significance": "Infrastructure exists, just not wired up"
    }
  ],
  "relevant_files": [
    {
      "path": "src/auth/interceptor.ts",
      "relevance": "Main auth handling",
      "state_summary": "Axios interceptor, no refresh logic"
    }
  ],
  "patterns_noticed": ["Other interceptors use retry pattern"],
  "anomalies": ["Token TTL is 1hr but refresh TTL is 7d - mismatch"]
}
```

### Layer 3: Reasoning

How did the agent decide on an approach?

```typescript
interface Reasoning {
  approach_chosen: string;
  why_chosen: string;
  alternatives_considered: Alternative[];
  assumptions: string[];
  risks_identified: string[];
}

interface Alternative {
  approach: string;
  why_rejected: string;
}
```

**Example:**
```json
{
  "approach_chosen": "Add refresh interceptor with retry queue",
  "why_chosen": "Handles concurrent requests during refresh, matches existing patterns",
  "alternatives_considered": [
    {
      "approach": "Increase token TTL to 24hr",
      "why_rejected": "Security concern, doesn't fix root cause"
    },
    {
      "approach": "Proactive refresh before expiry",
      "why_rejected": "Complex timer management, race conditions"
    }
  ],
  "assumptions": [
    "Refresh endpoint is idempotent",
    "401 always means token expiry (might need refinement)"
  ],
  "risks_identified": [
    "Refresh token could also be expired",
    "Infinite retry loop if refresh consistently fails"
  ]
}
```

### Layer 4: Actions

What did the agent actually do?

```typescript
interface Action {
  type: ActionType;
  timestamp: number;
  details: ActionDetails;
  result: ActionResult;
}

type ActionType = 
  | "file_read"
  | "file_edit"
  | "file_create"
  | "file_delete"
  | "command_run"
  | "search"
  | "external_query";    // Web search, docs lookup

interface ActionDetails {
  // For file operations
  file_path?: string;
  lines_affected?: string;       // "45-67" or "45" for single line
  diff_hash?: string;            // Hash of the diff for dedup
  diff_summary?: string;         // Human-readable summary
  
  // For commands
  command?: string;
  working_directory?: string;
  
  // For searches
  query?: string;
  scope?: string;
}

interface ActionResult {
  success: boolean;
  output_summary?: string;       // Condensed output
  error?: string;
  duration_ms?: number;
}
```

**Example:**
```json
{
  "type": "file_edit",
  "timestamp": 1705432800,
  "details": {
    "file_path": "src/auth/interceptor.ts",
    "lines_affected": "45-89",
    "diff_summary": "Added refreshToken() call on 401, with request queue"
  },
  "result": {
    "success": true,
    "duration_ms": 150
  }
}
```

### Layer 5: Outcome

What was the result?

```typescript
interface Outcome {
  success: boolean;
  summary: string;
  
  // What was learned
  learnings: string[];
  
  // For failures
  failure_reason?: string;
  failure_category?: FailureCategory;
  
  // Verification
  verified_by?: VerificationMethod;
  
  // Future recommendations
  follow_up_needed?: string[];
}

type FailureCategory =
  | "incorrect_assumption"
  | "unexpected_side_effect"
  | "missing_dependency"
  | "race_condition"
  | "type_error"
  | "test_failure"
  | "build_failure"
  | "runtime_error"
  | "logic_error"
  | "other";

interface VerificationMethod {
  type: "test" | "build" | "manual" | "lint" | "typecheck";
  command?: string;
  result: string;
}
```

**Example:**
```json
{
  "success": true,
  "summary": "JWT refresh now works, no more random logouts",
  "learnings": [
    "Always check for refresh token expiry too",
    "Request queue pattern prevents race conditions"
  ],
  "verified_by": {
    "type": "test",
    "command": "npm test -- --grep 'auth'",
    "result": "14 tests passed"
  },
  "follow_up_needed": [
    "Add monitoring for refresh failures",
    "Consider refresh token rotation"
  ]
}
```

### Memory Links

Relationships between memories:

```typescript
interface MemoryLinks {
  caused_by?: string[];          // Memory IDs that led to this
  led_to?: string[];             // Memory IDs this caused
  related_to?: string[];         // Loosely related memories
  supersedes?: string;           // This memory replaces another
  blocked_by?: string;           // This was blocked by another failure
}
```

## SQLite Schema

```sql
-- Agent identities
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('main', 'subagent')),
  parent_id TEXT REFERENCES agents(id),
  project_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  metadata JSON
);

-- Core memories
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  
  -- Denormalized for fast queries
  intent_goal TEXT NOT NULL,
  intent_type TEXT NOT NULL,
  outcome_success INTEGER NOT NULL,
  outcome_summary TEXT,
  
  -- Full structured data
  intent JSON NOT NULL,
  perception JSON NOT NULL,
  reasoning JSON NOT NULL,
  actions JSON NOT NULL,
  outcome JSON NOT NULL,
  
  -- Metadata
  tags JSON DEFAULT '[]',
  importance REAL DEFAULT 0.5,
  access_count INTEGER DEFAULT 0,
  last_accessed INTEGER,
  
  -- For semantic search
  embedding BLOB
);

-- File associations for fast file-based lookup
CREATE TABLE memory_files (
  memory_id TEXT NOT NULL REFERENCES memories(id),
  file_path TEXT NOT NULL,
  operation TEXT NOT NULL,  -- read, edit, create, delete
  PRIMARY KEY (memory_id, file_path)
);

-- Memory relationships (graph edges)
CREATE TABLE memory_links (
  source_id TEXT NOT NULL REFERENCES memories(id),
  target_id TEXT NOT NULL REFERENCES memories(id),
  link_type TEXT NOT NULL,  -- caused_by, led_to, related_to, supersedes, blocked_by
  created_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, target_id, link_type)
);

-- Indexes for fast retrieval
CREATE INDEX idx_memories_agent ON memories(agent_id);
CREATE INDEX idx_memories_project ON memories(project_id);
CREATE INDEX idx_memories_created ON memories(created_at);
CREATE INDEX idx_memories_intent_type ON memories(intent_type);
CREATE INDEX idx_memories_success ON memories(outcome_success);
CREATE INDEX idx_memory_files_path ON memory_files(file_path);
CREATE INDEX idx_memory_links_target ON memory_links(target_id);
```

## Memory Lifecycle

```
1. CREATION
   Agent completes meaningful unit of work
   ↓
   store() called with full memory object
   ↓
   RUM validates, generates ID, computes embedding
   ↓
   Stored in SQLite, indexes updated
   
2. RETRIEVAL
   Trigger fires or explicit recall()
   ↓
   Query executed against appropriate index
   ↓
   Memories ranked by relevance + importance
   ↓
   Returned at requested depth level
   ↓
   access_count incremented, last_accessed updated

3. LINKING
   Agent discovers relationship between memories
   ↓
   link() creates edge in memory_links
   ↓
   Enables causal queries

4. ARCHIVAL (future)
   Memories older than N days with low access
   ↓
   Compressed, moved to cold storage
   ↓
   Still queryable but slower
```

## Depth Levels for Retrieval

When retrieving, agent specifies depth:

| Depth | What's returned | Token estimate |
|-------|-----------------|----------------|
| `summary` | intent.goal + outcome.summary | ~20 tokens |
| `outcome` | Above + outcome.* + learnings | ~50 tokens |
| `reasoning` | Above + reasoning.* | ~150 tokens |
| `full` | Everything except raw diffs | ~300 tokens |
| `complete` | Everything including action details | ~500+ tokens |

This allows agents to "peek" at memories cheaply before deciding to load full context.
