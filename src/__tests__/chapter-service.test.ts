import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RumDatabase } from "../storage/database.js";
import { ChapterService } from "../core/chapter-service.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const createMemory = (
  db: RumDatabase,
  params: {
    id: string;
    goal: string;
    task_type: "bug_fix" | "feature_add" | "refactor";
    summary: string;
    tags?: string[];
    learnings?: string[];
  }
) => {
  db.createMemory({
    id: params.id,
    agentId: "agent_1",
    sessionId: "session_1",
    intent: { goal: params.goal, task_type: params.task_type },
    outcome: { success: true, summary: params.summary, learnings: params.learnings },
    tags: params.tags,
  });
};

describe("ChapterService", () => {
  let db: RumDatabase;
  let tempDir: string;
  let service: ChapterService;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "rum-test-"));
    db = new RumDatabase({ projectId: "test-project", dataDir: tempDir });
    db.createAgent({ id: "agent_1", type: "main" });
    service = new ChapterService(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a manual chapter from memories", () => {
    createMemory(db, {
      id: "mem_1",
      goal: "Fix cache bug",
      task_type: "bug_fix",
      summary: "Cache bug fixed",
      tags: ["cache"],
      learnings: ["Avoid stale cache"],
    });
    createMemory(db, {
      id: "mem_2",
      goal: "Improve caching",
      task_type: "refactor",
      summary: "Refactored cache",
      tags: ["cache"],
      learnings: ["Prefer explicit invalidation"],
    });

    const result = service.createChapter({
      title: "Cache work",
      memory_ids: ["mem_1", "mem_2"],
      tags: ["performance"],
    });

    expect(result.total_created).toBe(1);
    expect(result.chapters[0].summary).toContain("Fix cache bug");
    expect(result.chapters[0].memory_count).toBe(2);
    expect(result.chapters[0].tags).toEqual(expect.arrayContaining(["performance", "cache"]));
  });

  it("auto-detects chapters by tag", () => {
    createMemory(db, {
      id: "mem_a",
      goal: "Add auth",
      task_type: "feature_add",
      summary: "Added auth",
      tags: ["auth"],
    });
    createMemory(db, {
      id: "mem_b",
      goal: "Refine auth",
      task_type: "refactor",
      summary: "Refined auth",
      tags: ["auth"],
    });
    createMemory(db, {
      id: "mem_c",
      goal: "Tune auth",
      task_type: "refactor",
      summary: "Tuned auth",
      tags: ["auth"],
    });
    createMemory(db, {
      id: "mem_d",
      goal: "Fix logging",
      task_type: "bug_fix",
      summary: "Logging fixed",
      tags: ["logging"],
    });

    const result = service.createChapter({
      auto_detect: true,
      min_memories: 2,
    });

    expect(result.total_created).toBe(1);
    expect(result.chapters[0].origin).toBe("auto");
    expect(result.chapters[0].topics).toEqual(expect.arrayContaining(["auth"]));
  });

  it("lists chapters with counts", () => {
    createMemory(db, {
      id: "mem_x",
      goal: "Add feature",
      task_type: "feature_add",
      summary: "Feature added",
    });
    createMemory(db, {
      id: "mem_y",
      goal: "Refactor feature",
      task_type: "refactor",
      summary: "Refactor done",
    });

    service.createChapter({
      memory_ids: ["mem_x", "mem_y"],
    });

    const result = service.listChapters({});
    expect(result.total).toBe(1);
    expect(result.chapters[0].memory_count).toBe(2);
  });

  it("deletes a chapter and related rows", () => {
    createMemory(db, {
      id: "mem_del",
      goal: "Delete chapter",
      task_type: "refactor",
      summary: "Cleanup",
    });

    const chapter = service.createChapter({
      memory_ids: ["mem_del"],
      tags: ["cleanup"],
    }).chapters[0];

    db.createWisdom({
      id: "wisdom_keep",
      summary: "Keep wisdom",
      startTs: 1,
      endTs: 2,
      tags: ["cleanup"],
    });
    db.addWisdomChapter({ wisdomId: "wisdom_keep", chapterId: chapter.id });

    const result = service.deleteChapter(chapter.id);
    expect(result.deleted).toBe(true);
    expect(db.getChapter(chapter.id)).toBeNull();

    const chapterMemories = db.database
      .prepare("SELECT * FROM chapter_memories WHERE chapter_id = ?")
      .all(chapter.id);
    expect(chapterMemories).toHaveLength(0);

    const wisdomChapters = db.database
      .prepare("SELECT * FROM wisdom_chapters WHERE chapter_id = ?")
      .all(chapter.id);
    expect(wisdomChapters).toHaveLength(0);
    expect(db.getWisdom("wisdom_keep")).not.toBeNull();
  });
});
