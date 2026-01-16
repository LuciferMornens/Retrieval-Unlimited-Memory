import { v4 as uuidv4 } from "uuid";
import { RumDatabase } from "../storage/database.js";
import type { RumIdentityParams, RumIdentityResult } from "../types.js";

type RumIdentityRegisterParams = Extract<RumIdentityParams, { action: "register" }>;
type RumIdentityResumeParams = Extract<RumIdentityParams, { action: "resume" }>;

export class IdentityService {
  private db: RumDatabase;
  private currentAgentId: string | null = null;
  private currentSessionId: string | null = null;

  constructor(db: RumDatabase) {
    this.db = db;
  }

  get agentId(): string | null {
    return this.currentAgentId;
  }

  get sessionId(): string | null {
    return this.currentSessionId;
  }

  // ============================================================================
  // Identity Management
  // ============================================================================

  handleIdentity(params: RumIdentityParams): RumIdentityResult {
    switch (params.action) {
      case "register":
        return this.register(params);
      case "resume":
        return this.resume(params);
      case "info":
        return this.info();
      default:
        throw new Error("Unknown identity action");
    }
  }

  private register(params: RumIdentityRegisterParams): RumIdentityResult {
    const agentId = `agent_${uuidv4()}`;
    const sessionId = `session_${uuidv4()}`;

    const type = params.type || "main";

    // Validate parent for subagents
    if (type === "subagent") {
      if (!params.parent_id) {
        throw new Error("Subagents must have a parent_id");
      }
      const parent = this.db.getAgent(params.parent_id);
      if (!parent) {
        throw new Error(`Parent agent not found: ${params.parent_id}`);
      }
    }

    // Create the agent
    this.db.createAgent({
      id: agentId,
      type,
      parentId: params.parent_id,
      specialization: params.specialization,
      capabilities: params.capabilities,
    });

    // Create initial session
    this.db.createSession({
      id: sessionId,
      agentId,
    });

    // Set current identity
    this.currentAgentId = agentId;
    this.currentSessionId = sessionId;

    return {
      agent_id: agentId,
      type,
      created_at: Date.now(),
      memory_count: 0,
      last_active: Date.now(),
      session_count: 1,
      success_rate: 0,
    };
  }

  private resume(params: RumIdentityResumeParams): RumIdentityResult {
    const agent = params.agent_id
      ? this.db.getAgent(params.agent_id)
      : this.db.getLastActiveMainAgent();
    if (!agent) {
      if (params.agent_id) {
        throw new Error(`Agent not found: ${params.agent_id}`);
      }
      throw new Error("No previous agent found. Use register instead.");
    }
    const agentId = agent.id;

    // Update activity
    this.db.updateAgentActivity(agentId);

    // Create new session
    const sessionId = `session_${uuidv4()}`;
    this.db.createSession({
      id: sessionId,
      agentId,
    });

    // Set current identity
    this.currentAgentId = agentId;
    this.currentSessionId = sessionId;

    // Calculate success rate
    const total = agent.success_count + agent.failure_count;
    const successRate = total > 0 ? agent.success_count / total : 0;

    return {
      agent_id: agentId,
      type: agent.type,
      created_at: agent.created_at,
      memory_count: agent.memory_count,
      last_active: Date.now(),
      session_count: agent.session_count + 1,
      success_rate: successRate,
    };
  }

  private info(): RumIdentityResult {
    if (!this.currentAgentId) {
      throw new Error("No active agent. Call register or resume first.");
    }

    const agent = this.db.getAgent(this.currentAgentId);
    if (!agent) {
      throw new Error(`Agent not found: ${this.currentAgentId}`);
    }

    const total = agent.success_count + agent.failure_count;
    const successRate = total > 0 ? agent.success_count / total : 0;

    return {
      agent_id: this.currentAgentId,
      type: agent.type,
      created_at: agent.created_at,
      memory_count: agent.memory_count,
      last_active: agent.last_active_at,
      session_count: agent.session_count,
      success_rate: successRate,
    };
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  endCurrentSession(finalOutcome?: string): void {
    if (this.currentSessionId) {
      this.db.endSession(this.currentSessionId, finalOutcome);
      this.currentSessionId = null;
    }
  }
}
