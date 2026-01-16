import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  EmbeddingService,
  createEmbeddingText,
} from "../core/embedding-service.js";

describe("EmbeddingService", () => {
  describe("cosineSimilarity", () => {
    let service: EmbeddingService;

    beforeEach(() => {
      service = new EmbeddingService({ provider: "ollama" });
    });

    it("should return 1.0 for identical vectors", () => {
      const vec = [1, 2, 3, 4, 5];
      expect(service.cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 5);
    });

    it("should return 0 for orthogonal vectors", () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(service.cosineSimilarity(a, b)).toBeCloseTo(0, 5);
    });

    it("should return -1 for opposite vectors", () => {
      const a = [1, 2, 3];
      const b = [-1, -2, -3];
      expect(service.cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
    });

    it("should handle normalized vectors", () => {
      const a = [0.6, 0.8, 0];
      const b = [0.8, 0.6, 0];
      const similarity = service.cosineSimilarity(a, b);
      expect(similarity).toBeGreaterThan(0.9);
      expect(similarity).toBeLessThan(1.0);
    });

    it("should throw for mismatched dimensions", () => {
      const a = [1, 2, 3];
      const b = [1, 2];
      expect(() => service.cosineSimilarity(a, b)).toThrow(
        "Embeddings must have same dimensions"
      );
    });

    it("should return 0 for zero vectors", () => {
      const a = [0, 0, 0];
      const b = [1, 2, 3];
      expect(service.cosineSimilarity(a, b)).toBe(0);
    });
  });

  describe("findSimilar", () => {
    let service: EmbeddingService;

    beforeEach(() => {
      service = new EmbeddingService({ provider: "ollama" });
    });

    it("should find top-k similar embeddings", () => {
      const query = [1, 0, 0];
      const candidates = [
        { id: "a", embedding: [1, 0, 0] },
        { id: "b", embedding: [0.9, 0.1, 0] },
        { id: "c", embedding: [0, 1, 0] },
        { id: "d", embedding: [0.5, 0.5, 0] },
      ];

      const results = service.findSimilar(query, candidates, 2, 0);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("a");
      expect(results[0].similarity).toBeCloseTo(1.0, 5);
      expect(results[1].id).toBe("b");
    });

    it("should filter by minimum similarity", () => {
      const query = [1, 0, 0];
      const candidates = [
        { id: "high", embedding: [0.9, 0.1, 0] },
        { id: "low", embedding: [0.3, 0.7, 0] },
      ];

      const results = service.findSimilar(query, candidates, 10, 0.8);

      expect(results.length).toBeLessThanOrEqual(2);
      results.forEach((r) => {
        expect(r.similarity).toBeGreaterThanOrEqual(0.8);
      });
    });

    it("should return results sorted by similarity descending", () => {
      const query = [1, 0, 0];
      const candidates = [
        { id: "c", embedding: [0.5, 0.5, 0] },
        { id: "a", embedding: [1, 0, 0] },
        { id: "b", embedding: [0.8, 0.2, 0] },
      ];

      const results = service.findSimilar(query, candidates, 10, 0);

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity).toBeGreaterThanOrEqual(
          results[i].similarity
        );
      }
    });

    it("should return empty array when no candidates meet threshold", () => {
      const query = [1, 0, 0];
      const candidates = [{ id: "low", embedding: [0, 1, 0] }];

      const results = service.findSimilar(query, candidates, 10, 0.9);

      expect(results).toHaveLength(0);
    });

    it("should handle empty candidates", () => {
      const query = [1, 0, 0];
      const results = service.findSimilar(query, [], 5, 0);
      expect(results).toHaveLength(0);
    });
  });

  describe("createEmbeddingText", () => {
    it("should create text from basic memory", () => {
      const text = createEmbeddingText({
        intent: { goal: "Fix bug", task_type: "bug_fix" },
        outcome: { summary: "Bug fixed" },
      });

      expect(text).toContain("Task: Fix bug");
      expect(text).toContain("Type: bug_fix");
      expect(text).toContain("Outcome: Bug fixed");
    });

    it("should include context when provided", () => {
      const text = createEmbeddingText({
        intent: { goal: "Add feature", task_type: "feature_add", context: "API layer" },
        outcome: { summary: "Feature added" },
      });

      expect(text).toContain("Context: API layer");
    });

    it("should include learnings when provided", () => {
      const text = createEmbeddingText({
        intent: { goal: "Task", task_type: "other" },
        outcome: {
          summary: "Done",
          learnings: ["Lesson 1", "Lesson 2"],
        },
      });

      expect(text).toContain("Learnings: Lesson 1; Lesson 2");
    });

    it("should include reasoning when provided", () => {
      const text = createEmbeddingText({
        intent: { goal: "Task", task_type: "other" },
        outcome: { summary: "Done" },
        reasoning: { approach_chosen: "TDD", why_chosen: "Better" },
      });

      expect(text).toContain("Approach: TDD");
    });

    it("should handle minimal memory", () => {
      const text = createEmbeddingText({
        intent: { goal: "Simple", task_type: "other" },
        outcome: { summary: "Done" },
      });

      expect(text).toBeTruthy();
      expect(text.length).toBeGreaterThan(0);
    });
  });

  describe("Configuration", () => {
    it("should use ollama defaults", () => {
      const service = new EmbeddingService({ provider: "ollama" });
      expect(service.dimensions).toBe(1024);
    });

    it("should use openai defaults", () => {
      const service = new EmbeddingService({
        provider: "openai",
        apiKey: "test-key",
      });
      expect(service.dimensions).toBe(1536);
    });

    it("should disable when openai has no api key", () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      const service = new EmbeddingService({ provider: "openai" });
      expect(service.isEnabled).toBe(false);

      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      }
    });

    it("should allow custom dimensions", () => {
      const service = new EmbeddingService({
        provider: "ollama",
        dimensions: 512,
      });
      expect(service.dimensions).toBe(512);
    });

    it("should allow custom model", () => {
      const service = new EmbeddingService({
        provider: "ollama",
        model: "custom-model",
      });
      expect(service.isEnabled).toBe(true);
    });
  });

  describe("embed (with mocked fetch)", () => {
    let service: EmbeddingService;

    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("should return null when disabled", async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      service = new EmbeddingService({ provider: "openai" });
      const result = await service.embed("test");
      expect(result).toBeNull();

      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      }
    });

    it("should call ollama API correctly", async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: mockEmbedding }),
      } as Response);

      service = new EmbeddingService({ provider: "ollama" });
      const result = await service.embed("test text");

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/embeddings",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "bge-m3",
            prompt: "test text",
          }),
        })
      );

      expect(result?.embedding).toEqual(mockEmbedding);
      expect(result?.model).toBe("bge-m3");
    });

    it("should call openai API correctly", async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: mockEmbedding }],
          usage: { total_tokens: 10 },
        }),
      } as Response);

      service = new EmbeddingService({
        provider: "openai",
        apiKey: "test-key",
      });
      const result = await service.embed("test text");

      expect(fetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/embeddings",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-key",
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: "test text",
          }),
        })
      );

      expect(result?.embedding).toEqual(mockEmbedding);
      expect(result?.tokensUsed).toBe(10);
    });

    it("should handle API errors and disable service", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        text: async () => "API Error",
      } as Response);

      service = new EmbeddingService({ provider: "ollama" });
      const result = await service.embed("test");

      expect(result).toBeNull();
      expect(service.isEnabled).toBe(false);
    });

    it("should handle network errors and disable service", async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

      service = new EmbeddingService({ provider: "ollama" });
      const result = await service.embed("test");

      expect(result).toBeNull();
      expect(service.isEnabled).toBe(false);
    });
  });

  describe("embedBatch", () => {
    let service: EmbeddingService;

    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("should return nulls when disabled", async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      service = new EmbeddingService({ provider: "openai" });
      const results = await service.embedBatch(["a", "b", "c"]);

      expect(results).toHaveLength(3);
      results.forEach((r) => expect(r).toBeNull());

      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      }
    });

    it("should process multiple texts sequentially", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ embedding: [0.1] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ embedding: [0.2] }),
        } as Response);

      service = new EmbeddingService({ provider: "ollama" });
      const results = await service.embedBatch(["text1", "text2"]);

      expect(results).toHaveLength(2);
      expect(results[0]?.embedding).toEqual([0.1]);
      expect(results[1]?.embedding).toEqual([0.2]);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
