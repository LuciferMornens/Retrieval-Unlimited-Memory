import { v4 as uuidv4 } from "uuid";
import { RumDatabase } from "../storage/database.js";
import type {
  RumCreateChapterParams,
  RumCreateChapterResult,
  RumListChaptersParams,
  RumListChaptersResult,
  ChapterSummary,
} from "../types.js";

export class ChapterService {
  private db: RumDatabase;

  constructor(db: RumDatabase) {
    this.db = db;
  }

  createChapter(params: RumCreateChapterParams): RumCreateChapterResult {
    if (params.auto_detect) {
      return this.autoDetectChapters(params);
    }

    if (!params.memory_ids || params.memory_ids.length === 0) {
      throw new Error("memory_ids required unless auto_detect is true");
    }

    const memories = params.memory_ids
      .map((id) => this.db.getMemory(id))
      .filter((m): m is Record<string, unknown> => Boolean(m));

    if (memories.length === 0) {
      throw new Error("No valid memories found for chapter creation");
    }

    const chapter = this.createChapterFromMemories({
      title: params.title,
      memories,
      tags: params.tags,
      topics: params.topics,
      origin: "manual",
    });

    return {
      chapters: [chapter],
      total_created: 1,
    };
  }

  listChapters(params: RumListChaptersParams): RumListChaptersResult {
    const rows = this.db.listChapters(params);
    const chapters = rows.map((row) => this.formatChapter(row));

    return {
      chapters,
      total: chapters.length,
    };
  }

  deleteChapter(chapterId: string): { deleted: boolean } {
    return { deleted: this.db.deleteChapter(chapterId) };
  }

  private autoDetectChapters(params: RumCreateChapterParams): RumCreateChapterResult {
    const memories = this.db.queryMemories({
      since: params.since,
      before: params.before,
      limit: params.limit || 200,
      sort: "recent",
    });

    const tagMap = new Map<string, Record<string, unknown>[]>();
    for (const memory of memories) {
      const tags = this.parseJsonArray(memory.tags as string | null | undefined);
      if (tags.length === 0) {
        const taskType = memory.intent_type as string | undefined;
        if (taskType) {
          const key = `task:${taskType}`;
          const existing = tagMap.get(key) || [];
          existing.push(memory);
          tagMap.set(key, existing);
        }
        continue;
      }

      for (const tag of tags) {
        const existing = tagMap.get(tag) || [];
        existing.push(memory);
        tagMap.set(tag, existing);
      }
    }

    const minMemories = params.min_memories || 3;
    const created: ChapterSummary[] = [];

    for (const [tag, grouped] of tagMap.entries()) {
      if (grouped.length < minMemories) continue;
      const chapter = this.createChapterFromMemories({
        title: `Topic: ${tag}`,
        memories: grouped,
        tags: params.tags ? Array.from(new Set([...params.tags, tag])) : [tag],
        topics: params.topics ? Array.from(new Set([...params.topics, tag])) : [tag],
        origin: "auto",
      });
      created.push(chapter);
    }

    return {
      chapters: created,
      total_created: created.length,
    };
  }

  private createChapterFromMemories(params: {
    title?: string;
    memories: Record<string, unknown>[];
    tags?: string[];
    topics?: string[];
    origin: "manual" | "auto";
  }): ChapterSummary {
    const memoryTimestamps = params.memories.map((m) => m.created_at as number);
    const startTs = Math.min(...memoryTimestamps);
    const endTs = Math.max(...memoryTimestamps);

    const { summary, learnings, derivedTags, derivedTopics } = this.summarizeMemories(
      params.memories
    );

    const tags = this.mergeStrings(params.tags, derivedTags);
    const topics = this.mergeStrings(params.topics, derivedTopics);

    const chapterId = `chapter_${uuidv4()}`;
    this.db.createChapter({
      id: chapterId,
      title: params.title,
      summary,
      learnings,
      startTs,
      endTs,
      tags,
      topics,
      origin: params.origin,
    });

    params.memories
      .sort((a, b) => (a.created_at as number) - (b.created_at as number))
      .forEach((memory, index) => {
        this.db.addChapterMemory({
          chapterId,
          memoryId: memory.id as string,
          position: index,
        });
      });

    const now = Date.now();
    return {
      id: chapterId,
      title: params.title,
      summary,
      learnings,
      start_ts: startTs,
      end_ts: endTs,
      tags,
      topics,
      origin: params.origin,
      created_at: now,
      updated_at: now,
      memory_count: params.memories.length,
    };
  }

  private summarizeMemories(memories: Record<string, unknown>[]): {
    summary: string;
    learnings: string[];
    derivedTags: string[];
    derivedTopics: string[];
  } {
    const goals: string[] = [];
    const outcomes: string[] = [];
    const learnings: string[] = [];
    const tagCounts = new Map<string, number>();

    for (const memory of memories) {
      if (memory.intent) {
        const intent = JSON.parse(memory.intent as string) as { goal?: string };
        if (intent.goal) goals.push(intent.goal);
      }

      if (memory.outcome) {
        const outcome = JSON.parse(memory.outcome as string) as {
          summary?: string;
          learnings?: string[];
        };
        if (outcome.summary) outcomes.push(outcome.summary);
        if (outcome.learnings) {
          for (const learning of outcome.learnings) learnings.push(learning);
        }
      }

      const tags = this.parseJsonArray(memory.tags as string | null | undefined);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    const topGoals = goals.slice(0, 3);
    const topOutcomes = outcomes.slice(0, 3);
    const summaryParts: string[] = [];

    if (topGoals.length > 0) {
      summaryParts.push(`Goals: ${topGoals.join("; ")}`);
    }
    if (topOutcomes.length > 0) {
      summaryParts.push(`Outcomes: ${topOutcomes.join("; ")}`);
    }

    const summary = summaryParts.length > 0
      ? summaryParts.join(". ")
      : "Chapter synthesized from related memories.";

    const uniqueLearnings = Array.from(new Set(learnings));

    const sortedTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);

    return {
      summary,
      learnings: uniqueLearnings,
      derivedTags: sortedTags,
      derivedTopics: sortedTags.slice(0, 5),
    };
  }

  private parseJsonArray(raw?: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private mergeStrings(primary?: string[], fallback?: string[]): string[] | undefined {
    const combined = new Set<string>();
    for (const value of primary || []) combined.add(value);
    for (const value of fallback || []) combined.add(value);
    const result = Array.from(combined);
    return result.length > 0 ? result : undefined;
  }

  private formatChapter(row: Record<string, unknown>): ChapterSummary {
    return {
      id: row.id as string,
      title: (row.title as string) || undefined,
      summary: row.summary as string,
      learnings: this.parseJsonArray(row.learnings as string | null | undefined),
      start_ts: row.start_ts as number,
      end_ts: row.end_ts as number,
      tags: this.parseJsonArray(row.tags as string | null | undefined),
      topics: this.parseJsonArray(row.topics as string | null | undefined),
      origin: row.origin as "manual" | "auto",
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
      memory_count: row.memory_count as number,
    };
  }
}
