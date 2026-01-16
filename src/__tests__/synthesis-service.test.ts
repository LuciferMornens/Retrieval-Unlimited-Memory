import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RumDatabase } from "../storage/database.js";
import { ChapterService } from "../core/chapter-service.js";
import { SynthesisService } from "../core/synthesis-service.js";
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

describe("SynthesisService", () => {
  let db: RumDatabase;
  let tempDir: string;
  let chapterService: ChapterService;
  let synthesisService: SynthesisService;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "rum-test-"));
    db = new RumDatabase({ projectId: "test-project", dataDir: tempDir });
    db.createAgent({ id: "agent_1", type: "main" });
    chapterService = new ChapterService(db);
    synthesisService = new SynthesisService(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("synthesizes wisdom from chapters", () => {
    createMemory(db, {
      id: "mem_1",
      goal: "Improve caching",
      task_type: "refactor",
      summary: "Cache improved",
      tags: ["cache"],
      learnings: ["Should cache results"],
    });
    createMemory(db, {
      id: "mem_2",
      goal: "Add cache metrics",
      task_type: "feature_add",
      summary: "Metrics added",
      tags: ["cache"],
      learnings: ["Prefer explicit invalidation"],
    });

    const chapterA = chapterService.createChapter({
      title: "Cache basics",
      memory_ids: ["mem_1"],
      tags: ["shared"],
    }).chapters[0];

    createMemory(db, {
      id: "mem_3",
      goal: "Refine caching",
      task_type: "refactor",
      summary: "Cache refined",
      tags: ["cache"],
      learnings: ["Should cache results"],
    });
    createMemory(db, {
      id: "mem_4",
      goal: "Fix cache eviction",
      task_type: "bug_fix",
      summary: "Eviction fixed",
      tags: ["cache"],
      learnings: ["Avoid stale cache"],
    });

    const chapterB = chapterService.createChapter({
      title: "Cache pitfalls",
      memory_ids: ["mem_3", "mem_4"],
      tags: ["shared"],
    }).chapters[0];

    const result = synthesisService.synthesize({
      chapter_ids: [chapterA.id, chapterB.id],
      min_chapters: 2,
    });

    expect(result.wisdom.summary).toContain("Synthesis across 2 chapters");
    expect(result.wisdom.patterns).toEqual(expect.arrayContaining(["shared"]));
    expect(result.wisdom.best_practices).toEqual(
      expect.arrayContaining(["Should cache results"])
    );
  });

  it("recalls wisdom by id and list", () => {
    createMemory(db, {
      id: "mem_5",
      goal: "Add logging",
      task_type: "feature_add",
      summary: "Logging added",
      tags: ["logging"],
      learnings: ["Do not log secrets"],
    });
    createMemory(db, {
      id: "mem_6",
      goal: "Refine logging",
      task_type: "refactor",
      summary: "Logging refined",
      tags: ["logging"],
      learnings: ["Prefer structured logs"],
    });

    const chapter = chapterService.createChapter({
      memory_ids: ["mem_5", "mem_6"],
      tags: ["logging"],
    }).chapters[0];

    const wisdom = synthesisService.synthesize({
      chapter_ids: [chapter.id],
      min_chapters: 1,
    }).wisdom;

    const recallById = synthesisService.recallWisdom({ wisdom_id: wisdom.id });
    expect(recallById.total).toBe(1);
    expect(recallById.wisdom[0].id).toBe(wisdom.id);

    const recallList = synthesisService.recallWisdom({ tags: ["logging"] });
    expect(recallList.total).toBe(1);
  });

  it("deletes wisdom and removes chapter links", () => {
    createMemory(db, {
      id: "mem_del_wisdom",
      goal: "Create wisdom",
      task_type: "feature_add",
      summary: "Added",
      tags: ["cleanup"],
    });

    const chapter = chapterService.createChapter({
      memory_ids: ["mem_del_wisdom"],
      tags: ["cleanup"],
    }).chapters[0];

    const wisdom = synthesisService.synthesize({
      chapter_ids: [chapter.id],
      min_chapters: 1,
    }).wisdom;

    const result = synthesisService.deleteWisdom(wisdom.id);
    expect(result.deleted).toBe(true);
    expect(db.getWisdom(wisdom.id)).toBeNull();

    const wisdomChapters = db.database
      .prepare("SELECT * FROM wisdom_chapters WHERE wisdom_id = ?")
      .all(wisdom.id);
    expect(wisdomChapters).toHaveLength(0);
    expect(db.getChapter(chapter.id)).not.toBeNull();
  });
});
