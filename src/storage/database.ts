import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

const escapeLikePattern = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

const SCHEMA = `
-- Agent identities
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('main', 'subagent')),
  parent_id TEXT REFERENCES agents(id),
  project_id TEXT NOT NULL,
  
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  session_count INTEGER DEFAULT 1,
  
  memory_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  
  specialization TEXT,
  capabilities JSON,
  metadata JSON
);

-- Core memories
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  
  -- Denormalized for fast queries
  intent_goal TEXT NOT NULL,
  intent_type TEXT NOT NULL,
  outcome_success INTEGER NOT NULL,
  outcome_summary TEXT,
  
  -- Full structured data
  intent JSON NOT NULL,
  perception JSON,
  reasoning JSON,
  actions JSON,
  outcome JSON NOT NULL,
  
  -- Metadata
  tags JSON DEFAULT '[]',
  importance REAL DEFAULT 0.5,
  access_count INTEGER DEFAULT 0,
  last_accessed INTEGER,
  
  -- Embedding for semantic search
  embedding BLOB
);

-- File associations for fast file-based lookup
CREATE TABLE IF NOT EXISTS memory_files (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  operation TEXT NOT NULL,
  PRIMARY KEY (memory_id, file_path)
);

-- Memory relationships (graph edges)
CREATE TABLE IF NOT EXISTS memory_links (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(source_id, target_id, link_type)
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  memories_created INTEGER DEFAULT 0,
  queries_made INTEGER DEFAULT 0,
  initial_intent TEXT,
  final_outcome TEXT
);

-- Chapters
CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  title TEXT,
  summary TEXT NOT NULL,
  learnings JSON,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  tags JSON DEFAULT '[]',
  topics JSON DEFAULT '[]',
  origin TEXT NOT NULL CHECK (origin IN ('manual', 'auto'))
);

CREATE TABLE IF NOT EXISTS chapter_memories (
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  position INTEGER,
  PRIMARY KEY (chapter_id, memory_id)
);

-- Wisdom (synthesized knowledge)
CREATE TABLE IF NOT EXISTS wisdom (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  summary TEXT NOT NULL,
  insights JSON,
  patterns JSON,
  best_practices JSON,
  tags JSON DEFAULT '[]',
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wisdom_chapters (
  wisdom_id TEXT NOT NULL REFERENCES wisdom(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  PRIMARY KEY (wisdom_id, chapter_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id);
CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_id);
CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type);

CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_intent_type ON memories(intent_type);
CREATE INDEX IF NOT EXISTS idx_memories_success ON memories(outcome_success);

CREATE INDEX IF NOT EXISTS idx_memory_files_path ON memory_files(file_path);
CREATE INDEX IF NOT EXISTS idx_memory_files_memory ON memory_files(memory_id);

CREATE INDEX IF NOT EXISTS idx_memory_links_source ON memory_links(source_id);
CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target_id);
CREATE INDEX IF NOT EXISTS idx_memory_links_type ON memory_links(link_type);

CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);

CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id);
CREATE INDEX IF NOT EXISTS idx_chapters_created ON chapters(created_at);
CREATE INDEX IF NOT EXISTS idx_chapter_memories_memory ON chapter_memories(memory_id);

CREATE INDEX IF NOT EXISTS idx_wisdom_project ON wisdom(project_id);
CREATE INDEX IF NOT EXISTS idx_wisdom_created ON wisdom(created_at);
`;

export interface DatabaseConfig {
  projectId: string;
  dataDir?: string;
}

export class RumDatabase {
  private db: Database.Database;
  private projectId: string;

  constructor(config: DatabaseConfig) {
    this.projectId = config.projectId;

    const dataDir = config.dataDir || join(homedir(), ".rum", "projects");
    const projectDir = join(dataDir, config.projectId);

    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }

