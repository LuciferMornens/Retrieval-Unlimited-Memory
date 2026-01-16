# RUM Retrieval API

## Design Principles

1. **Precision first** — Exact queries before fuzzy
2. **Depth control** — Agent chooses how much to load
3. **Minimal by default** — Return least tokens that answer the query
4. **Explicit confidence** — Always indicate match quality

## MCP Tools

### `store`

Store a new memory.

```typescript
interface RumStoreParams {
  // Required
  intent: {
    goal: string;
    task_type: TaskType;
    context?: string;
    constraints?: string[];
  };
  outcome: {
    success: boolean;
    summary: string;
    learnings?: string[];
    failure_reason?: string;
    failure_category?: FailureCategory;
  };
  
  // Optional but recommended
  perception?: {
    observations?: Array<{ what: string; where: string; significance: string }>;
    relevant_files?: Array<{ path: string; relevance: string }>;
    patterns_noticed?: string[];
  };
  reasoning?: {
    approach_chosen: string;
    why_chosen: string;
    alternatives_considered?: Array<{ approach: string; why_rejected: string }>;
    assumptions?: string[];
    risks_identified?: string[];
  };
  actions?: Array<{
    type: ActionType;
    file_path?: string;
    lines_affected?: string;
    diff_summary?: string;
    command?: string;
    result?: { success: boolean; output_summary?: string };
  }>;
  
  // Relationships
  links?: {
    caused_by?: string[];
    related_to?: string[];
    supersedes?: string;
  };
  
  // Metadata
  tags?: string[];
  importance?: number;  // 0-1, default 0.5
}

interface RumStoreResult {
  memory_id: string;
  stored_at: number;
  indexed_files: string[];
}
```

**Example:**
```json
{
  "tool": "store",
  "params": {
    "intent": {
      "goal": "Fix JWT token expiry causing logout",
      "task_type": "bug_fix",
      "context": "Users reporting random logouts"
    },
    "perception": {
      "observations": [
        {
          "what": "Token refresh logic missing",
          "where": "src/auth/interceptor.ts",
          "significance": "Root cause of issue"
        }
      ]
    },
    "reasoning": {
      "approach_chosen": "Add refresh interceptor with retry queue",
      "why_chosen": "Handles concurrent requests, matches existing patterns",
      "alternatives_considered": [
        {
          "approach": "Increase token TTL",
          "why_rejected": "Security concern"
        }
      ]
    },
    "actions": [
      {
        "type": "file_edit",
        "file_path": "src/auth/interceptor.ts",
        "lines_affected": "45-89",
        "diff_summary": "Added refreshToken() on 401 with request queue"
      }
    ],
    "outcome": {
      "success": true,
      "summary": "JWT refresh now works correctly",
      "learnings": ["Always handle refresh token expiry too"]
    },
    "tags": ["auth", "jwt", "interceptor"]
  }
}
```

---

### `update_memory`

Update an existing memory by ID. PATCH-style: only provided fields are updated.

```typescript
interface RumUpdateMemoryParams {
  // Required
  memory_id: string;
  
  // All other fields from store are optional
  intent?: {
    goal?: string;
    task_type?: TaskType;
    context?: string;
    constraints?: string[];
  };
  outcome?: {
    success?: boolean;
    summary?: string;
    learnings?: string[];
    failure_reason?: string;
    failure_category?: FailureCategory;
  };
  perception?: {
    observations?: Array<{ what: string; where: string; significance: string }>;
    relevant_files?: Array<{ path: string; relevance: string }>;
    patterns_noticed?: string[];
  };
  reasoning?: {
    approach_chosen?: string;
    why_chosen?: string;
    alternatives_considered?: Array<{ approach: string; why_rejected: string }>;
    assumptions?: string[];
    risks_identified?: string[];
  };
  actions?: Array<{
    type: ActionType;
    file_path?: string;
    lines_affected?: string;
    diff_summary?: string;
    command?: string;
    result?: { success: boolean; output_summary?: string };
  }>;
  links?: {
    caused_by?: string[];
    related_to?: string[];
    supersedes?: string;
  };
  tags?: string[];
  importance?: number;
}

interface RumUpdateMemoryResult {
  memory_id: string;
  updated_at: number;
  memory: RetrievedMemory;  // Full updated memory
}
```

**Merge behavior:**
- **Arrays**: Replace entirely (e.g., new `tags` replaces old `tags`)
- **Objects**: Deep merge (e.g., updating `outcome.summary` preserves `outcome.success`)
- **Embedding**: Regenerated if `intent`, `outcome`, or `reasoning` changes

**Example:**

