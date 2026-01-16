import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RumDatabase } from "../storage/database.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("RumDatabase", () => {
  let db: RumDatabase;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "rum-test-"));
    db = new RumDatabase({ projectId: "test-project", dataDir: tempDir });
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Agent Operations", () => {
    it("should create a main agent", () => {
      db.createAgent({
        id: "agent_123",
        type: "main",
        specialization: "coding",
        capabilities: ["typescript", "testing"],
      });

      const agent = db.getAgent("agent_123");
      expect(agent).not.toBeNull();
      expect(agent?.id).toBe("agent_123");
      expect(agent?.type).toBe("main");
      expect(agent?.specialization).toBe("coding");
      expect(agent?.capabilities).toEqual(["typescript", "testing"]);
      expect(agent?.memory_count).toBe(0);
      expect(agent?.session_count).toBe(1);
    });

    it("should create a subagent with parent", () => {
      db.createAgent({ id: "agent_parent", type: "main" });
      db.createAgent({
        id: "agent_child",
        type: "subagent",
        parentId: "agent_parent",
      });

      const child = db.getAgent("agent_child");
      expect(child?.type).toBe("subagent");
      expect(child?.parent_id).toBe("agent_parent");
    });

    it("should return null for non-existent agent", () => {
      const agent = db.getAgent("nonexistent");
      expect(agent).toBeNull();
    });

    it("should update agent activity", () => {
      db.createAgent({ id: "agent_123", type: "main" });
      const before = db.getAgent("agent_123")!;

      db.updateAgentActivity("agent_123");
      const after = db.getAgent("agent_123")!;

      expect(after.session_count).toBe(before.session_count + 1);
      expect(after.last_active_at).toBeGreaterThanOrEqual(before.last_active_at);
    });

    it("should increment memory count", () => {
      db.createAgent({ id: "agent_123", type: "main" });

      db.incrementAgentMemoryCount("agent_123", true);
      let agent = db.getAgent("agent_123")!;
      expect(agent.memory_count).toBe(1);
      expect(agent.success_count).toBe(1);
      expect(agent.failure_count).toBe(0);

      db.incrementAgentMemoryCount("agent_123", false);
      agent = db.getAgent("agent_123")!;
      expect(agent.memory_count).toBe(2);
      expect(agent.success_count).toBe(1);
      expect(agent.failure_count).toBe(1);
    });

    it("should return the last active main agent", () => {
      db.createAgent({ id: "agent_main_1", type: "main" });
      db.createAgent({ id: "agent_main_2", type: "main" });
      db.createAgent({
        id: "agent_sub_1",
        type: "subagent",
        parentId: "agent_main_1",
      });

      const update = db.database.prepare(`
        UPDATE agents SET last_active_at = ? WHERE id = ?
      `);
      update.run(1000, "agent_main_1");
      update.run(2000, "agent_main_2");
      update.run(3000, "agent_sub_1");

      const lastActive = db.getLastActiveMainAgent();
      expect(lastActive?.id).toBe("agent_main_2");
    });

    it("should return null when no main agents exist", () => {
      const lastActive = db.getLastActiveMainAgent();
      expect(lastActive).toBeNull();
    });
  });

  describe("Memory Operations", () => {
    beforeEach(() => {
      db.createAgent({ id: "agent_123", type: "main" });
    });

    it("should create a memory", () => {
      db.createMemory({
        id: "mem_123",
        agentId: "agent_123",
        sessionId: "session_123",
        intent: { goal: "Fix bug", task_type: "bug_fix" },
        outcome: { success: true, summary: "Bug fixed" },
        tags: ["critical"],
        importance: 0.8,
      });

      const memory = db.getMemory("mem_123");
      expect(memory).not.toBeNull();
      expect(memory?.id).toBe("mem_123");
      expect(memory?.intent_goal).toBe("Fix bug");
      expect(memory?.intent_type).toBe("bug_fix");
      expect(memory?.outcome_success).toBe(1);
      expect(memory?.importance).toBe(0.8);
    });

    it("should create memory with full layers", () => {
      db.createMemory({
        id: "mem_full",
        agentId: "agent_123",
        sessionId: "session_123",
        intent: { goal: "Add feature", task_type: "feature_add", context: "API" },
        perception: { observations: [{ what: "Code", where: "file.ts", significance: "high" }] },
        reasoning: { approach_chosen: "TDD", why_chosen: "Better coverage" },
        actions: [{ type: "file_edit", file_path: "/src/api.ts" }],
        outcome: { success: true, summary: "Feature added", learnings: ["Use TDD"] },
      });

      const memory = db.getMemory("mem_full");
      expect(memory).not.toBeNull();
      expect(JSON.parse(memory?.perception as string)).toBeDefined();
      expect(JSON.parse(memory?.reasoning as string).approach_chosen).toBe("TDD");
      expect(JSON.parse(memory?.actions as string)).toHaveLength(1);
    });

    it("should return null for non-existent memory", () => {
      const memory = db.getMemory("nonexistent");
      expect(memory).toBeNull();
    });

    it("should query memories by agent", () => {
      db.createMemory({
        id: "mem_1",
        agentId: "agent_123",
        sessionId: "session_1",
        intent: { goal: "Task 1", task_type: "bug_fix" },
        outcome: { success: true, summary: "Done 1" },
      });
      db.createMemory({
        id: "mem_2",
        agentId: "agent_123",
        sessionId: "session_1",
        intent: { goal: "Task 2", task_type: "feature_add" },
        outcome: { success: false, summary: "Failed 2" },
      });

      const memories = db.queryMemories({ agentId: "agent_123" });
      expect(memories).toHaveLength(2);
    });

    it("should filter memories by success/failure", () => {
      db.createMemory({
        id: "mem_success",
        agentId: "agent_123",
        sessionId: "session_1",
        intent: { goal: "Success task", task_type: "bug_fix" },
        outcome: { success: true, summary: "Succeeded" },
      });
      db.createMemory({
        id: "mem_fail",
        agentId: "agent_123",
        sessionId: "session_1",
        intent: { goal: "Failed task", task_type: "bug_fix" },
        outcome: { success: false, summary: "Failed" },
      });

      const successes = db.queryMemories({ successOnly: true });
      expect(successes).toHaveLength(1);
      expect(successes[0].outcome_success).toBe(1);

      const failures = db.queryMemories({ failuresOnly: true });
      expect(failures).toHaveLength(1);
      expect(failures[0].outcome_success).toBe(0);
    });

    it("should filter memories by intent type", () => {
      db.createMemory({
        id: "mem_bug",
        agentId: "agent_123",
        sessionId: "session_1",
        intent: { goal: "Fix bug", task_type: "bug_fix" },
        outcome: { success: true, summary: "Fixed" },
      });
      db.createMemory({
        id: "mem_feature",
        agentId: "agent_123",
        sessionId: "session_1",
        intent: { goal: "Add feature", task_type: "feature_add" },
        outcome: { success: true, summary: "Added" },
      });

      const bugFixes = db.queryMemories({ intentType: "bug_fix" });
      expect(bugFixes).toHaveLength(1);
      expect(bugFixes[0].intent_type).toBe("bug_fix");
    });

    it("should update memory access count", () => {
      db.createMemory({
        id: "mem_access",
        agentId: "agent_123",
        sessionId: "session_1",
        intent: { goal: "Task", task_type: "other" },
        outcome: { success: true, summary: "Done" },
      });

      db.updateMemoryAccess("mem_access");
      const memory = db.getMemory("mem_access");
      expect(memory?.access_count).toBe(1);
      expect(memory?.last_accessed).toBeDefined();
    });

    it("should store and retrieve embeddings", () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      db.createMemory({
        id: "mem_embed",
        agentId: "agent_123",
        sessionId: "session_1",
        intent: { goal: "Task with embedding", task_type: "other" },
        outcome: { success: true, summary: "Done" },
        embedding,
      });

      const memories = db.getMemoriesWithEmbeddings();
      expect(memories).toHaveLength(1);
      expect(memories[0].embedding).toHaveLength(5);
      expect(memories[0].embedding[0]).toBeCloseTo(0.1, 5);
    });

    it("should update memory embedding", () => {
      db.createMemory({
        id: "mem_update_embed",
        agentId: "agent_123",
        sessionId: "session_1",
        intent: { goal: "Task", task_type: "other" },
        outcome: { success: true, summary: "Done" },
      });

      db.updateMemoryEmbedding("mem_update_embed", [0.5, 0.6, 0.7]);
      const memories = db.getMemoriesWithEmbeddings();
      expect(memories).toHaveLength(1);
      expect(memories[0].embedding[0]).toBeCloseTo(0.5, 5);
    });

    it("should update memory fields", () => {
      db.createMemory({
        id: "mem_update",
        agentId: "agent_123",
        sessionId: "session_1",
        intent: { goal: "Original goal", task_type: "other" },
        reasoning: { approach_chosen: "Initial", why_chosen: "Default" },
        outcome: { success: true, summary: "Done" },
        tags: ["old"],
        importance: 0.4,
      });

      const updated = db.updateMemory("mem_update", {
        intent: { goal: "Updated goal", task_type: "feature_add" },
        outcome: { success: false, summary: "Regressed" },
        tags: ["new"],
        importance: 0.9,
      });

      expect(updated).toBe(true);
      const memory = db.getMemory("mem_update");
      expect(memory?.intent_goal).toBe("Updated goal");
      expect(memory?.intent_type).toBe("feature_add");
      expect(memory?.outcome_success).toBe(0);
      expect(memory?.outcome_summary).toBe("Regressed");
      expect(JSON.parse(memory?.tags as string)).toEqual(["new"]);
      expect(memory?.importance).toBe(0.9);
      expect(JSON.parse(memory?.reasoning as string).approach_chosen).toBe("Initial");
    });
  });

  describe("Memory Files", () => {
    beforeEach(() => {
      db.createAgent({ id: "agent_123", type: "main" });
      db.createMemory({
        id: "mem_file",
        agentId: "agent_123",
        sessionId: "session_1",
        intent: { goal: "Edit file", task_type: "refactor" },
        outcome: { success: true, summary: "File edited" },
      });
    });

    it("should add memory file association", () => {
      db.addMemoryFile("mem_file", "/src/main.ts", "file_edit");
      const memories = db.getMemoriesByFile("/src/main.ts");
      expect(memories).toHaveLength(1);
      expect(memories[0].id).toBe("mem_file");
    });

    it("should find memories by partial file path", () => {
      db.addMemoryFile("mem_file", "/src/components/Button.tsx", "file_edit");
      const memories = db.getMemoriesByFile("Button");
      expect(memories).toHaveLength(1);
    });

    it("should handle multiple files per memory", () => {
      db.addMemoryFile("mem_file", "/src/a.ts", "file_edit");
      db.addMemoryFile("mem_file", "/src/b.ts", "file_read");

      expect(db.getMemoriesByFile("/src/a.ts")).toHaveLength(1);
      expect(db.getMemoriesByFile("/src/b.ts")).toHaveLength(1);
    });

    it("should ignore duplicate file associations", () => {
      db.addMemoryFile("mem_file", "/src/dup.ts", "file_edit");
      db.addMemoryFile("mem_file", "/src/dup.ts", "file_edit");

      const memories = db.getMemoriesByFile("/src/dup.ts");
      expect(memories).toHaveLength(1);
    });
  });

  describe("Memory Links", () => {
    beforeEach(() => {
      db.createAgent({ id: "agent_123", type: "main" });
      db.createMemory({
        id: "mem_cause",
        agentId: "agent_123",
        sessionId: "session_1",
        intent: { goal: "Root cause", task_type: "investigation" },
        outcome: { success: true, summary: "Found" },
      });
      db.createMemory({
        id: "mem_effect",
        agentId: "agent_123",
        sessionId: "session_1",
        intent: { goal: "Fix effect", task_type: "bug_fix" },
        outcome: { success: true, summary: "Fixed" },
      });
    });

    it("should create a link between memories", () => {
      db.createLink({
        id: "link_1",
        sourceId: "mem_effect",
        targetId: "mem_cause",
        linkType: "caused_by",
      });

      const linksFrom = db.getLinksFrom("mem_effect");
      expect(linksFrom).toHaveLength(1);
      expect(linksFrom[0].target_id).toBe("mem_cause");
      expect(linksFrom[0].link_type).toBe("caused_by");

      const linksTo = db.getLinksTo("mem_cause");
      expect(linksTo).toHaveLength(1);
      expect(linksTo[0].source_id).toBe("mem_effect");
    });

    it("should handle multiple link types", () => {
      db.createLink({
        id: "link_caused",
        sourceId: "mem_effect",
        targetId: "mem_cause",
        linkType: "caused_by",
      });
      db.createLink({
        id: "link_related",
        sourceId: "mem_effect",
        targetId: "mem_cause",
        linkType: "related_to",
      });

      const links = db.getLinksFrom("mem_effect");
      expect(links).toHaveLength(2);
    });

    it("should ignore duplicate links", () => {
      db.createLink({
        id: "link_1",
        sourceId: "mem_effect",
        targetId: "mem_cause",
        linkType: "caused_by",
      });
      db.createLink({
        id: "link_2",
        sourceId: "mem_effect",
        targetId: "mem_cause",
        linkType: "caused_by",
      });

      const links = db.getLinksFrom("mem_effect");
      expect(links).toHaveLength(1);
    });
  });

  describe("Sessions", () => {
    beforeEach(() => {
      db.createAgent({ id: "agent_123", type: "main" });
    });

    it("should create a session", () => {
      db.createSession({
        id: "session_123",
        agentId: "agent_123",
        initialIntent: "Debug issue",
      });

      const stmt = db.database.prepare("SELECT * FROM sessions WHERE id = ?");
      const session = stmt.get("session_123") as Record<string, unknown>;
      expect(session).toBeDefined();
      expect(session.agent_id).toBe("agent_123");
      expect(session.initial_intent).toBe("Debug issue");
    });

    it("should end a session", () => {
      db.createSession({ id: "session_end", agentId: "agent_123" });
      db.endSession("session_end", "Task completed");

      const stmt = db.database.prepare("SELECT * FROM sessions WHERE id = ?");
      const session = stmt.get("session_end") as Record<string, unknown>;
      expect(session.ended_at).toBeDefined();
      expect(session.final_outcome).toBe("Task completed");
    });

    it("should increment session memories count", () => {
      db.createSession({ id: "session_mem", agentId: "agent_123" });
      db.incrementSessionMemories("session_mem");
      db.incrementSessionMemories("session_mem");

      const stmt = db.database.prepare("SELECT * FROM sessions WHERE id = ?");
      const session = stmt.get("session_mem") as Record<string, unknown>;
      expect(session.memories_created).toBe(2);
    });

    it("should increment session queries count", () => {
      db.createSession({ id: "session_query", agentId: "agent_123" });
      db.incrementSessionQueries("session_query");

      const stmt = db.database.prepare("SELECT * FROM sessions WHERE id = ?");
      const session = stmt.get("session_query") as Record<string, unknown>;
      expect(session.queries_made).toBe(1);
    });
  });

  describe("Project Isolation", () => {
    it("should isolate agents by project", () => {
      const db2 = new RumDatabase({ projectId: "other-project", dataDir: tempDir });

      db.createAgent({ id: "agent_project1", type: "main" });
      db2.createAgent({ id: "agent_project2", type: "main" });

      expect(db.getAgent("agent_project1")).not.toBeNull();
      expect(db.getAgent("agent_project2")).toBeNull();
      expect(db2.getAgent("agent_project2")).not.toBeNull();
      expect(db2.getAgent("agent_project1")).toBeNull();

      db2.close();
    });
  });

  describe("Reset", () => {
    it("should delete all data while keeping schema", () => {
      db.createAgent({ id: "agent_reset", type: "main" });
      db.createSession({ id: "session_reset", agentId: "agent_reset" });

      db.createMemory({
        id: "mem_reset_1",
        agentId: "agent_reset",
        sessionId: "session_reset",
        intent: { goal: "Reset", task_type: "other" },
        outcome: { success: true, summary: "Done" },
      });
      db.createMemory({
        id: "mem_reset_2",
        agentId: "agent_reset",
        sessionId: "session_reset",
        intent: { goal: "Reset 2", task_type: "other" },
        outcome: { success: true, summary: "Done" },
      });

      db.addMemoryFile("mem_reset_1", "/src/reset.ts", "file_edit");
      db.createLink({
        id: "link_reset",
        sourceId: "mem_reset_2",
        targetId: "mem_reset_1",
        linkType: "related_to",
      });

      db.createChapter({
        id: "chapter_reset",
        summary: "Reset chapter",
        startTs: 1,
        endTs: 2,
        origin: "manual",
      });
      db.addChapterMemory({
        chapterId: "chapter_reset",
        memoryId: "mem_reset_1",
        position: 0,
      });

      db.createWisdom({
        id: "wisdom_reset",
        summary: "Reset wisdom",
        startTs: 1,
        endTs: 2,
        tags: ["reset"],
      });
      db.addWisdomChapter({ wisdomId: "wisdom_reset", chapterId: "chapter_reset" });

      db.reset();

      const count = (table: string) =>
        (db.database.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as {
          count: number;
        }).count;

      expect(count("agents")).toBe(0);
      expect(count("sessions")).toBe(0);
      expect(count("memories")).toBe(0);
      expect(count("memory_files")).toBe(0);
      expect(count("memory_links")).toBe(0);
      expect(count("chapters")).toBe(0);
      expect(count("chapter_memories")).toBe(0);
      expect(count("wisdom")).toBe(0);
      expect(count("wisdom_chapters")).toBe(0);
    });
  });
});
