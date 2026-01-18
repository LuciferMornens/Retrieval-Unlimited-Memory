import { z } from "zod";

// ============================================================================
// Task Types
// ============================================================================

export const TaskType = z.enum([
  "bug_fix",
  "feature_add",
  "refactor",
  "investigation",
  "test_write",
  "documentation",
  "optimization",
  "security_fix",
  "dependency_update",
  "configuration",
  "other",
]);
export type TaskType = z.infer<typeof TaskType>;

export const FailureCategory = z.enum([
  "incorrect_assumption",
  "unexpected_side_effect",
  "missing_dependency",
  "race_condition",
  "type_error",
  "test_failure",
  "build_failure",
  "runtime_error",
  "logic_error",
  "other",
]);
export type FailureCategory = z.infer<typeof FailureCategory>;

export const ActionType = z.enum([
  "file_read",
  "file_edit",
  "file_create",
  "file_delete",
  "command_run",
  "search",
  "external_query",
]);
export type ActionType = z.infer<typeof ActionType>;

// ============================================================================
// Memory Layers
// ============================================================================

export const IntentSchema = z.object({
  goal: z.string(),
  task_type: TaskType,
  context: z.string().optional(),
  constraints: z.array(z.string()).optional(),
});
export type Intent = z.infer<typeof IntentSchema>;

export const ObservationSchema = z.object({
  what: z.string(),
  where: z.string(),
  significance: z.string(),
});
export type Observation = z.infer<typeof ObservationSchema>;

export const FileContextSchema = z.object({
  path: z.string(),
  relevance: z.string(),
  state_summary: z.string().optional(),
});
export type FileContext = z.infer<typeof FileContextSchema>;

export const PerceptionSchema = z.object({
  observations: z.array(ObservationSchema).optional(),
  relevant_files: z.array(FileContextSchema).optional(),
  patterns_noticed: z.array(z.string()).optional(),
  anomalies: z.array(z.string()).optional(),
});
export type Perception = z.infer<typeof PerceptionSchema>;

export const AlternativeSchema = z.object({
  approach: z.string(),
  why_rejected: z.string(),
});
export type Alternative = z.infer<typeof AlternativeSchema>;

export const ReasoningSchema = z.object({
  approach_chosen: z.string(),
  why_chosen: z.string(),
  alternatives_considered: z.array(AlternativeSchema).optional(),
  assumptions: z.array(z.string()).optional(),
  risks_identified: z.array(z.string()).optional(),
});
export type Reasoning = z.infer<typeof ReasoningSchema>;

export const ActionResultSchema = z.object({
  success: z.boolean(),
  output_summary: z.string().optional(),
  error: z.string().optional(),
  duration_ms: z.number().optional(),
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

export const ActionSchema = z.object({
  type: ActionType,
  timestamp: z.number().optional(),
  file_path: z.string().optional(),
  lines_affected: z.string().optional(),
  diff_hash: z.string().optional(),
  diff_summary: z.string().optional(),
  command: z.string().optional(),
  working_directory: z.string().optional(),
  query: z.string().optional(),
  scope: z.string().optional(),
  result: ActionResultSchema.optional(),
});
export type Action = z.infer<typeof ActionSchema>;

export const VerificationMethodSchema = z.object({
  type: z.enum(["test", "build", "manual", "lint", "typecheck"]),
  command: z.string().optional(),
  result: z.string(),
});
export type VerificationMethod = z.infer<typeof VerificationMethodSchema>;

export const OutcomeSchema = z.object({
  success: z.boolean(),
  summary: z.string(),
  learnings: z.array(z.string()).optional(),
  failure_reason: z.string().optional(),
  failure_category: FailureCategory.optional(),
  verified_by: VerificationMethodSchema.optional(),
  follow_up_needed: z.array(z.string()).optional(),
});
export type Outcome = z.infer<typeof OutcomeSchema>;

export const MemoryLinksSchema = z.object({
  caused_by: z.array(z.string()).optional(),
  led_to: z.array(z.string()).optional(),
  related_to: z.array(z.string()).optional(),
  supersedes: z.string().optional(),
  blocked_by: z.string().optional(),
});
export type MemoryLinks = z.infer<typeof MemoryLinksSchema>;

// ============================================================================
// Full Memory Object
// ============================================================================

export const MemorySchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  project_id: z.string(),
  session_id: z.string(),
  created_at: z.number(),

  intent: IntentSchema,
  perception: PerceptionSchema.optional(),
  reasoning: ReasoningSchema.optional(),
  actions: z.array(ActionSchema).optional(),
  outcome: OutcomeSchema,

  links: MemoryLinksSchema.optional(),
  tags: z.array(z.string()).optional(),
  importance: z.number().min(0).max(1).optional(),
  access_count: z.number().optional(),
  last_accessed: z.number().nullable().optional(),
});
export type Memory = z.infer<typeof MemorySchema>;

