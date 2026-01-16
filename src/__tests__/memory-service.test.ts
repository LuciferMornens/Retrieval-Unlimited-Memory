import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryService } from "../core/memory-service.js";
import { RumDatabase } from "../storage/database.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../core/embedding-service.js", async () => {
  const actual = await vi.importActual("../core/embedding-service.js");
  return {
    ...actual,
    EmbeddingService: class MockEmbeddingService {
      isEnabled = false;
      async embed() {
        return null;
      }
      cosineSimilarity(a: number[], b: number[]) {
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
          dot += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
      }
      findSimilar() {
        return [];
      }
    },
  };
});

describe("MemoryService", () => {
  let db: RumDatabase;
  let memoryService: MemoryService;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "rum-memory-test-"));
    db = new RumDatabase({ projectId: "test-project", dataDir: tempDir });
    memoryService = new MemoryService(db);

    db.createAgent({ id: "agent_test", type: "main" });
    db.createSession({ id: "session_test", agentId: "agent_test" });
    memoryService.setCurrentAgent("agent_test", "session_test");
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Store", () => {
    it("should store a basic memory", async () => {
      const result = await memoryService.store({
        intent: { goal: "Fix bug", task_type: "bug_fix" },
        outcome: { success: true, summary: "Bug fixed" },
      });

      expect(result.memory_id).toMatch(/^mem_/);
      expect(result.stored_at).toBeDefined();
      expect(result.indexed_files).toEqual([]);

      const memory = db.getMemory(result.memory_id);
      expect(memory).not.toBeNull();
    });

    it("should store memory with all 5 layers", async () => {
      const result = await memoryService.store({
        intent: {
          goal: "Add authentication",
          task_type: "feature_add",
          context: "REST API",
          constraints: ["Must use JWT"],
        },
        perception: {
          observations: [
            { what: "No auth exists", where: "api.ts", significance: "high" },
          ],
          relevant_files: [{ path: "/src/api.ts", relevance: "main file" }],
          patterns_noticed: ["No middleware"],
          anomalies: ["Missing types"],
        },
        reasoning: {
          approach_chosen: "JWT with middleware",
          why_chosen: "Industry standard",
          alternatives_considered: [
            { approach: "Session", why_rejected: "Not stateless" },
          ],
          assumptions: ["Node.js backend"],
          risks_identified: ["Token expiry handling"],
        },
        actions: [
          {
            type: "file_edit",
            file_path: "/src/auth.ts",
            lines_affected: "1-50",
            diff_summary: "Added JWT middleware",
          },
          {
            type: "file_create",
            file_path: "/src/middleware/auth.ts",
          },
        ],
        outcome: {
          success: true,
          summary: "Authentication added",
          learnings: ["JWT is straightforward"],
          verified_by: { type: "test", result: "All tests pass" },
        },
        tags: ["auth", "api"],
        importance: 0.9,
      });

      const memory = db.getMemory(result.memory_id);
      expect(memory).not.toBeNull();
      expect(JSON.parse(memory?.perception as string)).toBeDefined();
      expect(JSON.parse(memory?.reasoning as string)).toBeDefined();
      expect(JSON.parse(memory?.actions as string)).toHaveLength(2);
      expect(result.indexed_files).toContain("/src/auth.ts");
      expect(result.indexed_files).toContain("/src/middleware/auth.ts");
      expect(result.indexed_files).toContain("/src/api.ts");
    });

    it("should index files from perception relevant_files", async () => {
      const result = await memoryService.store({
        intent: { goal: "Review code", task_type: "investigation" },
        perception: {
          relevant_files: [
            { path: "/src/a.ts", relevance: "main" },
            { path: "/src/b.ts", relevance: "helper" },
          ],
        },
        outcome: { success: true, summary: "Reviewed" },
      });

      expect(result.indexed_files).toContain("/src/a.ts");
      expect(result.indexed_files).toContain("/src/b.ts");
    });

    it("should create links on store", async () => {
      const first = await memoryService.store({
        intent: { goal: "Task 1", task_type: "other" },
        outcome: { success: true, summary: "Done 1" },
      });

      const second = await memoryService.store({
        intent: { goal: "Task 2", task_type: "other" },
        outcome: { success: true, summary: "Done 2" },
        links: {
          caused_by: [first.memory_id],
          related_to: [first.memory_id],
        },
      });

      const linksFrom = db.getLinksFrom(second.memory_id);
      expect(linksFrom).toHaveLength(2);
    });

    it("should throw when no active agent", async () => {
      const service = new MemoryService(db);
      await expect(
        service.store({
          intent: { goal: "Test", task_type: "other" },
          outcome: { success: true, summary: "Done" },
        })
      ).rejects.toThrow("No active agent");
    });

    it("should increment agent and session counters", async () => {
      await memoryService.store({
        intent: { goal: "Task", task_type: "other" },
        outcome: { success: true, summary: "Done" },
      });

      const agent = db.getAgent("agent_test");
      expect(agent?.memory_count).toBe(1);
      expect(agent?.success_count).toBe(1);

      const stmt = db.database.prepare("SELECT * FROM sessions WHERE id = ?");
      const session = stmt.get("session_test") as Record<string, unknown>;
      expect(session.memories_created).toBe(1);
    });
  });

  describe("Update", () => {
    it("should patch memory and preserve fields", async () => {
      const stored = await memoryService.store({
        intent: { goal: "Original", task_type: "feature_add", context: "Old context" },
        reasoning: { approach_chosen: "Initial", why_chosen: "Baseline" },
        actions: [{ type: "file_edit", file_path: "/src/old.ts" }],
        outcome: { success: true, summary: "Done" },
        tags: ["alpha"],
      });

      const updated = await memoryService.updateMemory({
        memory_id: stored.memory_id,
        intent: { context: "New context" },
        reasoning: { why_chosen: "Updated rationale" },
        actions: [{ type: "file_edit", file_path: "/src/new.ts" }],
        tags: ["beta"],
      });

      expect(updated.intent.goal).toBe("Original");
      expect(updated.intent.context).toBe("New context");
      expect(updated.reasoning?.approach_chosen).toBe("Initial");
      expect(updated.reasoning?.why_chosen).toBe("Updated rationale");
      expect(updated.actions).toHaveLength(1);
      expect(updated.actions?.[0].file_path).toBe("/src/new.ts");
      expect(updated.tags).toEqual(["beta"]);
      expect(db.getMemoriesByFile("/src/old.ts")).toHaveLength(0);
      expect(db.getMemoriesByFile("/src/new.ts")).toHaveLength(1);
    });

    it("should update embedding when semantic fields change", async () => {
      const stored = await memoryService.store({
        intent: { goal: "Initial task", task_type: "other" },
        outcome: { success: true, summary: "Initial outcome" },
      });

      const embeddings = (memoryService as unknown as {
        embeddings: { isEnabled: boolean; embed: (text: string) => Promise<{ embedding: number[] }> };
      }).embeddings;
      embeddings.isEnabled = true;
      const embedMock = vi.fn().mockResolvedValue({
        embedding: [0.9, 0.8],
        model: "mock",
        dimensions: 2,
      });
      embeddings.embed = embedMock;

      await memoryService.updateMemory({
        memory_id: stored.memory_id,
        intent: { goal: "Updated task" },
      });

      expect(embedMock).toHaveBeenCalled();
      const memories = db.getMemoriesWithEmbeddings();
      expect(memories).toHaveLength(1);
      expect(memories[0].embedding[0]).toBeCloseTo(0.9, 5);
    });

    it("should replace link sets when provided", async () => {
      const first = await memoryService.store({
        intent: { goal: "Task 1", task_type: "other" },
        outcome: { success: true, summary: "Done 1" },
      });
      const second = await memoryService.store({
        intent: { goal: "Task 2", task_type: "other" },
        outcome: { success: true, summary: "Done 2" },
      });

      await memoryService.updateMemory({
        memory_id: second.memory_id,
        links: { caused_by: [first.memory_id] },
      });
      expect(db.getLinksFrom(second.memory_id).filter((l) => l.link_type === "caused_by")).toHaveLength(1);

      await memoryService.updateMemory({
        memory_id: second.memory_id,
        links: { caused_by: [] },
      });
      expect(db.getLinksFrom(second.memory_id).filter((l) => l.link_type === "caused_by")).toHaveLength(0);
    });
  });

  describe("Recall", () => {
    beforeEach(async () => {
      await memoryService.store({
        intent: { goal: "Fix login bug", task_type: "bug_fix" },
        outcome: { success: true, summary: "Login fixed" },
        actions: [{ type: "file_edit", file_path: "/src/auth/login.ts" }],
        tags: ["auth", "urgent"],
      });
      await memoryService.store({
        intent: { goal: "Add signup", task_type: "feature_add" },
        outcome: { success: false, summary: "Failed validation" },
        actions: [{ type: "file_create", file_path: "/src/auth/signup.ts" }],
      });
      await memoryService.store({
        intent: { goal: "Refactor utils", task_type: "refactor" },
        outcome: { success: true, summary: "Utils cleaned up" },
        actions: [{ type: "file_edit", file_path: "/src/utils.ts" }],
        perception: { observations: [{ what: "test", where: "here", significance: "low" }] },
        reasoning: { approach_chosen: "Extract functions", why_chosen: "Cleaner" },
      });
    });

    it("should recall by memory_id", async () => {
      const stored = await memoryService.store({
        intent: { goal: "Test recall", task_type: "test_write" },
        outcome: { success: true, summary: "Test works" },
      });

      const result = await memoryService.recall({
        memory_id: stored.memory_id,
        depth: "summary",
      });

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].id).toBe(stored.memory_id);
      expect(result.query_strategy_used).toBe("direct");
      expect(result.confidence).toBe(1.0);
    });

    it("should recall by file", async () => {
      const result = await memoryService.recall({
        file: "login.ts",
        depth: "summary",
      });

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].intent.goal).toBe("Fix login bug");
      expect(result.query_strategy_used).toBe("file");
    });

    it("should recall by task_type", async () => {
      const result = await memoryService.recall({
        task_type: "bug_fix",
        depth: "summary",
      });

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].intent.task_type).toBe("bug_fix");
    });

    it("should filter by success_only", async () => {
      const result = await memoryService.recall({
        success_only: true,
        depth: "summary",
        limit: 10,
      });

      expect(result.memories.length).toBeGreaterThan(0);
      result.memories.forEach((m) => {
        expect(m.outcome.success).toBe(true);
      });
    });

    it("should filter by failures_only", async () => {
      const result = await memoryService.recall({
        failures_only: true,
        depth: "summary",
      });

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].outcome.success).toBe(false);
    });

    describe("Depth Levels", () => {
      it("should return summary depth", async () => {
        const result = await memoryService.recall({
          task_type: "refactor",
          depth: "summary",
        });

        const mem = result.memories[0];
        expect(mem.intent.goal).toBeDefined();
        expect(mem.outcome.summary).toBeDefined();
        expect(mem.reasoning).toBeUndefined();
        expect(mem.perception).toBeUndefined();
        expect(mem.actions).toBeUndefined();
      });

      it("should return outcome depth with learnings", async () => {
        await memoryService.store({
          intent: { goal: "Learn task", task_type: "other" },
          outcome: {
            success: true,
            summary: "Learned",
            learnings: ["Important lesson"],
          },
        });

        const result = await memoryService.recall({
          task_type: "other",
          depth: "outcome",
          limit: 1,
        });

        const mem = result.memories[0];
        expect(mem.learnings).toContain("Important lesson");
        expect(mem.reasoning).toBeUndefined();
      });

      it("should return reasoning depth", async () => {
        const result = await memoryService.recall({
          task_type: "refactor",
          depth: "reasoning",
        });

        const mem = result.memories[0];
        expect(mem.reasoning).toBeDefined();
        expect(mem.reasoning?.approach_chosen).toBe("Extract functions");
        expect(mem.perception).toBeUndefined();
      });

      it("should return full depth with perception", async () => {
        const result = await memoryService.recall({
          task_type: "refactor",
          depth: "full",
        });

        const mem = result.memories[0];
        expect(mem.reasoning).toBeDefined();
        expect(mem.perception).toBeDefined();
        expect(mem.actions).toBeUndefined();
      });

      it("should return complete depth with actions", async () => {
        const result = await memoryService.recall({
          task_type: "refactor",
          depth: "complete",
        });

        const mem = result.memories[0];
        expect(mem.reasoning).toBeDefined();
        expect(mem.perception).toBeDefined();
        expect(mem.actions).toBeDefined();
      });
    });

    it("should include links when requested", async () => {
      const first = await memoryService.store({
        intent: { goal: "First", task_type: "other" },
        outcome: { success: true, summary: "Done" },
      });
      const second = await memoryService.store({
        intent: { goal: "Second", task_type: "other" },
        outcome: { success: true, summary: "Done" },
        links: { caused_by: [first.memory_id] },
      });

      const result = await memoryService.recall({
        memory_id: second.memory_id,
        depth: "full",
        include_links: true,
      });

      expect(result.memories[0].links).toBeDefined();
      expect(result.memories[0].links?.caused_by).toContain(first.memory_id);
    });

    it("should estimate tokens based on depth", async () => {
      const summaryResult = await memoryService.recall({
        task_type: "refactor",
        depth: "summary",
      });
      const completeResult = await memoryService.recall({
        task_type: "refactor",
        depth: "complete",
      });

      expect(completeResult.token_estimate).toBeGreaterThan(
        summaryResult.token_estimate
      );
    });

    it("should update access count on recall", async () => {
      const stored = await memoryService.store({
        intent: { goal: "Access test", task_type: "other" },
        outcome: { success: true, summary: "Done" },
      });

      const before = db.getMemory(stored.memory_id);
      const initialCount = before?.access_count as number;

      await memoryService.recall({
        memory_id: stored.memory_id,
        depth: "summary",
      });

      const memory = db.getMemory(stored.memory_id);
      expect(memory?.access_count).toBeGreaterThan(initialCount);
    });

    it("should return empty results for no matches", async () => {
      const result = await memoryService.recall({
        task_type: "security_fix",
        depth: "summary",
      });

      expect(result.memories).toHaveLength(0);
      expect(result.total_matches).toBe(0);
      expect(result.confidence).toBe(0);
    });
  });

  describe("Trace", () => {
    let mem1: string, mem2: string, mem3: string;

    beforeEach(async () => {
      const r1 = await memoryService.store({
        intent: { goal: "Root cause", task_type: "investigation" },
        outcome: { success: true, summary: "Found root cause" },
      });
      mem1 = r1.memory_id;

      const r2 = await memoryService.store({
        intent: { goal: "First fix", task_type: "bug_fix" },
        outcome: { success: true, summary: "Fixed first issue" },
        links: { caused_by: [mem1] },
      });
      mem2 = r2.memory_id;

      const r3 = await memoryService.store({
        intent: { goal: "Second fix", task_type: "bug_fix" },
        outcome: { success: true, summary: "Fixed second issue" },
        links: { caused_by: [mem2] },
      });
      mem3 = r3.memory_id;
    });

    it("should trace causes (backward)", () => {
      const result = memoryService.trace({
        memory_id: mem3,
        direction: "causes",
        depth: "summary",
      });

      expect(result.origin.id).toBe(mem3);
      expect(result.chain.length).toBeGreaterThan(0);
      expect(result.chain[0].relationship).toBe("caused_by");
    });

    it("should trace effects (forward)", () => {
      const result = memoryService.trace({
        memory_id: mem1,
        direction: "effects",
        depth: "summary",
      });

      expect(result.origin.id).toBe(mem1);
      expect(result.chain.length).toBeGreaterThan(0);
      expect(result.chain[0].relationship).toBe("led_to");
    });

    it("should trace both directions", () => {
      const result = memoryService.trace({
        memory_id: mem2,
        direction: "both",
        depth: "summary",
      });

      expect(result.origin.id).toBe(mem2);
      const relationships = result.chain.map((c) => c.relationship);
      expect(relationships).toContain("caused_by");
      expect(relationships).toContain("led_to");
    });

    it("should respect max_depth", () => {
      const result = memoryService.trace({
        memory_id: mem3,
        direction: "causes",
        depth: "summary",
        max_depth: 1,
      });

      result.chain.forEach((c) => {
        expect(c.distance).toBeLessThanOrEqual(1);
      });
    });

    it("should throw for nonexistent memory", () => {
      expect(() =>
        memoryService.trace({
          memory_id: "nonexistent",
          direction: "causes",
          depth: "summary",
        })
      ).toThrow("Memory not found");
    });
  });

  describe("List", () => {
    beforeEach(async () => {
      for (let i = 0; i < 5; i++) {
        await memoryService.store({
          intent: { goal: `Task ${i}`, task_type: "other" },
          outcome: { success: i % 2 === 0, summary: `Done ${i}` },
          importance: i / 10,
        });
      }
    });

    it("should list agent memories", () => {
      const result = memoryService.list({});
      expect(result.memories.length).toBeGreaterThan(0);
      expect(result.total).toBe(result.memories.length);
    });

    it("should respect limit", () => {
      const result = memoryService.list({ limit: 2 });
      expect(result.memories).toHaveLength(2);
    });

    it("should sort by recent by default", () => {
      const result = memoryService.list({});
      for (let i = 1; i < result.memories.length; i++) {
        expect(result.memories[i - 1].created_at).toBeGreaterThanOrEqual(
          result.memories[i].created_at
        );
      }
    });

    it("should sort by importance", () => {
      const result = memoryService.list({ sort: "importance" });
      for (let i = 1; i < result.memories.length; i++) {
        expect(result.memories[i - 1].importance).toBeGreaterThanOrEqual(
          result.memories[i].importance
        );
      }
    });

    it("should throw when no active agent", () => {
      const service = new MemoryService(db);
      expect(() => service.list({})).toThrow("No active agent");
    });

    it("should include memory summary fields", () => {
      const result = memoryService.list({ limit: 1 });
      const mem = result.memories[0];

      expect(mem.id).toBeDefined();
      expect(mem.created_at).toBeDefined();
      expect(mem.intent_goal).toBeDefined();
      expect(typeof mem.outcome_success).toBe("boolean");
      expect(mem.outcome_summary).toBeDefined();
      expect(typeof mem.importance).toBe("number");
      expect(typeof mem.access_count).toBe("number");
    });
  });

  describe("Link", () => {
    it("should create a link between memories", async () => {
      const first = await memoryService.store({
        intent: { goal: "First", task_type: "other" },
        outcome: { success: true, summary: "Done" },
      });
      const second = await memoryService.store({
        intent: { goal: "Second", task_type: "other" },
        outcome: { success: true, summary: "Done" },
      });

      const result = memoryService.link({
        source_id: second.memory_id,
        target_id: first.memory_id,
        link_type: "related_to",
      });

      expect(result.created).toBe(true);
      expect(result.link_id).toMatch(/^link_/);

      const links = db.getLinksFrom(second.memory_id);
      expect(links).toHaveLength(1);
      expect(links[0].link_type).toBe("related_to");
    });

    it("should support all link types", async () => {
      const mem = await memoryService.store({
        intent: { goal: "Base", task_type: "other" },
        outcome: { success: true, summary: "Done" },
      });

      const linkTypes = [
        "caused_by",
        "led_to",
        "related_to",
        "supersedes",
        "blocked_by",
      ] as const;

      for (const linkType of linkTypes) {
        const target = await memoryService.store({
          intent: { goal: `Target for ${linkType}`, task_type: "other" },
          outcome: { success: true, summary: "Done" },
        });

        const result = memoryService.link({
          source_id: mem.memory_id,
          target_id: target.memory_id,
          link_type: linkType,
        });

        expect(result.created).toBe(true);
      }
    });
  });

  describe("Delete", () => {
    it("should delete a memory and related rows", async () => {
      const first = await memoryService.store({
        intent: { goal: "Delete target", task_type: "other" },
        outcome: { success: true, summary: "Stored" },
      });
      const second = await memoryService.store({
        intent: { goal: "Linker", task_type: "other" },
        outcome: { success: true, summary: "Stored" },
      });

      db.addMemoryFile(first.memory_id, "/src/delete.ts", "file_edit");
      db.createLink({
        id: "link_delete",
        sourceId: second.memory_id,
        targetId: first.memory_id,
        linkType: "related_to",
      });
      db.createChapter({
        id: "chapter_delete",
        summary: "Delete chapter",
        startTs: 1,
        endTs: 2,
        origin: "manual",
      });
      db.addChapterMemory({
        chapterId: "chapter_delete",
        memoryId: first.memory_id,
        position: 0,
      });

      const result = memoryService.deleteMemory(first.memory_id);
      expect(result.deleted).toBe(true);
      expect(db.getMemory(first.memory_id)).toBeNull();
      expect(db.getMemory(second.memory_id)).not.toBeNull();

      const files = db.database
        .prepare("SELECT * FROM memory_files WHERE memory_id = ?")
        .all(first.memory_id);
      expect(files).toHaveLength(0);

      const links = db.database
        .prepare("SELECT * FROM memory_links WHERE source_id = ? OR target_id = ?")
        .all(first.memory_id, first.memory_id);
      expect(links).toHaveLength(0);

      const chapterMemories = db.database
        .prepare("SELECT * FROM chapter_memories WHERE memory_id = ?")
        .all(first.memory_id);
      expect(chapterMemories).toHaveLength(0);
    });
  });
});