```json
// Update outcome after discovering more information
{
  "tool": "update_memory",
  "params": {
    "memory_id": "mem_abc123",
    "outcome": {
      "learnings": ["Token refresh also needs error boundary", "Consider retry limit"]
    },
    "tags": ["auth", "jwt", "retry-logic"]
  }
}

// Correct a failure reason
{
  "tool": "update_memory",
  "params": {
    "memory_id": "mem_def456",
    "outcome": {
      "failure_reason": "Race condition in token refresh, not expiry issue",
      "failure_category": "race_condition"
    }
  }
}

// Add reasoning that was initially omitted
{
  "tool": "update_memory",
  "params": {
    "memory_id": "mem_ghi789",
    "reasoning": {
      "approach_chosen": "Implemented mutex lock for token refresh",
      "why_chosen": "Prevents concurrent refresh calls from causing 401 cascade",
      "alternatives_considered": [
        {
          "approach": "Debounce refresh calls",
          "why_rejected": "Still allows race window between check and refresh"
        }
      ]
    }
  }
}
```

**Notes:**
- Original `memory_id` and `created_at` are preserved
- `updated_at` timestamp is set on each update
- Use when you need to correct, extend, or refine existing memories
- Prefer creating new linked memories for genuinely new work

---

### `recall`

Retrieve memories. The primary query tool.

```typescript
interface RumRecallParams {
  // Query scope - at least one required
  memory_id?: string;           // Direct ID lookup
  file?: string;                // File path (exact or pattern)
  intent?: string;              // Natural language intent match
  task_type?: TaskType;         // Filter by task type
  agent_id?: string;            // Filter by specific agent
  query?: string;               // Free-form semantic query (last resort)
  
  // Filters
  success_only?: boolean;       // Only successful outcomes
  failures_only?: boolean;      // Only failed outcomes
  since?: number;               // Unix timestamp
  before?: number;              // Unix timestamp
  tags?: string[];              // Must have all these tags
  
  // Output control
  depth: "summary" | "outcome" | "reasoning" | "full" | "complete";
  limit?: number;               // Max memories, default 5
  include_links?: boolean;      // Include related memory IDs
  
  // Retrieval strategy hint
  strategy?: "exact" | "semantic" | "auto";  // default: auto
}

interface RumRecallResult {
  memories: RetrievedMemory[];
  query_strategy_used: string;
  confidence: number;           // 0-1, how confident in relevance
  total_matches: number;        // Before limit applied
  token_estimate: number;       // Approximate tokens in response
}

interface RetrievedMemory {
  id: string;
  agent_id: string;
  created_at: number;
  confidence: number;           // Per-memory relevance score
  
  // Content varies by depth
  intent: { goal: string; task_type: string };  // Always included
  outcome: { success: boolean; summary: string };  // Always included
  
  // Included based on depth
  learnings?: string[];
  reasoning?: object;
  perception?: object;
  actions?: object[];
  
  // If include_links
  links?: {
    caused_by?: string[];
    led_to?: string[];
    related_to?: string[];
  };
}
```

**Example queries:**

```json
// Direct file lookup
{
  "tool": "recall",
  "params": {
    "file": "src/auth/interceptor.ts",
    "depth": "outcome",
    "limit": 3
  }
}

// Find similar past work
{
  "tool": "recall",
  "params": {
    "intent": "implement rate limiting",
    "depth": "reasoning",
    "include_links": true
  }
}

// Get failure context
{
  "tool": "recall",
  "params": {
    "file": "src/api/orders.ts",
    "failures_only": true,
    "depth": "full"
  }
}

// Recent work by specific agent
{
  "tool": "recall",
  "params": {
    "agent_id": "agent_subagent_002",
    "since": 1705363200,
    "depth": "summary",
    "limit": 10
  }
}
```

---

### `trace`

Trace causal chains — "what led to this?"

```typescript
interface RumTraceParams {
  memory_id: string;            // Starting point
  direction: "causes" | "effects" | "both";
  max_depth?: number;           // How many hops, default 3
  depth: "summary" | "outcome" | "reasoning";
}

interface RumTraceResult {
  origin: RetrievedMemory;
  chain: TraceNode[];
  total_nodes: number;
}

interface TraceNode {
  memory: RetrievedMemory;
  relationship: "caused_by" | "led_to";
  distance: number;             // Hops from origin
}
```

**Example:**
```json
{
  "tool": "trace",
  "params": {
    "memory_id": "mem_abc123",
    "direction": "causes",
    "max_depth": 3,
    "depth": "outcome"
  }
}
```

**Result:**
```json
{
  "origin": {
    "id": "mem_abc123",
    "intent": { "goal": "Fix race condition in auth" },
    "outcome": { "success": true, "summary": "Added mutex lock" }
  },
  "chain": [
    {
      "memory": {
        "id": "mem_xyz789",
        "intent": { "goal": "Add caching to auth" },
        "outcome": { "success": false, "summary": "Caused race condition" }
      },
      "relationship": "caused_by",
      "distance": 1
    },
    {
      "memory": {
        "id": "mem_def456",
        "intent": { "goal": "Performance optimization requested" },
        "outcome": { "success": true, "summary": "Identified auth as bottleneck" }
      },
      "relationship": "caused_by",
      "distance": 2
    }
  ]
}
```

