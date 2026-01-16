#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { RumDatabase } from "./storage/database.js";
import { MemoryService } from "./core/memory-service.js";
import { IdentityService } from "./core/identity-service.js";
import { TriggerService } from "./core/trigger-service.js";
import { ChapterService } from "./core/chapter-service.js";
import { SynthesisService } from "./core/synthesis-service.js";
import {
  RumStoreParamsSchema,
  RumRecallParamsSchema,
  RumTraceParamsSchema,
  RumListParamsSchema,
  RumLinkParamsSchema,
  RumUpdateMemoryParamsSchema,
  RumIdentityParamsSchema,
  RumCreateChapterParamsSchema,
  RumListChaptersParamsSchema,
  RumSynthesizeParamsSchema,
  RumRecallWisdomParamsSchema,
  RumDeleteMemoryParamsSchema,
  RumDeleteChapterParamsSchema,
  RumDeleteWisdomParamsSchema,
  RumResetAllParamsSchema,
} from "./types.js";

// Get project ID from environment or args
const projectId = process.env.RUM_PROJECT_ID || process.argv[2] || "default";

// Embedding config from environment
const embeddingProvider = (process.env.RUM_EMBEDDING_PROVIDER || "ollama") as "ollama" | "openai";
const embeddingConfig = {
  provider: embeddingProvider,
  model: process.env.RUM_EMBEDDING_MODEL,
  baseUrl: process.env.RUM_EMBEDDING_URL,
  apiKey: process.env.OPENAI_API_KEY,
};

// Initialize services
const db = new RumDatabase({ projectId });
const memoryService = new MemoryService(db, embeddingConfig);
const identityService = new IdentityService(db);
const triggerService = new TriggerService(db);
const chapterService = new ChapterService(db);
const synthesisService = new SynthesisService(db);

// Log embedding status
console.error(`RUM: Embeddings ${memoryService.embeddingsEnabled ? "enabled" : "disabled"} (${embeddingProvider})`);

