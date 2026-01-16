/**
 * Embedding Service for RUM
 * 
 * Supports multiple embedding providers:
 * - Ollama (local, free) - recommended: bge-m3
 * - OpenAI (cloud, paid) - text-embedding-3-small
 * 
 * Based on research:
 * - bge-m3: 1024 dims, 8k context, 72% retrieval accuracy - best open-source for RAG
 * - OpenAI text-embedding-3-small: 1536 dims, 8k context, strong general performance
 */

export type EmbeddingProvider = "ollama" | "openai";

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  dimensions?: number;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
  tokensUsed?: number;
}

const DEFAULT_CONFIGS: Record<EmbeddingProvider, Partial<EmbeddingConfig>> = {
  ollama: {
    model: "bge-m3",
    baseUrl: "http://localhost:11434",
    dimensions: 1024,
  },
  openai: {
    model: "text-embedding-3-small",
    baseUrl: "https://api.openai.com/v1",
    dimensions: 1536,
  },
};

export class EmbeddingService {
  private config: EmbeddingConfig;
  private enabled: boolean = true;

  constructor(config?: Partial<EmbeddingConfig>) {
    const provider = config?.provider || "ollama";
    const defaults = DEFAULT_CONFIGS[provider];

    this.config = {
      provider,
      model: config?.model || defaults.model!,
      baseUrl: config?.baseUrl || defaults.baseUrl!,
      apiKey: config?.apiKey || process.env.OPENAI_API_KEY,
      dimensions: config?.dimensions || defaults.dimensions!,
    };

    // Disable if OpenAI selected but no API key
    if (this.config.provider === "openai" && !this.config.apiKey) {
      console.error(
        "EmbeddingService: OpenAI selected but no API key provided. Semantic search disabled."
      );
      this.enabled = false;
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get dimensions(): number {
    return this.config.dimensions!;
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<EmbeddingResult | null> {
    if (!this.enabled) return null;

    try {
      switch (this.config.provider) {
        case "ollama":
          return await this.embedWithOllama(text);
        case "openai":
          return await this.embedWithOpenAI(text);
        default:
          throw new Error(`Unknown provider: ${this.config.provider}`);
      }
    } catch (error) {
      console.error("Embedding error:", error);
      // Disable on persistent failures
      this.enabled = false;
      return null;
    }
  }

  /**
   * Generate embeddings for multiple texts (batched)
   */
  async embedBatch(texts: string[]): Promise<(EmbeddingResult | null)[]> {
    if (!this.enabled) return texts.map(() => null);

    // For now, process sequentially. Could optimize with batching later.
    const results: (EmbeddingResult | null)[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  /**
   * Compute cosine similarity between two embeddings
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Embeddings must have same dimensions");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Find top-k most similar embeddings
   */
  findSimilar(
    queryEmbedding: number[],
    candidates: Array<{ id: string; embedding: number[] }>,
    topK: number = 5,
    minSimilarity: number = 0.5
  ): Array<{ id: string; similarity: number }> {
    const scored = candidates
      .map((c) => ({
        id: c.id,
        similarity: this.cosineSimilarity(queryEmbedding, c.embedding),
      }))
      .filter((c) => c.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, topK);
  }

  // ============================================================================
  // Provider Implementations
  // ============================================================================

  private async embedWithOllama(text: string): Promise<EmbeddingResult> {
    const response = await fetch(`${this.config.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.config.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama embedding failed: ${error}`);
    }

    const data = (await response.json()) as { embedding: number[] };

    return {
      embedding: data.embedding,
      model: this.config.model!,
      dimensions: data.embedding.length,
    };
  }

  private async embedWithOpenAI(text: string): Promise<EmbeddingResult> {
    const response = await fetch(`${this.config.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding failed: ${error}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
      usage?: { total_tokens: number };
    };

    return {
      embedding: data.data[0].embedding,
      model: this.config.model!,
      dimensions: data.data[0].embedding.length,
      tokensUsed: data.usage?.total_tokens,
    };
  }
}

/**
 * Create text for embedding from memory content
 * Combines key fields into a single embeddable string
 */
export function createEmbeddingText(memory: {
  intent: { goal: string; task_type: string; context?: string };
  outcome: { summary: string; learnings?: string[] };
  reasoning?: { approach_chosen?: string; why_chosen?: string };
}): string {
  const parts: string[] = [];

  // Intent
  parts.push(`Task: ${memory.intent.goal}`);
  parts.push(`Type: ${memory.intent.task_type}`);
  if (memory.intent.context) {
    parts.push(`Context: ${memory.intent.context}`);
  }

  // Outcome
  parts.push(`Outcome: ${memory.outcome.summary}`);
  if (memory.outcome.learnings?.length) {
    parts.push(`Learnings: ${memory.outcome.learnings.join("; ")}`);
  }

  // Reasoning (if present)
  if (memory.reasoning?.approach_chosen) {
    parts.push(`Approach: ${memory.reasoning.approach_chosen}`);
  }

  return parts.join("\n");
}