// ============================================================================
// Chapters & Wisdom
// ============================================================================

export const ChapterSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
  title: z.string().optional(),
  summary: z.string(),
  learnings: z.array(z.string()).optional(),
  start_ts: z.number(),
  end_ts: z.number(),
  tags: z.array(z.string()).optional(),
  topics: z.array(z.string()).optional(),
  origin: z.enum(["manual", "auto"]),
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const WisdomSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
  summary: z.string(),
  insights: z.array(z.string()).optional(),
  patterns: z.array(z.string()).optional(),
  best_practices: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  start_ts: z.number(),
  end_ts: z.number(),
});
export type Wisdom = z.infer<typeof WisdomSchema>;

// ============================================================================
// Agent Identity
// ============================================================================

export const AgentType = z.enum(["main", "subagent"]);
export type AgentType = z.infer<typeof AgentType>;

export const AgentIdentitySchema = z.object({
  id: z.string(),
  type: AgentType,
  parent_id: z.string().nullable(),
  project_id: z.string(),
  created_at: z.number(),
  last_active_at: z.number(),
  session_count: z.number(),
  memory_count: z.number(),
  success_count: z.number(),
  failure_count: z.number(),
  specialization: z.string().nullable().optional(),
  capabilities: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;

// ============================================================================
// API Params & Results
// ============================================================================

export const RumStoreParamsSchema = z.object({
  intent: IntentSchema,
  outcome: OutcomeSchema,
  perception: PerceptionSchema.optional(),
  reasoning: ReasoningSchema.optional(),
  actions: z.array(ActionSchema).optional(),
  links: MemoryLinksSchema.optional(),
  tags: z.array(z.string()).optional(),
  importance: z.number().min(0).max(1).optional(),
  target_agent_id: z.string().optional(), // Write to another agent's memory
});
export type RumStoreParams = z.infer<typeof RumStoreParamsSchema>;

export const RumUpdateMemoryParamsSchema = z.object({
  memory_id: z.string(),
  intent: IntentSchema.partial().optional(),
  outcome: OutcomeSchema.partial().optional(),
  perception: PerceptionSchema.partial().optional(),
  reasoning: ReasoningSchema.partial().optional(),
  actions: z.array(ActionSchema).optional(),
  links: MemoryLinksSchema.partial().optional(),
  tags: z.array(z.string()).optional(),
  importance: z.number().min(0).max(1).optional(),
  target_agent_id: z.string().optional(),
});
export type RumUpdateMemoryParams = z.infer<typeof RumUpdateMemoryParamsSchema>;

export const DepthLevel = z.enum([
  "summary",
  "outcome",
  "reasoning",
  "full",
  "complete",
]);
export type DepthLevel = z.infer<typeof DepthLevel>;

export const RetrievalStrategy = z.enum(["exact", "semantic", "auto"]);
export type RetrievalStrategy = z.infer<typeof RetrievalStrategy>;

export const RumRecallParamsSchema = z.object({
  memory_id: z.string().optional(),
  file: z.string().optional(),
  intent: z.string().optional(),
  task_type: TaskType.optional(),
  agent_id: z.string().optional(),
  query: z.string().optional(),

  success_only: z.boolean().optional(),
  failures_only: z.boolean().optional(),
  since: z.number().optional(),
  before: z.number().optional(),
  tags: z.array(z.string()).optional(),

  depth: DepthLevel,
  limit: z.number().optional(),
  include_links: z.boolean().optional(),
  strategy: RetrievalStrategy.optional(),
});
export type RumRecallParams = z.infer<typeof RumRecallParamsSchema>;

export const RumTraceParamsSchema = z.object({
  memory_id: z.string(),
  direction: z.enum(["causes", "effects", "both"]),
  max_depth: z.number().optional(),
  depth: DepthLevel,
});
export type RumTraceParams = z.infer<typeof RumTraceParamsSchema>;

export const RumListParamsSchema = z.object({
  session_id: z.string().optional(),
  since: z.number().optional(),
  limit: z.number().optional(),
  sort: z.enum(["recent", "importance", "access_count"]).optional(),
});
export type RumListParams = z.infer<typeof RumListParamsSchema>;

export const RumLinkParamsSchema = z.object({
  source_id: z.string(),
  target_id: z.string(),
  link_type: z.enum([
    "caused_by",
    "led_to",
    "related_to",
    "supersedes",
    "blocked_by",
  ]),
});
export type RumLinkParams = z.infer<typeof RumLinkParamsSchema>;

export const RumCheckFileParamsSchema = z.object({
  file_path: z.string(),
});
export type RumCheckFileParams = z.infer<typeof RumCheckFileParamsSchema>;

export const RumIdentityParamsSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("register"),
    type: AgentType.optional(),
    parent_id: z.string().optional(),
    specialization: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal("resume"),
    agent_id: z.string().optional(),
  }),
  z.object({
    action: z.literal("info"),
  }),
]);
export type RumIdentityParams = z.infer<typeof RumIdentityParamsSchema>;