    const dbPath = join(projectDir, `${config.projectId}.rum.db`);
    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrent access
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    // Initialize schema
    this.db.exec(SCHEMA);
  }

  get database(): Database.Database {
    return this.db;
  }

  get project(): string {
    return this.projectId;
  }

  close(): void {
    this.db.close();
  }

  // ============================================================================
  // Agent Operations
  // ============================================================================

  createAgent(params: {
    id: string;
    type: "main" | "subagent";
    parentId?: string;
    specialization?: string;
    capabilities?: string[];
    metadata?: Record<string, unknown>;
  }): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO agents (
        id, type, parent_id, project_id,
        created_at, last_active_at,
        specialization, capabilities, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.id,
      params.type,
      params.parentId || null,
      this.projectId,
      now,
      now,
      params.specialization || null,
      params.capabilities ? JSON.stringify(params.capabilities) : null,
      params.metadata ? JSON.stringify(params.metadata) : null
    );
  }

  getAgent(agentId: string): {
    id: string;
    type: string;
    parent_id: string | null;
    project_id: string;
    created_at: number;
    last_active_at: number;
    session_count: number;
    memory_count: number;
    success_count: number;
    failure_count: number;
    specialization: string | null;
    capabilities: string[] | null;
  } | null {
    const stmt = this.db.prepare(`
      SELECT * FROM agents WHERE id = ? AND project_id = ?
    `);
    const row = stmt.get(agentId, this.projectId) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      ...row,
      capabilities: row.capabilities
        ? JSON.parse(row.capabilities as string)
        : null,
    } as ReturnType<RumDatabase["getAgent"]>;
  }

  getLastActiveMainAgent(): ReturnType<RumDatabase["getAgent"]> | null {
    const stmt = this.db.prepare(`
      SELECT * FROM agents
      WHERE project_id = ? AND type = 'main'
      ORDER BY last_active_at DESC
      LIMIT 1
    `);
    const row = stmt.get(this.projectId) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      ...row,
      capabilities: row.capabilities
        ? JSON.parse(row.capabilities as string)
        : null,
    } as ReturnType<RumDatabase["getAgent"]>;
  }

  updateAgentActivity(agentId: string): void {
    const stmt = this.db.prepare(`
      UPDATE agents
      SET last_active_at = ?, session_count = session_count + 1
      WHERE id = ? AND project_id = ?
    `);
    stmt.run(Date.now(), agentId, this.projectId);
  }

  incrementAgentMemoryCount(agentId: string, success: boolean): void {
    const stmt = this.db.prepare(`
      UPDATE agents
      SET memory_count = memory_count + 1,
          success_count = success_count + ?,
          failure_count = failure_count + ?
      WHERE id = ? AND project_id = ?
    `);
    stmt.run(success ? 1 : 0, success ? 0 : 1, agentId, this.projectId);
  }

  // ============================================================================
  // Memory Operations
  // ============================================================================

  createMemory(params: {
    id: string;
    agentId: string;
    sessionId: string;
    intent: { goal: string; task_type: string; context?: string; constraints?: string[] };
    perception?: object;
    reasoning?: object;
    actions?: object[];
    outcome: { success: boolean; summary: string; [key: string]: unknown };
    tags?: string[];
    importance?: number;
    embedding?: number[];
  }): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO memories (
        id, agent_id, project_id, session_id, created_at,
        intent_goal, intent_type, outcome_success, outcome_summary,
        intent, perception, reasoning, actions, outcome,
        tags, importance, embedding
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Convert embedding array to buffer for storage
    const embeddingBuffer = params.embedding
      ? Buffer.from(new Float32Array(params.embedding).buffer)
      : null;

    stmt.run(
      params.id,
      params.agentId,
      this.projectId,
      params.sessionId,
      now,
      params.intent.goal,
      params.intent.task_type,
      params.outcome.success ? 1 : 0,
      params.outcome.summary,
      JSON.stringify(params.intent),
      params.perception ? JSON.stringify(params.perception) : null,
      params.reasoning ? JSON.stringify(params.reasoning) : null,
      params.actions ? JSON.stringify(params.actions) : null,
      JSON.stringify(params.outcome),
      JSON.stringify(params.tags || []),
      params.importance || 0.5,
      embeddingBuffer
    );
  }

  updateMemoryEmbedding(memoryId: string, embedding: number[]): void {
    const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);
    const stmt = this.db.prepare(`
      UPDATE memories SET embedding = ? WHERE id = ?
    `);
    stmt.run(embeddingBuffer, memoryId);
  }

  getMemoriesWithEmbeddings(projectId?: string): Array<{
    id: string;
    embedding: number[];
    intent_goal: string;
    outcome_success: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT id, embedding, intent_goal, outcome_success
      FROM memories
      WHERE project_id = ? AND embedding IS NOT NULL
    `);

    const rows = stmt.all(projectId || this.projectId) as Array<{
      id: string;
      embedding: Buffer;
      intent_goal: string;
      outcome_success: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      embedding: Array.from(new Float32Array(row.embedding.buffer)),
      intent_goal: row.intent_goal,
      outcome_success: row.outcome_success,
    }));
  }

  getMemory(memoryId: string): Record<string, unknown> | null {
    const stmt = this.db.prepare(`
      SELECT * FROM memories WHERE id = ? AND project_id = ?
    `);
    return (stmt.get(memoryId, this.projectId) as Record<string, unknown>) || null;
  }

  updateMemory(
    memoryId: string,
    updates: {
      intent?: { goal: string; task_type: string; context?: string; constraints?: string[] };
      perception?: object;
      reasoning?: object;
      actions?: object[];
      outcome?: { success: boolean; summary: string; [key: string]: unknown };
      tags?: string[];
      importance?: number;
      embedding?: number[] | null;
    }
  ): boolean {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.intent) {
      fields.push(
        "intent = ?",
        "intent_goal = ?",
        "intent_type = ?"
      );
      values.push(
        JSON.stringify(updates.intent),
        updates.intent.goal,
        updates.intent.task_type
      );
    }

    if (updates.perception !== undefined) {
      fields.push("perception = ?");
      values.push(updates.perception ? JSON.stringify(updates.perception) : null);
    }

    if (updates.reasoning !== undefined) {
      fields.push("reasoning = ?");
      values.push(updates.reasoning ? JSON.stringify(updates.reasoning) : null);
    }

    if (updates.actions !== undefined) {
      fields.push("actions = ?");
      values.push(updates.actions ? JSON.stringify(updates.actions) : null);
    }

    if (updates.outcome) {
      fields.push(
        "outcome = ?",
        "outcome_success = ?",
        "outcome_summary = ?"
      );
      values.push(
        JSON.stringify(updates.outcome),
        updates.outcome.success ? 1 : 0,
        updates.outcome.summary
      );
    }

    if (updates.tags !== undefined) {
      fields.push("tags = ?");
      values.push(JSON.stringify(updates.tags));
    }

    if (updates.importance !== undefined) {
      fields.push("importance = ?");
      values.push(updates.importance);
    }

    if (updates.embedding !== undefined) {
      fields.push("embedding = ?");
      const embeddingBuffer =
        updates.embedding === null
          ? null
          : Buffer.from(new Float32Array(updates.embedding).buffer);
      values.push(embeddingBuffer);
    }

    if (fields.length === 0) {
      return false;
    }

    const stmt = this.db.prepare(`
      UPDATE memories
      SET ${fields.join(", ")}
      WHERE id = ? AND project_id = ?
    `);
    const result = stmt.run(...values, memoryId, this.projectId);
    return result.changes > 0;
  }

  queryMemories(params: {
    agentId?: string;
    file?: string;
    intentType?: string;
    successOnly?: boolean;
    failuresOnly?: boolean;
    since?: number;
    before?: number;
    tags?: string[];
    limit?: number;
    sort?: "recent" | "importance" | "access_count";
  }): Record<string, unknown>[] {
    const conditions: string[] = ["project_id = ?"];
    const values: unknown[] = [this.projectId];

    if (params.agentId) {
      conditions.push("agent_id = ?");
      values.push(params.agentId);
    }

    if (params.intentType) {
      conditions.push("intent_type = ?");
      values.push(params.intentType);
    }

    if (params.successOnly) {
      conditions.push("outcome_success = 1");
    } else if (params.failuresOnly) {
      conditions.push("outcome_success = 0");
    }

    if (params.since) {
      conditions.push("created_at >= ?");
      values.push(params.since);
    }

    if (params.before) {
      conditions.push("created_at <= ?");
      values.push(params.before);
    }

    let query = `SELECT * FROM memories WHERE ${conditions.join(" AND ")}`;

    // Handle file filter via join
    if (params.file) {
      query = `
        SELECT DISTINCT m.* FROM memories m
        JOIN memory_files mf ON m.id = mf.memory_id
        WHERE ${conditions.join(" AND ")} AND mf.file_path LIKE ? ESCAPE '\\'
      `;
      values.push(`%${escapeLikePattern(params.file)}%`);
    }

    // Sort
    const sortMap = {
      recent: "created_at DESC",
      importance: "importance DESC",
      access_count: "access_count DESC",
    };
    query += ` ORDER BY ${sortMap[params.sort || "recent"]}`;

    // Limit
    query += ` LIMIT ?`;
    values.push(params.limit || 10);

    const stmt = this.db.prepare(query);
    return stmt.all(...values) as Record<string, unknown>[];
  }

  updateMemoryAccess(memoryId: string): void {
    const stmt = this.db.prepare(`
      UPDATE memories
      SET access_count = access_count + 1, last_accessed = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), memoryId);
  }

  // ============================================================================
  // Memory Files
  // ============================================================================

  addMemoryFile(memoryId: string, filePath: string, operation: string): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO memory_files (memory_id, file_path, operation)
      VALUES (?, ?, ?)
    `);
    stmt.run(memoryId, filePath, operation);
  }

  replaceMemoryFiles(
    memoryId: string,
    files: Array<{ path: string; operation: string }>
  ): void {
    const replace = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM memory_files WHERE memory_id = ?`).run(memoryId);
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO memory_files (memory_id, file_path, operation)
        VALUES (?, ?, ?)
      `);
      for (const file of files) {
        stmt.run(memoryId, file.path, file.operation);
      }
    });

    replace();
  }

  getMemoriesByFile(filePath: string, limit = 10): Record<string, unknown>[] {
    const stmt = this.db.prepare(`
      SELECT DISTINCT m.* FROM memories m
      JOIN memory_files mf ON m.id = mf.memory_id
      WHERE mf.file_path LIKE ? ESCAPE '\\' AND m.project_id = ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `);
    return stmt.all(
      `%${escapeLikePattern(filePath)}%`,
      this.projectId,
      limit
    ) as Record<string, unknown>[];
  }

  // ============================================================================
  // Memory Links
  // ============================================================================

  createLink(params: {
    id: string;
    sourceId: string;
    targetId: string;
    linkType: string;
  }): { created: boolean } {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO memory_links (id, source_id, target_id, link_type, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      params.id,
      params.sourceId,
      params.targetId,
      params.linkType,
      Date.now()
    );
    return { created: result.changes > 0 };
  }

  getLinksFrom(memoryId: string): Array<{ target_id: string; link_type: string }> {
    const stmt = this.db.prepare(`
      SELECT target_id, link_type FROM memory_links WHERE source_id = ?
    `);
    return stmt.all(memoryId) as Array<{ target_id: string; link_type: string }>;
  }

  deleteMemoryLinksByType(memoryId: string, linkType: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM memory_links WHERE source_id = ? AND link_type = ?
    `);
    stmt.run(memoryId, linkType);
  }

  getLinksTo(memoryId: string): Array<{ source_id: string; link_type: string }> {
    const stmt = this.db.prepare(`
      SELECT source_id, link_type FROM memory_links WHERE target_id = ?
    `);
    return stmt.all(memoryId) as Array<{ source_id: string; link_type: string }>;
  }

  // ============================================================================
  // Sessions
  // ============================================================================

  createSession(params: {
    id: string;
    agentId: string;
    initialIntent?: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, agent_id, started_at, initial_intent)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(params.id, params.agentId, Date.now(), params.initialIntent || null);
  }

  endSession(sessionId: string, finalOutcome?: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET ended_at = ?, final_outcome = ? WHERE id = ?
    `);
    stmt.run(Date.now(), finalOutcome || null, sessionId);
  }

  incrementSessionMemories(sessionId: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET memories_created = memories_created + 1 WHERE id = ?
    `);
    stmt.run(sessionId);
  }

  incrementSessionQueries(sessionId: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET queries_made = queries_made + 1 WHERE id = ?
    `);
    stmt.run(sessionId);
  }

  // ============================================================================
  // Chapters
  // ============================================================================

  createChapter(params: {
    id: string;
    title?: string;
    summary: string;
    learnings?: string[];
    startTs: number;
    endTs: number;
    tags?: string[];
    topics?: string[];
    origin: "manual" | "auto";
  }): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO chapters (
        id, project_id, created_at, updated_at,
        title, summary, learnings, start_ts, end_ts,
        tags, topics, origin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.id,
      this.projectId,
      now,
      now,
      params.title || null,
      params.summary,
      params.learnings ? JSON.stringify(params.learnings) : null,
      params.startTs,
      params.endTs,
      JSON.stringify(params.tags || []),
      JSON.stringify(params.topics || []),
      params.origin
    );
  }

  addChapterMemory(params: {
    chapterId: string;
    memoryId: string;
    position?: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO chapter_memories (chapter_id, memory_id, position)
      VALUES (?, ?, ?)
    `);
    stmt.run(params.chapterId, params.memoryId, params.position ?? null);
  }

  getChapter(chapterId: string): Record<string, unknown> | null {
    const stmt = this.db.prepare(`
      SELECT c.*, (
        SELECT COUNT(*) FROM chapter_memories cm WHERE cm.chapter_id = c.id
      ) AS memory_count
      FROM chapters c WHERE c.id = ? AND c.project_id = ?
    `);
    return (stmt.get(chapterId, this.projectId) as Record<string, unknown>) || null;
  }

  listChapters(params: {
    since?: number;
    before?: number;
    tags?: string[];
    limit?: number;
    sort?: "recent" | "start";
  }): Record<string, unknown>[] {
    const conditions: string[] = ["c.project_id = ?"];
    const values: unknown[] = [this.projectId];

    if (params.since) {
      conditions.push("c.created_at >= ?");
      values.push(params.since);
    }

    if (params.before) {
      conditions.push("c.created_at <= ?");
      values.push(params.before);
    }

    if (params.tags && params.tags.length > 0) {
      for (const tag of params.tags) {
        conditions.push("c.tags LIKE ?");
        values.push(`%\"${tag}\"%`);
      }
    }

    let query = `
      SELECT c.*, (
        SELECT COUNT(*) FROM chapter_memories cm WHERE cm.chapter_id = c.id
      ) AS memory_count
      FROM chapters c
      WHERE ${conditions.join(" AND ")}
    `;

    const sortMap = {
      recent: "c.created_at DESC",
      start: "c.start_ts DESC",
    };
    query += ` ORDER BY ${sortMap[params.sort || "recent"]}`;
    query += ` LIMIT ?`;
    values.push(params.limit || 20);

    const stmt = this.db.prepare(query);
    return stmt.all(...values) as Record<string, unknown>[];
  }

  getChaptersByIds(chapterIds: string[]): Record<string, unknown>[] {
    if (chapterIds.length === 0) return [];
    const placeholders = chapterIds.map(() => "?").join(", ");
    const stmt = this.db.prepare(`
      SELECT c.*, (
        SELECT COUNT(*) FROM chapter_memories cm WHERE cm.chapter_id = c.id
      ) AS memory_count
      FROM chapters c
      WHERE c.project_id = ? AND c.id IN (${placeholders})
    `);
    return stmt.all(this.projectId, ...chapterIds) as Record<string, unknown>[];
  }

  getChapterMemories(chapterId: string): Record<string, unknown>[] {
    const stmt = this.db.prepare(`
      SELECT m.* FROM memories m
      JOIN chapter_memories cm ON cm.memory_id = m.id
      WHERE cm.chapter_id = ? AND m.project_id = ?
      ORDER BY m.created_at ASC
    `);
    return stmt.all(chapterId, this.projectId) as Record<string, unknown>[];
  }

  // ============================================================================
  // Wisdom
  // ============================================================================

  createWisdom(params: {
    id: string;
    summary: string;
    insights?: string[];
    patterns?: string[];
    bestPractices?: string[];
    tags?: string[];
    startTs: number;
    endTs: number;
  }): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO wisdom (
        id, project_id, created_at, updated_at,
        summary, insights, patterns, best_practices, tags,
        start_ts, end_ts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.id,
      this.projectId,
      now,
      now,
      params.summary,
      params.insights ? JSON.stringify(params.insights) : null,
      params.patterns ? JSON.stringify(params.patterns) : null,
      params.bestPractices ? JSON.stringify(params.bestPractices) : null,
      JSON.stringify(params.tags || []),
      params.startTs,
      params.endTs
    );
  }

  addWisdomChapter(params: { wisdomId: string; chapterId: string }): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO wisdom_chapters (wisdom_id, chapter_id)
      VALUES (?, ?)
    `);
    stmt.run(params.wisdomId, params.chapterId);
  }

  getWisdom(wisdomId: string): Record<string, unknown> | null {
    const stmt = this.db.prepare(`
      SELECT * FROM wisdom WHERE id = ? AND project_id = ?
    `);
    return (stmt.get(wisdomId, this.projectId) as Record<string, unknown>) || null;
  }

  listWisdom(params: {
    since?: number;
    before?: number;
    tags?: string[];
    limit?: number;
  }): Record<string, unknown>[] {
    const conditions: string[] = ["project_id = ?"];
    const values: unknown[] = [this.projectId];

    if (params.since) {
      conditions.push("created_at >= ?");
      values.push(params.since);
    }

    if (params.before) {
      conditions.push("created_at <= ?");
      values.push(params.before);
    }

    if (params.tags && params.tags.length > 0) {
      for (const tag of params.tags) {
        conditions.push("tags LIKE ?");
        values.push(`%\"${tag}\"%`);
      }
    }

    let query = `SELECT * FROM wisdom WHERE ${conditions.join(" AND ")}`;
    query += " ORDER BY created_at DESC";
    query += " LIMIT ?";
    values.push(params.limit || 20);

    const stmt = this.db.prepare(query);
    return stmt.all(...values) as Record<string, unknown>[];
  }

  // ============================================================================
  // Delete / Reset
  // ============================================================================

  deleteMemory(memoryId: string): boolean {
    const remove = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM memory_files WHERE memory_id = ?`).run(memoryId);
      this.db
        .prepare(`DELETE FROM memory_links WHERE source_id = ? OR target_id = ?`)
        .run(memoryId, memoryId);
      this.db.prepare(`DELETE FROM chapter_memories WHERE memory_id = ?`).run(memoryId);
      const result = this.db
        .prepare(`DELETE FROM memories WHERE id = ? AND project_id = ?`)
        .run(memoryId, this.projectId);
      return result.changes > 0;
    });

    return remove();
  }

  deleteChapter(chapterId: string): boolean {
    const remove = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM chapter_memories WHERE chapter_id = ?`).run(chapterId);
      this.db.prepare(`DELETE FROM wisdom_chapters WHERE chapter_id = ?`).run(chapterId);
      const result = this.db
        .prepare(`DELETE FROM chapters WHERE id = ? AND project_id = ?`)
        .run(chapterId, this.projectId);
      return result.changes > 0;
    });

    return remove();
  }

  deleteWisdom(wisdomId: string): boolean {
    const remove = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM wisdom_chapters WHERE wisdom_id = ?`).run(wisdomId);
      const result = this.db
        .prepare(`DELETE FROM wisdom WHERE id = ? AND project_id = ?`)
        .run(wisdomId, this.projectId);
      return result.changes > 0;
    });

    return remove();
  }

  reset(): void {
    const clear = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM memory_links;
        DELETE FROM memory_files;
        DELETE FROM chapter_memories;
        DELETE FROM wisdom_chapters;
        DELETE FROM memories;
        DELETE FROM chapters;
        DELETE FROM wisdom;
        DELETE FROM sessions;
        DELETE FROM agents;
      `);
    });

    clear();
  }
}
