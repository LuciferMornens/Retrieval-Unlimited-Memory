import { RumDatabase } from "../storage/database.js";
import type { RetrievedMemory, DepthLevel } from "../types.js";

export interface TriggerConfig {
  fileTouchEnabled: boolean;
  fileTouchMinMemories: number;
  fileTouchMaxAgeDays: number;
  fileTouchIncludeFailures: boolean;
  fileTouchCooldownSeconds: number;

  conflictWarningEnabled: boolean;

  rateLimitPerMinute: number;
}

export interface TriggerNotification {
  type: "memory_available" | "conflict_warning";
  message: string;
  memories: TriggerMemorySummary[];
  recall_hint: string;
}

export interface TriggerMemorySummary {
  id: string;
  agent_id: string;
  age_description: string;
  intent_goal: string;
  outcome_success: boolean;
  outcome_summary: string;
}

const DEFAULT_CONFIG: TriggerConfig = {
  fileTouchEnabled: true,
  fileTouchMinMemories: 1,
  fileTouchMaxAgeDays: 30,
  fileTouchIncludeFailures: true,
  fileTouchCooldownSeconds: 300,

  conflictWarningEnabled: true,

  rateLimitPerMinute: 5,
};

export class TriggerService {
  private db: RumDatabase;
  private config: TriggerConfig;
  private cooldowns: Map<string, number> = new Map();
  private notificationCount: Map<number, number> = new Map(); // minute -> count

  constructor(db: RumDatabase, config?: Partial<TriggerConfig>) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============================================================================
  // File Touch Trigger
  // ============================================================================

  checkFileTouch(filePath: string): TriggerNotification | null {
    if (!this.config.fileTouchEnabled) return null;

    // Check cooldown
    const cooldownKey = `file:${filePath}`;
    if (this.isOnCooldown(cooldownKey, this.config.fileTouchCooldownSeconds)) {
      return null;
    }

    // Check rate limit
    if (this.isRateLimited()) {
      return null;
    }

    // Query memories for this file
    const maxAge = Date.now() - this.config.fileTouchMaxAgeDays * 24 * 60 * 60 * 1000;
    let memories = this.db.getMemoriesByFile(filePath, 10);

    // Filter by age
    memories = memories.filter((m) => (m.created_at as number) >= maxAge);

    // Filter failures if needed
    if (!this.config.fileTouchIncludeFailures) {
      memories = memories.filter((m) => (m.outcome_success as number) === 1);
    }

    // Check minimum
    if (memories.length < this.config.fileTouchMinMemories) {
      return null;
    }

    // Set cooldown
    this.setCooldown(cooldownKey);
    this.incrementNotificationCount();

    // Format notification
    const summaries = memories.slice(0, 3).map((m) => this.formatMemorySummary(m));

    const failureCount = memories.filter((m) => (m.outcome_success as number) === 0).length;
    const message = this.formatFileTouchMessage(filePath, memories.length, failureCount);

    return {
      type: "memory_available",
      message,
      memories: summaries,
      recall_hint: `recall({ file: "${filePath}", depth: "reasoning" })`,
    };
  }

  // ============================================================================
  // Conflict Warning Trigger
  // ============================================================================

  checkConflict(
    filePath: string,
    intendedAction: string
  ): TriggerNotification | null {
    if (!this.config.conflictWarningEnabled) return null;

    // Look for failed memories on this file
    const memories = this.db.getMemoriesByFile(filePath, 20);
    const failures = memories.filter((m) => (m.outcome_success as number) === 0);

    if (failures.length === 0) return null;

    // Check if any failure is similar to intended action
    // Simple string matching for now - could use embeddings later
    const relevantFailures = failures.filter((m) => {
      const goal = (m.intent_goal as string).toLowerCase();
      const action = intendedAction.toLowerCase();
      return (
        goal.includes(action) ||
        action.includes(goal) ||
        this.wordOverlap(goal, action) > 0.3
      );
    });

    if (relevantFailures.length === 0) return null;

    const mostRecent = relevantFailures[0];
    const outcome = JSON.parse(mostRecent.outcome as string);

    const message = `⚠️ Warning: Similar action failed before on ${filePath}`;
    const summaries = [this.formatMemorySummary(mostRecent)];

    return {
      type: "conflict_warning",
      message,
      memories: summaries,
      recall_hint: `recall({ memory_id: "${mostRecent.id}", depth: "full" })`,
    };
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private formatMemorySummary(raw: Record<string, unknown>): TriggerMemorySummary {
    const ageMs = Date.now() - (raw.created_at as number);
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    let ageDescription: string;
    if (ageDays === 0) {
      const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
      ageDescription = ageHours <= 1 ? "just now" : `${ageHours}h ago`;
    } else if (ageDays === 1) {
      ageDescription = "yesterday";
    } else if (ageDays < 7) {
      ageDescription = `${ageDays}d ago`;
    } else {
      const ageWeeks = Math.floor(ageDays / 7);
      ageDescription = `${ageWeeks}w ago`;
    }

    return {
      id: raw.id as string,
      agent_id: raw.agent_id as string,
      age_description: ageDescription,
      intent_goal: raw.intent_goal as string,
      outcome_success: (raw.outcome_success as number) === 1,
      outcome_summary: raw.outcome_summary as string,
    };
  }

  private formatFileTouchMessage(
    filePath: string,
    totalCount: number,
    failureCount: number
  ): string {
    const fileName = filePath.split("/").pop() || filePath;
    let msg = `[RUM] ${fileName} has ${totalCount} memor${totalCount === 1 ? "y" : "ies"}`;
    if (failureCount > 0) {
      msg += ` (${failureCount} failed)`;
    }
    return msg;
  }

  private wordOverlap(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 3));
    const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 3));

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let overlap = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) overlap++;
    }

    return overlap / Math.max(wordsA.size, wordsB.size);
  }

  private isOnCooldown(key: string, cooldownSeconds: number): boolean {
    const lastTrigger = this.cooldowns.get(key);
    if (!lastTrigger) return false;
    return Date.now() - lastTrigger < cooldownSeconds * 1000;
  }

  private setCooldown(key: string): void {
    this.cooldowns.set(key, Date.now());
  }

  private isRateLimited(): boolean {
    const minute = Math.floor(Date.now() / 60000);
    const count = this.notificationCount.get(minute) || 0;
    return count >= this.config.rateLimitPerMinute;
  }

  private incrementNotificationCount(): void {
    const minute = Math.floor(Date.now() / 60000);
    const count = this.notificationCount.get(minute) || 0;
    this.notificationCount.set(minute, count + 1);

    // Clean old entries
    for (const [m] of this.notificationCount) {
      if (m < minute - 1) {
        this.notificationCount.delete(m);
      }
    }
  }
}