---

### `list`

List agent's own memories (for self-review).

```typescript
interface RumListParams {
  session_id?: string;          // Filter to specific session
  since?: number;
  limit?: number;               // default 20
  sort?: "recent" | "importance" | "access_count";
}

interface RumListResult {
  memories: Array<{
    id: string;
    created_at: number;
    intent_goal: string;
    outcome_success: boolean;
    outcome_summary: string;
    importance: number;
    access_count: number;
  }>;
  total: number;
}
```

---

### `link`

Create relationship between memories.

```typescript
interface RumLinkParams {
  source_id: string;
  target_id: string;
  link_type: "caused_by" | "led_to" | "related_to" | "supersedes" | "blocked_by";
}

interface RumLinkResult {
  created: boolean;
  link_id: string;
}
```

---

### `identity`

Manage agent identity.

```typescript
interface RumIdentityParams {
  action: "register" | "resume" | "info";
  
  // For register
  type?: "main" | "subagent";
  parent_id?: string;           // Required for subagent
  
  // For resume
  agent_id?: string;            // Resume specific identity
}

interface RumIdentityResult {
  agent_id: string;
  type: string;
  created_at: number;
  memory_count: number;
  last_active: number;
}
```

---

## Retrieval Strategy Cascade

When `strategy: "auto"` (default), RUM uses this cascade:

```
1. EXACT MATCH (highest confidence)
   ├─ memory_id provided? → Direct lookup
   ├─ file provided? → SQL: WHERE file_path = ?
   └─ task_type provided? → SQL: WHERE intent_type = ?

2. STRUCTURAL QUERY (high confidence)
   ├─ Combine filters (time, agent, tags)
   └─ SQL with proper indexes

3. PATTERN MATCH (medium confidence)
   ├─ Intent text similarity (fuzzy string match)
   └─ Task structure similarity

4. SEMANTIC SEARCH (lower confidence)
   ├─ Embed query
   ├─ Vector similarity search
   └─ Flag results as "fuzzy match"

Each level only executes if previous levels return < limit results.
```

## Response Depth Examples

Same memory at different depths:

**`depth: "summary"` (~20 tokens)**
```json
{
  "id": "mem_abc123",
  "intent": { "goal": "Fix JWT token expiry" },
  "outcome": { "success": true, "summary": "Added refresh interceptor" }
}
```

**`depth: "outcome"` (~50 tokens)**
```json
{
  "id": "mem_abc123",
  "intent": { "goal": "Fix JWT token expiry", "task_type": "bug_fix" },
  "outcome": {
    "success": true,
    "summary": "Added refresh interceptor",
    "learnings": ["Always handle refresh token expiry too", "Request queue prevents race conditions"]
  }
}
```

**`depth: "reasoning"` (~150 tokens)**
```json
{
  "id": "mem_abc123",
  "intent": { "goal": "Fix JWT token expiry", "task_type": "bug_fix", "context": "Users reporting random logouts" },
  "outcome": { "success": true, "summary": "Added refresh interceptor", "learnings": [...] },
  "reasoning": {
    "approach_chosen": "Add refresh interceptor with retry queue",
    "why_chosen": "Handles concurrent requests, matches existing patterns",
    "alternatives_considered": [
      { "approach": "Increase token TTL", "why_rejected": "Security concern" }
    ]
  }
}
```

**`depth: "full"` (~300 tokens)**
Above + perception + actions (without raw diffs)

**`depth: "complete"` (~500+ tokens)**
Everything including detailed action outputs

## Error Handling

```typescript
interface RumError {
  code: string;
  message: string;
  details?: object;
}

// Error codes
"NOT_FOUND"           // Memory ID doesn't exist
"INVALID_QUERY"       // Malformed query params
"NO_RESULTS"          // Query returned nothing (not an error, but flagged)
"PERMISSION_DENIED"   // Agent trying to write to another's memory
"RATE_LIMITED"        // Too many queries
"STORAGE_ERROR"       // Database issue
```

## Usage Patterns

### Pattern 1: Reactive retrieval (on trigger)

```
[RUM notification] → Agent receives offer → Agent calls recall if interested
```

### Pattern 2: Proactive check before work

```
Agent about to work on file X
  → recall({ file: X, depth: "outcome" })
  → See what happened before
  → Proceed with context
```

### Pattern 3: Learning from failures

```
Agent task failed
  → recall({ file: X, failures_only: true, depth: "reasoning" })
  → Understand what went wrong before
  → Avoid same mistakes
```