// Create MCP server
const server = new Server(
  {
    name: "rum",
    version: "0.1.0",
    description: `RUM (Retrieval Unlimited Memory) - Persistent memory for AI agents.

## Session Workflow
1. **Start**: Call 'identity' to register or resume your agent
2. **Recall**: Call 'recall' with depth:"summary" to see what's been done
3. **Check**: Before editing files, call 'check_file' for relevant past memories
4. **Work**: Do the task
5. **Store**: After meaningful work, call 'store' with intent, outcome, etc.
6. **Update**: Use 'update_memory' to patch existing memories if needed

## Depth Levels (token budget control)
- summary (~20 tokens): Quick scan of what exists
- outcome (~50 tokens): Need to know what happened
- reasoning (~150 tokens): Need to understand decisions
- full (~300 tokens): Need most context
- complete (~500+ tokens): Need everything including actions

**Tip**: Start with 'summary', load more only if needed.

## When to Store Memories
DO store after: bug fixes, feature implementations, design decisions, failed attempts (valuable!), codebase learnings
DON'T store for: trivial file reads, simple searches, no meaningful work done

## Importance Scale
0.3-0.5: Routine work | 0.6-0.8: Significant changes | 0.9-1.0: Critical decisions

## Cross-Agent Collaboration
- Use 'target_agent_id' in store to write memories for another agent
- Use 'agent_id' filter in recall to read another agent's memories

## Knowledge Hierarchy
Memories (atomic ~500 tokens) → Chapters (grouped narratives) → Wisdom (project-level insights)
Use 'create_chapter' to group related memories, 'synthesize' to distill into wisdom.`,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS: Tool[] = [
  {
    name: "identity",
    description:
      "Register a new agent identity, resume an existing one, or get info about current identity. Must be called before storing memories. RECOMMENDED: Always try 'resume' first (without agent_id) - it auto-resumes your last agent. Only use 'register' if resume fails (first-time setup).",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["register", "resume", "info"],
          description: "Action to perform",
        },
        type: {
          type: "string",
          enum: ["main", "subagent"],
          description: "Agent type (for register)",
        },
        parent_id: {
          type: "string",
          description: "Parent agent ID (required for subagent registration)",
        },
        agent_id: {
          type: "string",
          description: "Agent ID to resume (optional; omit to auto-resume last active main agent)",
        },
        specialization: {
          type: "string",
          description: "Agent specialization (e.g., 'frontend', 'testing')",
        },
        capabilities: {
          type: "array",
          items: { type: "string" },
          description: "Agent capabilities",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "store",
    description:
      "Store a memory after completing meaningful work. Use when: fixing bugs, implementing features, making design decisions, or learning something important about the codebase. Include failed attempts - they're valuable! Skip for trivial reads/searches. Set importance: 0.3-0.5 routine, 0.6-0.8 significant, 0.9-1.0 critical.",
    inputSchema: {
      type: "object",
      properties: {
        intent: {
          type: "object",
          properties: {
            goal: { type: "string", description: "What you were trying to accomplish" },
            task_type: {
              type: "string",
              enum: [
                "bug_fix", "feature_add", "refactor", "investigation",
                "test_write", "documentation", "optimization",
                "security_fix", "dependency_update", "configuration", "other",
              ],
            },
            context: { type: "string", description: "Why this task was needed" },
            constraints: { type: "array", items: { type: "string" } },
          },
          required: ["goal", "task_type"],
        },
        outcome: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            summary: { type: "string", description: "What happened" },
            learnings: { type: "array", items: { type: "string" } },
            failure_reason: { type: "string" },
            failure_category: {
              type: "string",
              enum: [
                "incorrect_assumption", "unexpected_side_effect",
                "missing_dependency", "race_condition", "type_error",
                "test_failure", "build_failure", "runtime_error",
                "logic_error", "other",
              ],
            },
          },
          required: ["success", "summary"],
        },
        perception: {
          type: "object",
          properties: {
            observations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  what: { type: "string" },
                  where: { type: "string" },
                  significance: { type: "string" },
                },
              },
            },
            relevant_files: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  relevance: { type: "string" },
                },
              },
            },
            patterns_noticed: { type: "array", items: { type: "string" } },
          },
        },
        reasoning: {
          type: "object",
          properties: {
            approach_chosen: { type: "string" },
            why_chosen: { type: "string" },
            alternatives_considered: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  approach: { type: "string" },
                  why_rejected: { type: "string" },
                },
              },
            },
            assumptions: { type: "array", items: { type: "string" } },
            risks_identified: { type: "array", items: { type: "string" } },
          },
        },
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["file_read", "file_edit", "file_create", "file_delete", "command_run", "search"],
              },
              file_path: { type: "string" },
              lines_affected: { type: "string" },
              diff_summary: { type: "string" },
              command: { type: "string" },
              result: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  output_summary: { type: "string" },
                },
              },
            },
          },
        },
        links: {
          type: "object",
          properties: {
            caused_by: { type: "array", items: { type: "string" } },
            related_to: { type: "array", items: { type: "string" } },
            supersedes: { type: "string" },
          },
        },
        tags: { type: "array", items: { type: "string" } },
        importance: { type: "number", minimum: 0, maximum: 1 },
        target_agent_id: { type: "string", description: "Write to another agent's memory (optional)" },
      },
      required: ["intent", "outcome"],
    },
  },
  {
    name: "update_memory",
    description:
      "Update an existing memory by ID. Only provided fields are patched (arrays replace, objects merge). Use to correct or extend stored memories.",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string" },
        intent: {
          type: "object",
          properties: {
            goal: { type: "string", description: "What you were trying to accomplish" },
            task_type: {
              type: "string",
              enum: [
                "bug_fix", "feature_add", "refactor", "investigation",
                "test_write", "documentation", "optimization",
                "security_fix", "dependency_update", "configuration", "other",
              ],
            },
            context: { type: "string", description: "Why this task was needed" },
            constraints: { type: "array", items: { type: "string" } },
          },
        },
        outcome: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            summary: { type: "string", description: "What happened" },
            learnings: { type: "array", items: { type: "string" } },
            failure_reason: { type: "string" },
            failure_category: {
              type: "string",
              enum: [
                "incorrect_assumption", "unexpected_side_effect",
                "missing_dependency", "race_condition", "type_error",
                "test_failure", "build_failure", "runtime_error",
                "logic_error", "other",
              ],
            },
          },
        },
        perception: {
          type: "object",
          properties: {
            observations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  what: { type: "string" },
                  where: { type: "string" },
                  significance: { type: "string" },
                },
              },
            },
            relevant_files: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  relevance: { type: "string" },
                  state_summary: { type: "string" },
                },
              },
            },
            patterns_noticed: { type: "array", items: { type: "string" } },
            anomalies: { type: "array", items: { type: "string" } },
          },
        },
        reasoning: {
          type: "object",
          properties: {
            approach_chosen: { type: "string" },
            why_chosen: { type: "string" },
            alternatives_considered: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  approach: { type: "string" },
                  why_rejected: { type: "string" },
                },
              },
            },
            assumptions: { type: "array", items: { type: "string" } },
            risks_identified: { type: "array", items: { type: "string" } },
          },
        },
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [
                  "file_read", "file_edit", "file_create", "file_delete",
                  "command_run", "search", "external_query",
                ],
              },
              timestamp: { type: "number" },
              file_path: { type: "string" },
              lines_affected: { type: "string" },
              diff_hash: { type: "string" },
              diff_summary: { type: "string" },
              command: { type: "string" },
              working_directory: { type: "string" },
              query: { type: "string" },
              scope: { type: "string" },
              result: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  output_summary: { type: "string" },
                  error: { type: "string" },
                  duration_ms: { type: "number" },
                },
              },
            },
          },
        },
        links: {
          type: "object",
          properties: {
            caused_by: { type: "array", items: { type: "string" } },
            led_to: { type: "array", items: { type: "string" } },
            related_to: { type: "array", items: { type: "string" } },
            supersedes: { type: "string" },
            blocked_by: { type: "string" },
          },
        },
        tags: { type: "array", items: { type: "string" } },
        importance: { type: "number", minimum: 0, maximum: 1 },
        target_agent_id: { type: "string" },
      },
      required: ["memory_id"],
    },
  },
  {
    name: "recall",
    description:
      "Retrieve memories. Query by memory ID, file path, task type, or other filters. Control response depth to manage token usage.",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string", description: "Direct memory ID lookup" },
        file: { type: "string", description: "File path to find memories for" },
        intent: { type: "string", description: "Natural language intent to match" },
        task_type: {
          type: "string",
          enum: [
            "bug_fix", "feature_add", "refactor", "investigation",
            "test_write", "documentation", "optimization",
            "security_fix", "dependency_update", "configuration", "other",
          ],
        },
        agent_id: { type: "string", description: "Filter by specific agent" },
        success_only: { type: "boolean" },
        failures_only: { type: "boolean" },
        since: { type: "number", description: "Unix timestamp" },
        before: { type: "number", description: "Unix timestamp" },
        tags: { type: "array", items: { type: "string" } },
        depth: {
          type: "string",
          enum: ["summary", "outcome", "reasoning", "full", "complete"],
          description: "How much detail to return. summary=~20 tokens, complete=~500 tokens",
        },
        limit: { type: "number", description: "Max memories to return" },
        include_links: { type: "boolean" },
      },
      required: ["depth"],
    },
  },
  {
    name: "trace",
    description: "Trace causal chains between memories. Find what caused a memory or what it led to.",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string", description: "Starting memory ID" },
        direction: {
          type: "string",
          enum: ["causes", "effects", "both"],
          description: "Which direction to trace",
        },
        max_depth: { type: "number", description: "Max hops to traverse" },
        depth: {
          type: "string",
          enum: ["summary", "outcome", "reasoning"],
          description: "Detail level for returned memories",
        },
      },
      required: ["memory_id", "direction", "depth"],
    },
  },
  {
    name: "list",
    description: "List your own memories. For self-review of recent work.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        since: { type: "number", description: "Unix timestamp" },
        limit: { type: "number" },
        sort: {
          type: "string",
          enum: ["recent", "importance", "access_count"],
        },
      },
    },
  },
  {
    name: "link",
    description: "Create a relationship between two memories.",
    inputSchema: {
      type: "object",
      properties: {
        source_id: { type: "string" },
        target_id: { type: "string" },
        link_type: {
          type: "string",
          enum: ["caused_by", "led_to", "related_to", "supersedes", "blocked_by"],
        },
      },
      required: ["source_id", "target_id", "link_type"],
    },
  },
  {
    name: "check_file",
    description:
      "Check for memories about a file BEFORE starting work. Returns past experiences: what was tried, what failed, what worked. Helps avoid repeating mistakes and builds on previous knowledge.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the file" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "create_chapter",
    description:
      "Create a chapter that groups related memories. Provide memory_ids to create manually, or set auto_detect to true to cluster recent memories by topic.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        memory_ids: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        topics: { type: "array", items: { type: "string" } },
        auto_detect: { type: "boolean" },
        since: { type: "number", description: "Unix timestamp" },
        before: { type: "number", description: "Unix timestamp" },
        min_memories: { type: "number" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "list_chapters",
    description: "List chapters for this project.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "number", description: "Unix timestamp" },
        before: { type: "number", description: "Unix timestamp" },
        tags: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
        sort: { type: "string", enum: ["recent", "start"] },
      },
    },
  },
  {
    name: "synthesize",
    description:
      "Synthesize chapters into project-level wisdom. Provide chapter_ids or a time window to aggregate.",
    inputSchema: {
      type: "object",
      properties: {
        chapter_ids: { type: "array", items: { type: "string" } },
        since: { type: "number", description: "Unix timestamp" },
        before: { type: "number", description: "Unix timestamp" },
        min_chapters: { type: "number" },
        tags: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "recall_wisdom",
    description: "Recall synthesized wisdom entries.",
    inputSchema: {
      type: "object",
      properties: {
        wisdom_id: { type: "string" },
        since: { type: "number", description: "Unix timestamp" },
        before: { type: "number", description: "Unix timestamp" },
        tags: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "delete_memory",
    description: "Delete a memory and related links/files/chapters.",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string" },
      },
      required: ["memory_id"],
    },
  },
  {
    name: "delete_chapter",
    description: "Delete a chapter and related chapter/wisdom relationships.",
    inputSchema: {
      type: "object",
      properties: {
        chapter_id: { type: "string" },
      },
      required: ["chapter_id"],
    },
  },
  {
    name: "delete_wisdom",
    description: "Delete a wisdom entry and its chapter references.",
    inputSchema: {
      type: "object",
      properties: {
        wisdom_id: { type: "string" },
      },
      required: ["wisdom_id"],
    },
  },
  {
    name: "reset_all",
    description:
      "Delete all data in this project database. Requires confirmation: confirmation=\"RESET_ALL\".",
    inputSchema: {
      type: "object",
      properties: {
        confirmation: { type: "string" },
      },
      required: ["confirmation"],
    },
  },
];

// ============================================================================
// Request Handlers
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "identity": {
        const params = RumIdentityParamsSchema.parse(args);
        const result = identityService.handleIdentity(params);

        // Sync identity to memory service
        if (identityService.agentId && identityService.sessionId) {
          memoryService.setCurrentAgent(
            identityService.agentId,
            identityService.sessionId
          );
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "store": {
        const params = RumStoreParamsSchema.parse(args);
        const result = await memoryService.store(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "update_memory": {
        const params = RumUpdateMemoryParamsSchema.parse(args);
        const result = await memoryService.updateMemory(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "recall": {
        const params = RumRecallParamsSchema.parse(args);
        const result = await memoryService.recall(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "trace": {
        const params = RumTraceParamsSchema.parse(args);
        const result = memoryService.trace(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "list": {
        const params = RumListParamsSchema.parse(args);
        const result = memoryService.list(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "link": {
        const params = RumLinkParamsSchema.parse(args);
        const result = memoryService.link(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "check_file": {
        const filePath = (args as { file_path: string }).file_path;
        const notification = triggerService.checkFileTouch(filePath);

        if (notification) {
          return {
            content: [
              {
                type: "text",
                text: `${notification.message}\n\n${notification.memories
                  .map(
                    (m) =>
                      `• ${m.agent_id} (${m.age_description}): ${m.intent_goal} — ${m.outcome_success ? "success" : "FAILED"}`
                  )
                  .join("\n")}\n\n→ ${notification.recall_hint}`,
              },
            ],
          };
        }

        return {
          content: [{ type: "text", text: "No relevant memories found for this file." }],
        };
      }

      case "create_chapter": {
        const params = RumCreateChapterParamsSchema.parse(args);
        const result = chapterService.createChapter(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "list_chapters": {
        const params = RumListChaptersParamsSchema.parse(args);
        const result = chapterService.listChapters(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "synthesize": {
        const params = RumSynthesizeParamsSchema.parse(args);
        const result = synthesisService.synthesize(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "recall_wisdom": {
        const params = RumRecallWisdomParamsSchema.parse(args);
        const result = synthesisService.recallWisdom(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "delete_memory": {
        const params = RumDeleteMemoryParamsSchema.parse(args);
        const result = memoryService.deleteMemory(params.memory_id);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "delete_chapter": {
        const params = RumDeleteChapterParamsSchema.parse(args);
        const result = chapterService.deleteChapter(params.chapter_id);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "delete_wisdom": {
        const params = RumDeleteWisdomParamsSchema.parse(args);
        const result = synthesisService.deleteWisdom(params.wisdom_id);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "reset_all": {
        RumResetAllParamsSchema.parse(args);
        db.reset();
        const result = { reset: true };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ============================================================================
// Start Server
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`RUM server started for project: ${projectId}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// Cleanup on exit
process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  db.close();
  process.exit(0);
});
