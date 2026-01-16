# RUM Trigger System

## Overview

The trigger system makes RUM **proactive** rather than passive. Instead of waiting for agents to remember to query memory, RUM watches agent actions and offers relevant memories at the right moment.

**Key principle:** Offer, don't force. Minimal token cost for offers.

## Trigger Types

### 1. File Touch Trigger

**When:** Agent reads, opens, or edits a file.

**Logic:**
```
Agent touches file X
  ↓
RUM checks: any memories with file X in memory_files?
  ↓
If yes: notify agent with summary
```

**Notification format:**
```
[RUM] auth.ts has history:
  • Agent-002 (2d ago): Fixed JWT expiry — success
  • Agent-003 (5d ago): Attempted caching — failed (race condition)
  
  → recall("file:auth.ts") for details
```

**Configuration:**
```typescript
interface FileTouchTrigger {
  enabled: boolean;
  min_memories: number;         // Only trigger if N+ memories exist
  max_age_days: number;         // Ignore memories older than this
  include_failures: boolean;    // Include failed attempts
  cooldown_seconds: number;     // Don't re-trigger for same file within N seconds
}
```

### 2. Intent Match Trigger

**When:** Agent states a goal/intent that matches past work.

**Logic:**
```
Agent states intent (via store or detected from context)
  ↓
RUM computes intent embedding
  ↓
Compare against stored intent embeddings
  ↓
If similarity > threshold: notify
```

**Notification format:**
```
[RUM] Similar task found:
  • "Fix authentication timeout" (Agent-001, 1w ago) — success
    Approach: Added retry interceptor
  
  → recall("mem_abc123") for full reasoning
```

**Configuration:**
```typescript
interface IntentMatchTrigger {
  enabled: boolean;
  similarity_threshold: number;  // 0-1, default 0.85
  max_results: number;           // Max matches to show
  include_failures: boolean;
  recency_boost: boolean;        // Prefer recent matches
}
```

### 3. Conflict Warning Trigger

**When:** Agent is about to perform an action that previously failed.

**Logic:**
```
Agent about to perform action A on file F
  ↓
RUM checks: any FAILED memories with similar action on F?
  ↓
If yes: WARN (higher priority than normal offers)
```

**Notification format:**
```
[RUM] ⚠️ Warning: Similar action failed before
  • Agent-003 tried "add caching to auth.ts" — FAILED
    Reason: Race condition with concurrent requests
    
  → recall("mem_xyz789", depth: "reasoning") for details
```

**This trigger is special:**
- Higher visual priority (warning indicator)
- Always includes failure reason
- Should not be ignored without acknowledgment

**Configuration:**
```typescript
interface ConflictWarningTrigger {
  enabled: boolean;              // Strongly recommend: always on
  action_similarity_threshold: number;
  require_acknowledgment: boolean;  // Agent must explicitly dismiss
  max_age_days: number;          // Old failures may be irrelevant
}
```

### 4. Pattern Recognition Trigger

**When:** Agent starts a task that matches a known pattern.

**Logic:**
```
Agent starts new task
  ↓
RUM analyzes task structure (files involved, task type, etc.)
  ↓
Compare against historical task patterns
  ↓
If pattern match: offer related memories
```

**Notification format:**
```
[RUM] Pattern recognized: "API endpoint addition"
  Related memories:
  • Agent-001: Added /users endpoint — learned: need rate limiting
  • Agent-002: Added /orders endpoint — learned: add validation middleware
  
  → recall("pattern:api_endpoint") for approach
```

**Configuration:**
```typescript
interface PatternRecognitionTrigger {
  enabled: boolean;
  min_pattern_occurrences: number;  // Need N+ instances to form pattern
  confidence_threshold: number;
  extract_learnings: boolean;       // Summarize learnings from pattern
}
```

### 5. Session Start Trigger

**When:** Agent begins a new session in a project.

**Logic:**
```
Agent starts session
  ↓
RUM checks: any unfinished work? Any important learnings?
  ↓
Provide brief project context
```

