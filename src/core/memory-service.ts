import { v4 as uuidv4 } from "uuid";
import { RumDatabase } from "../storage/database.js";
import {
  EmbeddingService,
  createEmbeddingText,
  type EmbeddingConfig,
} from "./embedding-service.js";
import type {
  RumStoreParams,
  RumStoreResult,
  RumUpdateMemoryParams,
  RumRecallParams,
  RumRecallResult,
  RetrievedMemory,
  RumTraceParams,
  RumTraceResult,
  RumListParams,
  RumListResult,
  RumLinkParams,
  RumLinkResult,
  DepthLevel,
  Action,
  Memory,
  MemoryLinks,
} from "../types.js";

export class MemoryService {
  private db: RumDatabase;
  private embeddings: EmbeddingService;
  private currentAgentId: string | null = null;
  private currentSessionId: string | null = null;

  constructor(db: RumDatabase, embeddingConfig?: Partial<EmbeddingConfig>) {
    this.db = db;
    this.embeddings = new EmbeddingService(embeddingConfig);
  }

  get embeddingsEnabled(): boolean {
    return this.embeddings.isEnabled;
  }

  setCurrentAgent(agentId: string, sessionId: string): void {
    this.currentAgentId = agentId;
    this.currentSessionId = sessionId;
  }

  // ============================================================================
  // Store
  // ============================================================================

  async store(params: RumStoreParams): Promise<RumStoreResult> {
    if (!this.currentAgentId || !this.currentSessionId) {
      throw new Error("No active agent. Call identity first.");
    }

    // Allow writing to another agent's memory if target_agent_id specified
    const targetAgentId = params.target_agent_id || this.currentAgentId;

    const memoryId = `mem_${uuidv4()}`;

    // Generate embedding if service is enabled
    let embedding: number[] | undefined;
    if (this.embeddings.isEnabled) {
      const textForEmbedding = createEmbeddingText({
        intent: params.intent,
        outcome: params.outcome,
        reasoning: params.reasoning,
      });
      const result = await this.embeddings.embed(textForEmbedding);
      if (result) {
        embedding = result.embedding;
      }
    }

    // Store the memory
    this.db.createMemory({
      id: memoryId,
      agentId: targetAgentId,
      sessionId: this.currentSessionId,
      intent: params.intent,
      perception: params.perception,
      reasoning: params.reasoning,
      actions: params.actions,
      outcome: params.outcome,
      tags: params.tags,
      importance: params.importance,
      embedding,
    });

    // Index files from actions
    const indexedFiles: string[] = [];
    if (params.actions) {
      for (const action of params.actions) {
        if (action.file_path) {
          this.db.addMemoryFile(memoryId, action.file_path, action.type);
          indexedFiles.push(action.file_path);
        }
      }
    }

    // Index files from perception
    if (params.perception?.relevant_files) {
      for (const file of params.perception.relevant_files) {
        this.db.addMemoryFile(memoryId, file.path, "relevant");
        if (!indexedFiles.includes(file.path)) {
          indexedFiles.push(file.path);
        }
      }
    }

    // Create links
    if (params.links) {
      if (params.links.caused_by) {
        for (const targetId of params.links.caused_by) {
          this.db.createLink({
            id: `link_${uuidv4()}`,
            sourceId: memoryId,
            targetId,
            linkType: "caused_by",
          });
        }
      }
      if (params.links.related_to) {
        for (const targetId of params.links.related_to) {
          this.db.createLink({
            id: `link_${uuidv4()}`,
            sourceId: memoryId,
            targetId,
            linkType: "related_to",
          });
        }
      }
      if (params.links.supersedes) {
        this.db.createLink({
          id: `link_${uuidv4()}`,
          sourceId: memoryId,
          targetId: params.links.supersedes,
          linkType: "supersedes",
        });
      }
    }

    // Update agent stats
    this.db.incrementAgentMemoryCount(this.currentAgentId, params.outcome.success);
    this.db.incrementSessionMemories(this.currentSessionId);

    return {
      memory_id: memoryId,
      stored_at: Date.now(),
      indexed_files: indexedFiles,
    };
  }

  // ============================================================================
  // Update
  // ============================================================================

