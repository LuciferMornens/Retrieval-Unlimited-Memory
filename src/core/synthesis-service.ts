import { v4 as uuidv4 } from "uuid";
import { RumDatabase } from "../storage/database.js";
import type {
  RumSynthesizeParams,
  RumSynthesizeResult,
  RumRecallWisdomParams,
  RumRecallWisdomResult,
  WisdomSummary,
} from "../types.js";

export class SynthesisService {
  private db: RumDatabase;

  constructor(db: RumDatabase) {
    this.db = db;
  }

  synthesize(params: RumSynthesizeParams): RumSynthesizeResult {
    const chapters = params.chapter_ids && params.chapter_ids.length > 0
      ? this.db.getChaptersByIds(params.chapter_ids)
      : this.db.listChapters({
          since: params.since,
          before: params.before,
          tags: params.tags,
          limit: 50,
          sort: "recent",
        });

    if (chapters.length === 0) {
      throw new Error("No chapters available for synthesis");
    }

    const minChapters = params.min_chapters || 2;
    if (chapters.length < minChapters) {
      throw new Error(`Need at least ${minChapters} chapters to synthesize`);
    }

    const summaries: string[] = [];
    const learnings: string[] = [];
    const tagCounts = new Map<string, number>();
    let startTs = Number.POSITIVE_INFINITY;
    let endTs = 0;

    for (const chapter of chapters) {
      summaries.push(chapter.summary as string);
      startTs = Math.min(startTs, chapter.start_ts as number);
      endTs = Math.max(endTs, chapter.end_ts as number);

      const chapterLearnings = this.parseJsonArray(chapter.learnings as string | null | undefined);
      learnings.push(...chapterLearnings);

      const tags = this.parseJsonArray(chapter.tags as string | null | undefined);
      const topics = this.parseJsonArray(chapter.topics as string | null | undefined);
      for (const tag of [...tags, ...topics]) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    const insights = Array.from(new Set(learnings));
    const patterns = Array.from(tagCounts.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);

    const bestPractices = insights.filter((learning) =>
      /(should|avoid|prefer|best|never|do not)/i.test(learning)
    );

    const summary = this.composeSummary(chapters.length, summaries);

    const wisdomId = `wisdom_${uuidv4()}`;
    this.db.createWisdom({
      id: wisdomId,
      summary,
      insights,
      patterns,
      bestPractices,
      tags: patterns,
      startTs,
      endTs,
    });

    for (const chapter of chapters) {
      this.db.addWisdomChapter({
        wisdomId,
        chapterId: chapter.id as string,
      });
    }

    const now = Date.now();
    return {
      wisdom: {
        id: wisdomId,
        summary,
        insights,
        patterns,
        best_practices: bestPractices,
        tags: patterns,
        start_ts: startTs,
        end_ts: endTs,
        created_at: now,
        updated_at: now,
      },
    };
  }

  recallWisdom(params: RumRecallWisdomParams): RumRecallWisdomResult {
    if (params.wisdom_id) {
      const row = this.db.getWisdom(params.wisdom_id);
      if (!row) {
        throw new Error(`Wisdom not found: ${params.wisdom_id}`);
      }
      return {
        wisdom: [this.formatWisdom(row)],
        total: 1,
      };
    }

    const rows = this.db.listWisdom({
      since: params.since,
      before: params.before,
      tags: params.tags,
      limit: params.limit || 20,
    });

    return {
      wisdom: rows.map((row) => this.formatWisdom(row)),
      total: rows.length,
    };
  }

  deleteWisdom(wisdomId: string): { deleted: boolean } {
    return { deleted: this.db.deleteWisdom(wisdomId) };
  }

  private formatWisdom(row: Record<string, unknown>): WisdomSummary {
    return {
      id: row.id as string,
      summary: row.summary as string,
      insights: this.parseJsonArray(row.insights as string | null | undefined),
      patterns: this.parseJsonArray(row.patterns as string | null | undefined),
      best_practices: this.parseJsonArray(row.best_practices as string | null | undefined),
      tags: this.parseJsonArray(row.tags as string | null | undefined),
      start_ts: row.start_ts as number,
      end_ts: row.end_ts as number,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    };
  }

  private composeSummary(totalChapters: number, summaries: string[]): string {
    const topSummaries = summaries.filter(Boolean).slice(0, 3);
    if (topSummaries.length === 0) {
      return `Synthesis across ${totalChapters} chapters.`;
    }
    return `Synthesis across ${totalChapters} chapters: ${topSummaries.join(" | ")}`;
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
}