### Pattern 4: Continuing interrupted work

```
Agent starts session
  → list({ sort: "recent", limit: 5 })
  → See recent memories
  → recall({ memory_id: "...", depth: "full" })
  → Resume with full context
```

---

## Chapters & Wisdom

Chapters and Wisdom provide higher-level organization of memories.

### `create_chapter`

Create a chapter manually or auto-detect by tag clustering.

```typescript
interface CreateChapterParams {
  // Manual creation (provide memory_ids)
  memory_ids?: string[];
  title?: string;
  
  // Auto-detection (provide tags for clustering)
  tags?: string[];
  min_memories?: number;        // Minimum memories to form a chapter, default 3
}

interface CreateChapterResult {
  chapter_id: string;
  memory_count: number;
  summary: string;
  learnings: string[];
  start_ts: number;
  end_ts: number;
  origin: "manual" | "auto";
}
```

**Examples:**

```json
// Manual chapter creation
{
  "tool": "create_chapter",
  "params": {
    "memory_ids": ["mem_abc123", "mem_def456", "mem_ghi789"],
    "title": "JWT Authentication Overhaul"
  }
}

// Auto-detect by tag clustering
{
  "tool": "create_chapter",
  "params": {
    "tags": ["auth", "jwt"],
    "min_memories": 3
  }
}
```

---

### `list_chapters`

Query chapters with filters.

```typescript
interface ListChaptersParams {
  tags?: string[];              // Filter by tags
  since?: number;               // Unix timestamp (start_ts >= since)
  before?: number;              // Unix timestamp (end_ts <= before)
  limit?: number;               // Max chapters to return, default 10
}

interface ListChaptersResult {
  chapters: Array<{
    id: string;
    title?: string;
    summary: string;
    learnings?: string[];
    start_ts: number;
    end_ts: number;
    memory_count: number;
    tags?: string[];
    topics?: string[];
    origin: "manual" | "auto";
  }>;
  total: number;
}
```

**Example:**

```json
{
  "tool": "list_chapters",
  "params": {
    "tags": ["auth"],
    "since": 1705363200,
    "limit": 5
  }
}
```

---

### `synthesize`

Create wisdom from chapters.

```typescript
interface SynthesizeParams {
  chapter_ids?: string[];       // Specific chapters to synthesize
  tags?: string[];              // Or find chapters by tags
  min_chapters?: number;        // Minimum chapters required, default 2
}

interface SynthesizeResult {
  wisdom_id: string;
  summary: string;
  insights: string[];
  patterns: string[];
  best_practices: string[];
  chapter_count: number;
  start_ts: number;
  end_ts: number;
}
```

**Examples:**

```json
// Synthesize specific chapters
{
  "tool": "synthesize",
  "params": {
    "chapter_ids": ["chapter_abc", "chapter_def", "chapter_ghi"]
  }
}

// Synthesize by topic
{
  "tool": "synthesize",
  "params": {
    "tags": ["authentication"],
    "min_chapters": 3
  }
}
```

---

### `recall_wisdom`

Retrieve wisdom entries by ID or query.

```typescript
interface RecallWisdomParams {
  wisdom_id?: string;           // Direct ID lookup
  tags?: string[];              // Filter by tags
  query?: string;               // Free-form query
  limit?: number;               // Max entries to return, default 5
  include_chapters?: boolean;   // Include source chapter IDs
}

interface RecallWisdomResult {
  wisdom: Array<{
    id: string;
    summary: string;
    insights?: string[];
    patterns?: string[];
    best_practices?: string[];
    tags?: string[];
    start_ts: number;
    end_ts: number;
    chapter_ids?: string[];     // If include_chapters
  }>;
  total: number;
}
```

**Examples:**

```json
// Direct lookup
{
  "tool": "recall_wisdom",
  "params": {
    "wisdom_id": "wisdom_abc123"
  }
}

// Query by topic
{
  "tool": "recall_wisdom",
  "params": {
    "tags": ["security"],
    "include_chapters": true,
    "limit": 3
  }
}
```

---

## Usage Patterns (Chapters & Wisdom)

### Pattern 5: Building project knowledge

```
After completing related work
  → create_chapter({ memory_ids: [...], title: "Feature X" })
  → Chapter synthesizes learnings from all memories
  
Periodically or after major milestones
  → synthesize({ tags: ["api"], min_chapters: 3 })
  → Wisdom consolidates patterns and best practices
```

### Pattern 6: Retrieving high-level context

```
Agent starting new feature
  → recall_wisdom({ tags: ["auth"], include_chapters: true })
  → Get project-level insights and patterns
  → If need more detail:
      → list_chapters({ chapter_ids from wisdom })
      → Then recall individual memories
```