  async updateMemory(params: RumUpdateMemoryParams): Promise<Memory> {
    const existing = this.db.getMemory(params.memory_id);
    if (!existing) {
      throw new Error(`Memory not found: ${params.memory_id}`);
    }

    const existingIntent = JSON.parse(existing.intent as string);
    const existingOutcome = JSON.parse(existing.outcome as string);
    const existingPerception = existing.perception
      ? JSON.parse(existing.perception as string)
      : undefined;
    const existingReasoning = existing.reasoning
      ? JSON.parse(existing.reasoning as string)
      : undefined;
    const existingActions = existing.actions
      ? (JSON.parse(existing.actions as string) as Action[])
      : undefined;
    const existingTags = existing.tags
      ? (JSON.parse(existing.tags as string) as string[])
      : undefined;

    const mergedIntent = params.intent
      ? this.deepMerge(existingIntent, params.intent)
      : existingIntent;
    const mergedOutcome = params.outcome
      ? this.deepMerge(existingOutcome, params.outcome)
      : existingOutcome;
    const mergedPerception = params.perception
      ? this.deepMerge(existingPerception ?? {}, params.perception)
      : existingPerception;
    const mergedReasoning = params.reasoning
      ? this.deepMerge(existingReasoning ?? {}, params.reasoning)
      : existingReasoning;
    const mergedActions =
      params.actions !== undefined ? params.actions : existingActions;
    const mergedTags =
      params.tags !== undefined ? params.tags : existingTags;
    const mergedImportance =
      params.importance !== undefined ? params.importance : (existing.importance as number);

    const updates: {
      intent?: typeof mergedIntent;
      perception?: typeof mergedPerception;
      reasoning?: typeof mergedReasoning;
      actions?: typeof mergedActions;
      outcome?: typeof mergedOutcome;
      tags?: typeof mergedTags;
      importance?: number;
      embedding?: number[];
    } = {};

    if (params.intent) updates.intent = mergedIntent;
    if (params.outcome) updates.outcome = mergedOutcome;
    if (params.perception !== undefined) updates.perception = mergedPerception;
    if (params.reasoning !== undefined) updates.reasoning = mergedReasoning;
    if (params.actions !== undefined) updates.actions = mergedActions;
    if (params.tags !== undefined) updates.tags = mergedTags;
    if (params.importance !== undefined) updates.importance = mergedImportance;

    if (
      this.embeddings.isEnabled &&
      (params.intent || params.outcome || params.reasoning)
    ) {
      const previousText = createEmbeddingText({
        intent: existingIntent,
        outcome: existingOutcome,
        reasoning: existingReasoning,
      });
      const updatedText = createEmbeddingText({
        intent: mergedIntent,
        outcome: mergedOutcome,
        reasoning: mergedReasoning,
      });
      if (previousText !== updatedText) {
        const result = await this.embeddings.embed(updatedText);
        if (result) {
          updates.embedding = result.embedding;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      this.db.updateMemory(params.memory_id, updates);
    }

    if (params.actions !== undefined || params.perception !== undefined) {
      const indexedFiles = new Set<string>();
      const files: Array<{ path: string; operation: string }> = [];

      if (mergedActions) {
        for (const action of mergedActions) {
          if (action.file_path) {
            indexedFiles.add(action.file_path);
            files.push({ path: action.file_path, operation: action.type });
          }
        }
      }

      if (mergedPerception?.relevant_files) {
        for (const file of mergedPerception.relevant_files) {
          if (!indexedFiles.has(file.path)) {
            indexedFiles.add(file.path);
            files.push({ path: file.path, operation: "relevant" });
          }
        }
      }

      this.db.replaceMemoryFiles(params.memory_id, files);
    }

    if (params.links) {
      if (params.links.caused_by !== undefined) {
        this.db.deleteMemoryLinksByType(params.memory_id, "caused_by");
        for (const targetId of params.links.caused_by || []) {
          this.db.createLink({
            id: `link_${uuidv4()}`,
            sourceId: params.memory_id,
            targetId,
            linkType: "caused_by",
          });
        }
      }

      if (params.links.related_to !== undefined) {
        this.db.deleteMemoryLinksByType(params.memory_id, "related_to");
        for (const targetId of params.links.related_to || []) {
          this.db.createLink({
            id: `link_${uuidv4()}`,
            sourceId: params.memory_id,
            targetId,
            linkType: "related_to",
          });
        }
      }

      if (params.links.supersedes !== undefined) {
        this.db.deleteMemoryLinksByType(params.memory_id, "supersedes");
        if (params.links.supersedes) {
          this.db.createLink({
            id: `link_${uuidv4()}`,
            sourceId: params.memory_id,
            targetId: params.links.supersedes,
            linkType: "supersedes",
          });
        }
      }

      if (params.links.blocked_by !== undefined) {
        this.db.deleteMemoryLinksByType(params.memory_id, "blocked_by");
        if (params.links.blocked_by) {
          this.db.createLink({
            id: `link_${uuidv4()}`,
            sourceId: params.memory_id,
            targetId: params.links.blocked_by,
            linkType: "blocked_by",
          });
        }
      }
    }

    const updated = this.db.getMemory(params.memory_id);
    if (!updated) {
      throw new Error(`Memory not found after update: ${params.memory_id}`);
    }

    return this.buildMemory(updated);
  }

  // ============================================================================
  // Recall
  // ============================================================================

  async recall(params: RumRecallParams): Promise<RumRecallResult> {
    let memories: Record<string, unknown>[] = [];
    let strategyUsed = "exact";
    let confidence = 0.9;

    // Direct ID lookup
    if (params.memory_id) {
      const memory = this.db.getMemory(params.memory_id);
      if (memory) {
        memories = [memory];
        this.db.updateMemoryAccess(params.memory_id);
      }
      strategyUsed = "direct";
      confidence = 1.0;
    }
    // File-based lookup
    else if (params.file) {
      memories = this.db.getMemoriesByFile(params.file, params.limit || 5);
      strategyUsed = "file";
      confidence = 0.95;
    }
    // Semantic search (when query provided and embeddings enabled)
    else if (params.query && this.embeddings.isEnabled) {
      const semanticResults = await this.semanticSearch(
        params.query,
        params.limit || 5,
        params.success_only,
        params.failures_only
      );
      memories = semanticResults.memories;
      strategyUsed = "semantic";
      confidence = semanticResults.avgSimilarity;
    }
    // Structured query fallback
    else {
      memories = this.db.queryMemories({
        agentId: params.agent_id,
        intentType: params.task_type,
        successOnly: params.success_only,
        failuresOnly: params.failures_only,
        since: params.since,
        before: params.before,
        tags: params.tags,
        limit: params.limit || 5,
      });
      strategyUsed = "query";
    }

    // Update session queries
    if (this.currentSessionId) {
      this.db.incrementSessionQueries(this.currentSessionId);
    }

    // Format results based on depth
    const retrievedMemories = memories.map((m) =>
      this.formatMemory(m, params.depth, params.include_links)
    );

    // Update access counts
    for (const m of memories) {
      this.db.updateMemoryAccess(m.id as string);
    }

    return {
      memories: retrievedMemories,
      query_strategy_used: strategyUsed,
      confidence: memories.length > 0 ? confidence : 0,
      total_matches: memories.length,
      token_estimate: this.estimateTokens(retrievedMemories, params.depth),
    };
  }

  /**
   * Semantic search using embeddings
   */
  private async semanticSearch(
    query: string,
    limit: number,
    successOnly?: boolean,
    failuresOnly?: boolean
  ): Promise<{ memories: Record<string, unknown>[]; avgSimilarity: number }> {
    // Get query embedding
    const queryResult = await this.embeddings.embed(query);
    if (!queryResult) {
      return { memories: [], avgSimilarity: 0 };
    }

    // Get all memories with embeddings
    let candidates = this.db.getMemoriesWithEmbeddings();

    // Apply filters
    if (successOnly) {
      candidates = candidates.filter((c) => c.outcome_success === 1);
    } else if (failuresOnly) {
      candidates = candidates.filter((c) => c.outcome_success === 0);
    }

    // Find similar
    const similar = this.embeddings.findSimilar(
      queryResult.embedding,
      candidates.map((c) => ({ id: c.id, embedding: c.embedding })),
      limit,
      0.4 // Lower threshold for semantic search
    );

    if (similar.length === 0) {
      return { memories: [], avgSimilarity: 0 };
    }

    // Fetch full memories
    const memories: Record<string, unknown>[] = [];
    for (const match of similar) {
      const memory = this.db.getMemory(match.id);
      if (memory) {
        memories.push(memory);
      }
    }

    const avgSimilarity =
      similar.reduce((sum, s) => sum + s.similarity, 0) / similar.length;

    return { memories, avgSimilarity };
  }

  // ============================================================================
  // Trace
  // ============================================================================

  trace(params: RumTraceParams): RumTraceResult {
    const origin = this.db.getMemory(params.memory_id);
    if (!origin) {
      throw new Error(`Memory not found: ${params.memory_id}`);
    }

    const chain: RumTraceResult["chain"] = [];
    const visited = new Set<string>([params.memory_id]);
    const maxDepth = params.max_depth || 3;

    const traverse = (memoryId: string, distance: number, direction: "causes" | "effects") => {
      if (distance > maxDepth) return;

      if (direction === "causes") {
        const links = this.db.getLinksFrom(memoryId).filter((l) => l.link_type === "caused_by");
        for (const link of links) {
          const targetId = link.target_id;
          if (visited.has(targetId)) continue;
          visited.add(targetId);

          const memory = this.db.getMemory(targetId);
          if (memory) {
            chain.push({
              memory: this.formatMemory(memory, params.depth, false),
              relationship: "caused_by",
              distance,
            });
            traverse(targetId, distance + 1, direction);
          }
        }
      } else {
        const links = this.db.getLinksTo(memoryId).filter((l) => l.link_type === "caused_by");
        for (const link of links) {
          const targetId = link.source_id;
          if (visited.has(targetId)) continue;
          visited.add(targetId);

          const memory = this.db.getMemory(targetId);
          if (memory) {
            chain.push({
              memory: this.formatMemory(memory, params.depth, false),
              relationship: "led_to",
              distance,
            });
            traverse(targetId, distance + 1, direction);
          }
        }
      }
    };

    if (params.direction === "causes" || params.direction === "both") {
      traverse(params.memory_id, 1, "causes");
    }
    if (params.direction === "effects" || params.direction === "both") {
      traverse(params.memory_id, 1, "effects");
    }

    return {
      origin: this.formatMemory(origin, params.depth, true),
      chain,
      total_nodes: chain.length + 1,
    };
  }

  // ============================================================================
  // List
  // ============================================================================

  list(params: RumListParams): RumListResult {
    if (!this.currentAgentId) {
      throw new Error("No active agent. Call identity first.");
    }

    const memories = this.db.queryMemories({
      agentId: this.currentAgentId,
      since: params.since,
      limit: params.limit || 20,
      sort: params.sort || "recent",
    });

    return {
      memories: memories.map((m) => ({
        id: m.id as string,
        created_at: m.created_at as number,
        intent_goal: m.intent_goal as string,
        outcome_success: (m.outcome_success as number) === 1,
        outcome_summary: m.outcome_summary as string,
        importance: m.importance as number,
        access_count: m.access_count as number,
      })),
      total: memories.length,
    };
  }

  // ============================================================================
  // Link
  // ============================================================================

  link(params: RumLinkParams): RumLinkResult {
    const linkId = `link_${uuidv4()}`;

    this.db.createLink({
      id: linkId,
      sourceId: params.source_id,
      targetId: params.target_id,
      linkType: params.link_type,
    });

    return {
      created: true,
      link_id: linkId,
    };
  }

  // ============================================================================
  // Delete
  // ============================================================================

  deleteMemory(memoryId: string): { deleted: boolean } {
    return { deleted: this.db.deleteMemory(memoryId) };
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private deepMerge<T>(base: T, updates: Partial<T>): T {
    if (updates === undefined) return base;
    if (Array.isArray(updates)) {
      return updates as unknown as T;
    }
    if (updates && typeof updates === "object") {
      const baseObject =
        base && typeof base === "object" && !Array.isArray(base)
          ? (base as Record<string, unknown>)
          : {};
      const result: Record<string, unknown> = { ...baseObject };
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) continue;
        result[key] = this.deepMerge(baseObject[key], value as never);
      }
      return result as T;
    }
    return updates as T;
  }

  private buildMemory(raw: Record<string, unknown>): Memory {
    const intent = JSON.parse(raw.intent as string);
    const outcome = JSON.parse(raw.outcome as string);
    const perception = raw.perception ? JSON.parse(raw.perception as string) : undefined;
    const reasoning = raw.reasoning ? JSON.parse(raw.reasoning as string) : undefined;
    const actions = raw.actions ? (JSON.parse(raw.actions as string) as Action[]) : undefined;
    const tags = raw.tags ? (JSON.parse(raw.tags as string) as string[]) : undefined;
    const links = this.getFullMemoryLinks(raw.id as string);

    return {
      id: raw.id as string,
      agent_id: raw.agent_id as string,
      project_id: raw.project_id as string,
      session_id: raw.session_id as string,
      created_at: raw.created_at as number,
      intent,
      perception,
      reasoning,
      actions,
      outcome,
      links: Object.keys(links).length > 0 ? links : undefined,
      tags,
      importance: raw.importance as number,
      access_count: raw.access_count as number,
      last_accessed: raw.last_accessed as number | null,
    };
  }

  private getFullMemoryLinks(memoryId: string): MemoryLinks {
    const from = this.db.getLinksFrom(memoryId);
    const to = this.db.getLinksTo(memoryId);

    const links: MemoryLinks = {};

    for (const link of from) {
      if (link.link_type === "caused_by") {
        links.caused_by = links.caused_by || [];
        links.caused_by.push(link.target_id);
      } else if (link.link_type === "related_to") {
        links.related_to = links.related_to || [];
        links.related_to.push(link.target_id);
      } else if (link.link_type === "supersedes") {
        links.supersedes = link.target_id;
      } else if (link.link_type === "blocked_by") {
        links.blocked_by = link.target_id;
      }
    }

    for (const link of to) {
      if (link.link_type === "caused_by") {
        links.led_to = links.led_to || [];
        links.led_to.push(link.source_id);
      }
    }

    return links;
  }

  private formatMemory(
    raw: Record<string, unknown>,
    depth: DepthLevel,
    includeLinks?: boolean
  ): RetrievedMemory {
    const intent = JSON.parse(raw.intent as string);
    const outcome = JSON.parse(raw.outcome as string);

    const base: RetrievedMemory = {
      id: raw.id as string,
      agent_id: raw.agent_id as string,
      created_at: raw.created_at as number,
      confidence: 1.0,
      intent: { goal: intent.goal, task_type: intent.task_type },
      outcome: { success: outcome.success, summary: outcome.summary },
    };

    if (depth === "summary") {
      return base;
    }

    // outcome depth: add learnings
    if (outcome.learnings) {
      base.learnings = outcome.learnings;
    }

    if (depth === "outcome") {
      return base;
    }

    // reasoning depth: add reasoning
    if (raw.reasoning) {
      base.reasoning = JSON.parse(raw.reasoning as string);
    }

    if (depth === "reasoning") {
      return base;
    }

    // full depth: add perception
    if (raw.perception) {
      base.perception = JSON.parse(raw.perception as string);
    }

    if (depth === "full") {
      if (includeLinks) {
        base.links = this.getMemoryLinks(raw.id as string);
      }
      return base;
    }

    // complete depth: add actions
    if (raw.actions) {
      base.actions = JSON.parse(raw.actions as string) as Action[];
    }

    if (includeLinks) {
      base.links = this.getMemoryLinks(raw.id as string);
    }

    return base;
  }

  private getMemoryLinks(memoryId: string) {
    const from = this.db.getLinksFrom(memoryId);
    const to = this.db.getLinksTo(memoryId);

    const links: {
      caused_by?: string[];
      led_to?: string[];
      related_to?: string[];
    } = {};

    for (const link of from) {
      if (link.link_type === "caused_by") {
        links.caused_by = links.caused_by || [];
        links.caused_by.push(link.target_id);
      } else if (link.link_type === "related_to") {
        links.related_to = links.related_to || [];
        links.related_to.push(link.target_id);
      }
    }

    for (const link of to) {
      if (link.link_type === "caused_by") {
        links.led_to = links.led_to || [];
        links.led_to.push(link.source_id);
      }
    }

    return links;
  }

  private estimateTokens(memories: RetrievedMemory[], depth: DepthLevel): number {
    const depthMultiplier: Record<DepthLevel, number> = {
      summary: 20,
      outcome: 50,
      reasoning: 150,
      full: 300,
      complete: 500,
    };

    return memories.length * depthMultiplier[depth];
  }
}