export const RumDeleteMemoryParamsSchema = z.object({
  memory_id: z.string(),
});
export type RumDeleteMemoryParams = z.infer<typeof RumDeleteMemoryParamsSchema>;

export const RumDeleteChapterParamsSchema = z.object({
  chapter_id: z.string(),
});
export type RumDeleteChapterParams = z.infer<typeof RumDeleteChapterParamsSchema>;

export const RumDeleteWisdomParamsSchema = z.object({
  wisdom_id: z.string(),
});
export type RumDeleteWisdomParams = z.infer<typeof RumDeleteWisdomParamsSchema>;

export const RumResetAllParamsSchema = z.object({
  confirmation: z.literal("RESET_ALL"),
});
export type RumResetAllParams = z.infer<typeof RumResetAllParamsSchema>;

// ============================================================================
// Chapters & Wisdom Params
// ============================================================================

export const RumCreateChapterParamsSchema = z.object({
  title: z.string().optional(),
  memory_ids: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  topics: z.array(z.string()).optional(),
  auto_detect: z.boolean().optional(),
  since: z.number().optional(),
  before: z.number().optional(),
  min_memories: z.number().optional(),
  limit: z.number().optional(),
});
export type RumCreateChapterParams = z.infer<typeof RumCreateChapterParamsSchema>;

export const RumListChaptersParamsSchema = z.object({
  since: z.number().optional(),
  before: z.number().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().optional(),
  sort: z.enum(["recent", "start"]).optional(),
});
export type RumListChaptersParams = z.infer<typeof RumListChaptersParamsSchema>;

export const RumSynthesizeParamsSchema = z.object({
  chapter_ids: z.array(z.string()).optional(),
  since: z.number().optional(),
  before: z.number().optional(),
  min_chapters: z.number().optional(),
  tags: z.array(z.string()).optional(),
});
export type RumSynthesizeParams = z.infer<typeof RumSynthesizeParamsSchema>;

export const RumRecallWisdomParamsSchema = z.object({
  wisdom_id: z.string().optional(),
  since: z.number().optional(),
  before: z.number().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().optional(),
});
export type RumRecallWisdomParams = z.infer<typeof RumRecallWisdomParamsSchema>;

// ============================================================================
// Retrieved Memory (for responses)
// ============================================================================

export interface RetrievedMemory {
  id: string;
  agent_id: string;
  created_at: number;
  confidence: number;
  intent: { goal: string; task_type: string };
  outcome: { success: boolean; summary: string };
  learnings?: string[];
  reasoning?: Reasoning;
  perception?: Perception;
  actions?: Action[];
  links?: MemoryLinks;
}

export interface RumRecallResult {
  memories: RetrievedMemory[];
  query_strategy_used: string;
  confidence: number;
  total_matches: number;
  token_estimate: number;
}

export interface RumStoreResult {
  memory_id: string;
  stored_at: number;
  indexed_files: string[];
}

export interface RumTraceResult {
  origin: RetrievedMemory;
  chain: Array<{
    memory: RetrievedMemory;
    relationship: "caused_by" | "led_to";
    distance: number;
  }>;
  total_nodes: number;
}

export interface RumListResult {
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

export interface RumLinkResult {
  created: boolean;
  link_id: string;
}

export interface RumDeleteResult {
  deleted: boolean;
}

export interface RumResetResult {
  reset: boolean;
}

export interface RumIdentityResult {
  agent_id: string;
  type: string;
  created_at: number;
  memory_count: number;
  last_active: number;
  session_count: number;
  success_rate: number;
}

export interface ChapterSummary {
  id: string;
  title?: string;
  summary: string;
  learnings?: string[];
  start_ts: number;
  end_ts: number;
  tags?: string[];
  topics?: string[];
  origin: "manual" | "auto";
  created_at: number;
  updated_at: number;
  memory_count: number;
}

export interface RumCreateChapterResult {
  chapters: ChapterSummary[];
  total_created: number;
}

export interface RumListChaptersResult {
  chapters: ChapterSummary[];
  total: number;
}

export interface WisdomSummary {
  id: string;
  summary: string;
  insights?: string[];
  patterns?: string[];
  best_practices?: string[];
  tags?: string[];
  start_ts: number;
  end_ts: number;
  created_at: number;
  updated_at: number;
}

export interface RumSynthesizeResult {
  wisdom: WisdomSummary;
}

export interface RumRecallWisdomResult {
  wisdom: WisdomSummary[];
  total: number;
}
