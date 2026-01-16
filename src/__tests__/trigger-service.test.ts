import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TriggerService } from "../core/trigger-service.js";
import { RumDatabase } from "../storage/database.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("TriggerService", () => {
  let db: RumDatabase;
  let triggerService: TriggerService;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "rum-trigger-test-"));
    db = new RumDatabase({ projectId: "test-project", dataDir: tempDir });
    triggerService = new TriggerService(db, {
      fileTouchCooldownSeconds: 0,
      rateLimitPerMinute: 100,
    });

    db.createAgent({ id: "agent_test", type: "main" });
    db.createSession({ id: "session_test", agentId: "agent_test" });
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createMemory(
    id: string,
    filePath: string,
    success: boolean,
    createdAt?: number
  ) {
    db.createMemory({
      id,
      agentId: "agent_test",
      sessionId: "session_test",
      intent: { goal: `Task for ${filePath}`, task_type: "other" },
      outcome: { success, summary: success ? "Succeeded" : "Failed" },
    });

    if (createdAt) {
      db.database
        .prepare("UPDATE memories SET created_at = ? WHERE id = ?")
        .run(createdAt, id);
    }

    db.addMemoryFile(id, filePath, "file_edit");
  }

  describe("checkFileTouch", () => {
    it("should return null when disabled", () => {
      const service = new TriggerService(db, { fileTouchEnabled: false });
      createMemory("mem_1", "/src/test.ts", true);

      const result = service.checkFileTouch("/src/test.ts");
      expect(result).toBeNull();
    });

    it("should return null when no memories for file", () => {
      const result = triggerService.checkFileTouch("/src/nonexistent.ts");
      expect(result).toBeNull();
    });

    it("should return notification when memories exist", () => {
      createMemory("mem_1", "/src/auth.ts", true);
      createMemory("mem_2", "/src/auth.ts", false);

      const result = triggerService.checkFileTouch("/src/auth.ts");

      expect(result).not.toBeNull();
      expect(result?.type).toBe("memory_available");
      expect(result?.message).toContain("auth.ts");
      expect(result?.message).toContain("2 memories");
      expect(result?.message).toContain("1 failed");
      expect(result?.memories.length).toBeGreaterThan(0);
      expect(result?.recall_hint).toContain("recall");
    });

    it("should filter old memories", () => {
      const oldDate = Date.now() - 60 * 24 * 60 * 60 * 1000;
      createMemory("mem_old", "/src/old.ts", true, oldDate);

      const result = triggerService.checkFileTouch("/src/old.ts");
      expect(result).toBeNull();
    });

    it("should include recent memories within max age", () => {
      const recentDate = Date.now() - 5 * 24 * 60 * 60 * 1000;
      createMemory("mem_recent", "/src/recent.ts", true, recentDate);

      const result = triggerService.checkFileTouch("/src/recent.ts");
      expect(result).not.toBeNull();
    });

    it("should filter failures when configured", () => {
      const service = new TriggerService(db, {
        fileTouchIncludeFailures: false,
        fileTouchCooldownSeconds: 0,
        rateLimitPerMinute: 100,
      });

      createMemory("mem_fail", "/src/fail.ts", false);

      const result = service.checkFileTouch("/src/fail.ts");
      expect(result).toBeNull();
    });

    it("should respect minimum memories threshold", () => {
      const service = new TriggerService(db, {
        fileTouchMinMemories: 3,
        fileTouchCooldownSeconds: 0,
        rateLimitPerMinute: 100,
      });

      createMemory("mem_1", "/src/few.ts", true);
      createMemory("mem_2", "/src/few.ts", true);

      const result = service.checkFileTouch("/src/few.ts");
      expect(result).toBeNull();
    });

    it("should limit memory summaries to 3", () => {
      for (let i = 0; i < 5; i++) {
        createMemory(`mem_${i}`, "/src/many.ts", true);
      }

      const result = triggerService.checkFileTouch("/src/many.ts");
      expect(result?.memories).toHaveLength(3);
    });

    describe("Memory Summary Format", () => {
      it("should include all required fields", () => {
        createMemory("mem_format", "/src/format.ts", true);

        const result = triggerService.checkFileTouch("/src/format.ts");
        const summary = result?.memories[0];

        expect(summary?.id).toBe("mem_format");
        expect(summary?.agent_id).toBe("agent_test");
        expect(summary?.age_description).toBeDefined();
        expect(summary?.intent_goal).toContain("format.ts");
        expect(typeof summary?.outcome_success).toBe("boolean");
        expect(summary?.outcome_summary).toBeDefined();
      });

      it("should format age correctly for recent memories", () => {
        createMemory("mem_now", "/src/now.ts", true);

        const result = triggerService.checkFileTouch("/src/now.ts");
        const age = result?.memories[0].age_description;

        expect(age).toMatch(/just now|(\d+)h ago/);
      });

      it("should format age for yesterday", () => {
        const yesterday = Date.now() - 25 * 60 * 60 * 1000;
        createMemory("mem_yesterday", "/src/yesterday.ts", true, yesterday);

        const result = triggerService.checkFileTouch("/src/yesterday.ts");
        expect(result?.memories[0].age_description).toBe("yesterday");
      });

      it("should format age for days ago", () => {
        const threeDays = Date.now() - 3 * 24 * 60 * 60 * 1000;
        createMemory("mem_days", "/src/days.ts", true, threeDays);

        const result = triggerService.checkFileTouch("/src/days.ts");
        expect(result?.memories[0].age_description).toBe("3d ago");
      });

      it("should format age for weeks ago", () => {
        const twoWeeks = Date.now() - 14 * 24 * 60 * 60 * 1000;
        createMemory("mem_weeks", "/src/weeks.ts", true, twoWeeks);

        const result = triggerService.checkFileTouch("/src/weeks.ts");
        expect(result?.memories[0].age_description).toBe("2w ago");
      });
    });

    describe("Cooldown", () => {
      it("should respect cooldown period", () => {
        const service = new TriggerService(db, {
          fileTouchCooldownSeconds: 300,
          rateLimitPerMinute: 100,
        });

        createMemory("mem_cool", "/src/cooldown.ts", true);

        const first = service.checkFileTouch("/src/cooldown.ts");
        expect(first).not.toBeNull();

        const second = service.checkFileTouch("/src/cooldown.ts");
        expect(second).toBeNull();
      });

      it("should allow different files independently", () => {
        const service = new TriggerService(db, {
          fileTouchCooldownSeconds: 300,
          rateLimitPerMinute: 100,
        });

        createMemory("mem_a", "/src/a.ts", true);
        createMemory("mem_b", "/src/b.ts", true);

        const resultA = service.checkFileTouch("/src/a.ts");
        expect(resultA).not.toBeNull();

        const resultB = service.checkFileTouch("/src/b.ts");
        expect(resultB).not.toBeNull();
      });
    });

    describe("Rate Limiting", () => {
      it("should respect rate limit", () => {
        const service = new TriggerService(db, {
          fileTouchCooldownSeconds: 0,
          rateLimitPerMinute: 2,
        });

        createMemory("mem_r1", "/src/r1.ts", true);
        createMemory("mem_r2", "/src/r2.ts", true);
        createMemory("mem_r3", "/src/r3.ts", true);

        expect(service.checkFileTouch("/src/r1.ts")).not.toBeNull();
        expect(service.checkFileTouch("/src/r2.ts")).not.toBeNull();
        expect(service.checkFileTouch("/src/r3.ts")).toBeNull();
      });
    });
  });

  describe("checkConflict", () => {
    it("should return null when disabled", () => {
      const service = new TriggerService(db, {
        conflictWarningEnabled: false,
      });

      createMemory("mem_fail", "/src/conflict.ts", false);

      const result = service.checkConflict("/src/conflict.ts", "fix bug");
      expect(result).toBeNull();
    });

    it("should return null when no failures exist", () => {
      createMemory("mem_success", "/src/clean.ts", true);

      const result = triggerService.checkConflict("/src/clean.ts", "edit file");
      expect(result).toBeNull();
    });

    it("should warn about relevant past failures", () => {
      db.createMemory({
        id: "mem_past_fail",
        agentId: "agent_test",
        sessionId: "session_test",
        intent: { goal: "Fix authentication bug", task_type: "bug_fix" },
        outcome: { success: false, summary: "Type error occurred" },
      });
      db.addMemoryFile("mem_past_fail", "/src/auth.ts", "file_edit");

      const result = triggerService.checkConflict(
        "/src/auth.ts",
        "fix authentication"
      );

      expect(result).not.toBeNull();
      expect(result?.type).toBe("conflict_warning");
      expect(result?.message).toContain("Warning");
      expect(result?.message).toContain("auth.ts");
      expect(result?.recall_hint).toContain("mem_past_fail");
    });

    it("should not warn for unrelated failures", () => {
      db.createMemory({
        id: "mem_unrelated",
        agentId: "agent_test",
        sessionId: "session_test",
        intent: { goal: "Update database schema", task_type: "other" },
        outcome: { success: false, summary: "Migration failed" },
      });
      db.addMemoryFile("mem_unrelated", "/src/db.ts", "file_edit");

      const result = triggerService.checkConflict(
        "/src/db.ts",
        "add authentication"
      );

      expect(result).toBeNull();
    });

    it("should match by word overlap", () => {
      db.createMemory({
        id: "mem_overlap",
        agentId: "agent_test",
        sessionId: "session_test",
        intent: { goal: "Refactor user authentication module", task_type: "refactor" },
        outcome: { success: false, summary: "Tests broke" },
      });
      db.addMemoryFile("mem_overlap", "/src/user.ts", "file_edit");

      const result = triggerService.checkConflict(
        "/src/user.ts",
        "refactor authentication"
      );

      expect(result).not.toBeNull();
    });
  });

  describe("Message Formatting", () => {
    it("should format singular memory correctly", () => {
      createMemory("mem_single", "/src/single.ts", true);

      const result = triggerService.checkFileTouch("/src/single.ts");
      expect(result?.message).toContain("1 memory");
    });

    it("should format plural memories correctly", () => {
      createMemory("mem_p1", "/src/plural.ts", true);
      createMemory("mem_p2", "/src/plural.ts", true);

      const result = triggerService.checkFileTouch("/src/plural.ts");
      expect(result?.message).toContain("2 memories");
    });

    it("should show failure count when present", () => {
      createMemory("mem_f1", "/src/mixed.ts", true);
      createMemory("mem_f2", "/src/mixed.ts", false);
      createMemory("mem_f3", "/src/mixed.ts", false);

      const result = triggerService.checkFileTouch("/src/mixed.ts");
      expect(result?.message).toContain("2 failed");
    });

    it("should not show failure count when all succeeded", () => {
      createMemory("mem_s1", "/src/success.ts", true);
      createMemory("mem_s2", "/src/success.ts", true);

      const result = triggerService.checkFileTouch("/src/success.ts");
      expect(result?.message).not.toContain("failed");
    });

    it("should extract filename from path", () => {
      createMemory("mem_deep", "/very/deep/nested/path/component.tsx", true);

      const result = triggerService.checkFileTouch(
        "/very/deep/nested/path/component.tsx"
      );
      expect(result?.message).toContain("component.tsx");
      expect(result?.message).not.toContain("/very/deep");
    });
  });
});