**Notification format:**
```
[RUM] Project context:
  • Last session: 2 days ago (Agent-main)
  • Unfinished: "Implement rate limiting" (blocked by Redis setup)
  • Recent learning: "Auth module needs error boundaries"
  
  → recall("session:last") for details
```

**Configuration:**
```typescript
interface SessionStartTrigger {
  enabled: boolean;
  show_unfinished: boolean;
  show_recent_learnings: boolean;
  max_learnings: number;
  lookback_days: number;
}
```

## Trigger Evaluation Flow

```
┌─────────────────────────────────────────────────────────┐
│                    Agent Action                          │
│  (file touch, intent stated, task start, etc.)          │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  Trigger Router                          │
│  Determines which triggers to evaluate                   │
└─────────────────────┬───────────────────────────────────┘
                      │
          ┌───────────┼───────────┬───────────┐
          ▼           ▼           ▼           ▼
     ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
     │  File   │ │ Intent  │ │Conflict │ │ Pattern │
     │ Touch   │ │  Match  │ │ Warning │ │  Recog  │
     └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘
          │           │           │           │
          └───────────┴─────┬─────┴───────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                  Result Aggregator                       │
│  • Deduplicate overlapping memories                      │
│  • Prioritize (warnings > matches > patterns)            │
│  • Enforce token budget for notification                 │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                 Notification Composer                    │
│  • Format for minimal tokens                             │
│  • Include recall commands                               │
│  • Apply cooldown tracking                               │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              MCP Notification to Agent                   │
│  rum://memory_available or rum://conflict_warning        │
└─────────────────────────────────────────────────────────┘
```

## Token Budget for Notifications

Notifications must be minimal to avoid polluting context:

| Notification Type | Max Tokens | Content |
|-------------------|------------|---------|
| File touch | ~60 | File name, N memories, outcomes |
| Intent match | ~80 | Matched intent, approach hint |
| Conflict warning | ~100 | Warning, failure reason, link |
| Pattern recognition | ~80 | Pattern name, key learnings |
| Session start | ~100 | Last session, unfinished, learnings |

**If multiple triggers fire:** Combine into single notification, prioritize by:
1. Conflict warnings (always first)
2. Direct file matches
3. Intent matches
4. Pattern recognition

## Cooldown & Deduplication

Prevent notification spam:

```typescript
interface CooldownConfig {
  // Don't re-notify for same file within N seconds
  file_cooldown_seconds: number;  // default: 300 (5 min)
  
  // Don't re-notify for same memory within N seconds
  memory_cooldown_seconds: number;  // default: 600 (10 min)
  
  // Max notifications per minute
  rate_limit_per_minute: number;  // default: 5
  
  // Batch multiple triggers into single notification
  batch_window_ms: number;  // default: 500
}
```

## Implementation Notes

### Detecting Agent Actions

RUM needs to know what the agent is doing. Two approaches:

**Approach 1: MCP Resource Subscription**
```
Agent subscribes to file resources
RUM intercepts resource access
Trigger evaluation happens
```

**Approach 2: Explicit Hooks**
```typescript
// Agent or runtime calls these explicitly
rum.onFileTouch(filePath);
rum.onIntentStated(intent);
rum.onTaskStart(taskDescription);
```

**Recommendation:** Support both. MCP subscription for passive detection, explicit hooks for richer context.

### Async Trigger Evaluation

Triggers should not block agent work:

```
Agent action → Trigger evaluation starts (async)
                ↓
Agent continues working
                ↓
Trigger completes → Notification queued
                ↓
Notification delivered at next safe point
```

### Trigger Testing

Each trigger should be testable in isolation:

```typescript
// Test file touch trigger
const result = await triggers.fileTouch.evaluate({
  filePath: "src/auth.ts",
  agentId: "agent_001",
  projectId: "project_abc"
});

expect(result.shouldNotify).toBe(true);
expect(result.memories.length).toBe(2);
expect(result.tokenEstimate).toBeLessThan(60);
```
