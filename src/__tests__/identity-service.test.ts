import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IdentityService } from "../core/identity-service.js";
import { RumDatabase } from "../storage/database.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("IdentityService", () => {
  let db: RumDatabase;
  let identityService: IdentityService;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "rum-identity-test-"));
    db = new RumDatabase({ projectId: "test-project", dataDir: tempDir });
    identityService = new IdentityService(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Agent Registration", () => {
    it("should register a new main agent", () => {
      const result = identityService.handleIdentity({
        action: "register",
        type: "main",
        specialization: "coding",
        capabilities: ["typescript"],
      });

      expect(result.agent_id).toMatch(/^agent_/);
      expect(result.type).toBe("main");
      expect(result.memory_count).toBe(0);
      expect(result.session_count).toBe(1);
      expect(result.success_rate).toBe(0);
      expect(identityService.agentId).toBe(result.agent_id);
      expect(identityService.sessionId).toMatch(/^session_/);
    });

    it("should register a subagent with parent", () => {
      const parentResult = identityService.handleIdentity({
        action: "register",
        type: "main",
      });

      const childService = new IdentityService(db);
      const childResult = childService.handleIdentity({
        action: "register",
        type: "subagent",
        parent_id: parentResult.agent_id,
        specialization: "testing",
      });

      expect(childResult.type).toBe("subagent");
      expect(childResult.agent_id).not.toBe(parentResult.agent_id);
    });

    it("should throw when registering subagent without parent", () => {
      expect(() =>
        identityService.handleIdentity({
          action: "register",
          type: "subagent",
        })
      ).toThrow("Subagents must have a parent_id");
    });

    it("should throw when registering subagent with invalid parent", () => {
      expect(() =>
        identityService.handleIdentity({
          action: "register",
          type: "subagent",
          parent_id: "nonexistent_parent",
        })
      ).toThrow("Parent agent not found");
    });

    it("should default to main type when not specified", () => {
      const result = identityService.handleIdentity({ action: "register" });
      expect(result.type).toBe("main");
    });
  });

  describe("Agent Resume", () => {
    it("should resume an existing agent", () => {
      const registerResult = identityService.handleIdentity({
        action: "register",
        type: "main",
      });

      const newService = new IdentityService(db);
      const resumeResult = newService.handleIdentity({
        action: "resume",
        agent_id: registerResult.agent_id,
      });

      expect(resumeResult.agent_id).toBe(registerResult.agent_id);
      expect(resumeResult.session_count).toBe(2);
      expect(newService.agentId).toBe(registerResult.agent_id);
      expect(newService.sessionId).toMatch(/^session_/);
      expect(newService.sessionId).not.toBe(identityService.sessionId);
    });

    it("should auto-resume the last active main agent when agent_id is omitted", () => {
      const registerResult = identityService.handleIdentity({
        action: "register",
        type: "main",
      });

      const newService = new IdentityService(db);
      const resumeResult = newService.handleIdentity({ action: "resume" });

      expect(resumeResult.agent_id).toBe(registerResult.agent_id);
      expect(newService.agentId).toBe(registerResult.agent_id);
    });

    it("should throw when resuming nonexistent agent", () => {
      expect(() =>
        identityService.handleIdentity({
          action: "resume",
          agent_id: "nonexistent",
        })
      ).toThrow("Agent not found");
    });

    it("should throw when auto-resume finds no previous agent", () => {
      expect(() =>
        identityService.handleIdentity({ action: "resume" })
      ).toThrow("No previous agent found. Use register instead.");
    });

    it("should calculate success rate on resume", () => {
      const result = identityService.handleIdentity({
        action: "register",
        type: "main",
      });

      db.incrementAgentMemoryCount(result.agent_id, true);
      db.incrementAgentMemoryCount(result.agent_id, true);
      db.incrementAgentMemoryCount(result.agent_id, false);

      const newService = new IdentityService(db);
      const resumeResult = newService.handleIdentity({
        action: "resume",
        agent_id: result.agent_id,
      });

      expect(resumeResult.success_rate).toBeCloseTo(2 / 3, 5);
    });
  });

  describe("Agent Info", () => {
    it("should return current agent info", () => {
      identityService.handleIdentity({
        action: "register",
        type: "main",
      });

      const info = identityService.handleIdentity({ action: "info" });
      expect(info.agent_id).toBe(identityService.agentId);
      expect(info.type).toBe("main");
    });

    it("should throw when no active agent", () => {
      expect(() =>
        identityService.handleIdentity({ action: "info" })
      ).toThrow("No active agent");
    });

    it("should reflect updated stats", () => {
      const result = identityService.handleIdentity({
        action: "register",
        type: "main",
      });

      db.incrementAgentMemoryCount(result.agent_id, true);

      const info = identityService.handleIdentity({ action: "info" });
      expect(info.memory_count).toBe(1);
    });
  });

  describe("Session Management", () => {
    it("should create session on register", () => {
      identityService.handleIdentity({ action: "register" });

      expect(identityService.sessionId).toMatch(/^session_/);
    });

    it("should create new session on resume", () => {
      const result = identityService.handleIdentity({ action: "register" });
      const firstSession = identityService.sessionId;

      const newService = new IdentityService(db);
      newService.handleIdentity({
        action: "resume",
        agent_id: result.agent_id,
      });

      expect(newService.sessionId).not.toBe(firstSession);
    });

    it("should end current session", () => {
      identityService.handleIdentity({ action: "register" });
      const sessionId = identityService.sessionId;

      identityService.endCurrentSession("Task completed");

      expect(identityService.sessionId).toBeNull();

      const stmt = db.database.prepare("SELECT * FROM sessions WHERE id = ?");
      const session = stmt.get(sessionId!) as Record<string, unknown>;
      expect(session.ended_at).toBeDefined();
      expect(session.final_outcome).toBe("Task completed");
    });

    it("should handle ending session when none active", () => {
      expect(() => identityService.endCurrentSession()).not.toThrow();
    });
  });

  describe("Unknown Actions", () => {
    it("should throw for unknown action", () => {
      expect(() =>
        identityService.handleIdentity({ action: "unknown" as any })
      ).toThrow("Unknown identity action");
    });
  });
});
