/**
 * Runs knowledge scope checks under poisoned collection intrinsics.
 *
 * Agent-authored knowledge selectors are an authorization boundary. A served
 * project can replace Array filtering or matching helpers before lookup or RAG
 * retrieval, so exact and semantic knowledge scope exclusions must use captured
 * intrinsics. Prototype replacement is process-global, so this lives in the
 * semantic integration suite.
 */
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { clearEmbeddingProviders, registerEmbeddingProvider } from "#veryfront/embedding/index.ts";
import { projectKnowledge, searchProjectKnowledge } from "#veryfront/knowledge";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat.ts";

const SCOPE = {
  "knowledge/support-internal.md": true,
  "knowledge/support-*": false,
};

type PoisonedArrayPrototype = Pick<typeof Array.prototype, "filter" | "some">;

async function withPoisonedArrayScopeIntrinsics<T>(operation: () => Promise<T>): Promise<T> {
  const originalFilter = Array.prototype.filter;
  const originalSome = Array.prototype.some;
  try {
    Array.prototype.filter = function <TValue>(this: TValue[]): TValue[] {
      return this;
    } as PoisonedArrayPrototype["filter"];
    Array.prototype.some = function (): boolean {
      return false;
    } as PoisonedArrayPrototype["some"];
    return await operation();
  } finally {
    Array.prototype.filter = originalFilter;
    Array.prototype.some = originalSome;
  }
}

async function writeKnowledgeFile(
  projectDir: string,
  path: string,
  content: string,
): Promise<void> {
  const fullPath = join(projectDir, path);
  await mkdir(fullPath.slice(0, fullPath.lastIndexOf("/")), { recursive: true });
  await writeTextFile(fullPath, content);
}

function registerScopeEmbeddingProvider(): void {
  registerEmbeddingProvider("knowledge-scope", () =>
    ({
      specificationVersion: "v2",
      provider: "knowledge-scope",
      modelId: "test",
      maxEmbeddingsPerCall: undefined,
      supportsParallelCalls: true,
      async doEmbed({ values }: { values: string[] }) {
        return {
          embeddings: values.map((value) => {
            const normalized = value.toLowerCase();
            const internal = normalized.includes("internal") ? 1 : 0;
            const fallback = internal === 1 ? 0 : 0.1;
            const vector = new Array<number>(1536).fill(0);
            vector[0] = internal;
            vector[1] = fallback;
            return vector;
          }),
          usage: { tokens: 0 },
          rawResponse: undefined,
          warnings: [],
        };
      },
    }) as never);
}

describe("knowledge scope intrinsic boundary", () => {
  it("keeps exact lookup exclusions under poisoned Array filter and some", async () => {
    let returned = -1;
    let leakedContent = false;

    await withTempDir(async (projectDir) => {
      await writeKnowledgeFile(
        projectDir,
        "knowledge/support-internal.md",
        "Internal support runbook content.",
      );

      const result = await withPoisonedArrayScopeIntrinsics(() =>
        searchProjectKnowledge(
          {
            query: "internal",
            lookup_target: { path: "knowledge/support-internal.md" },
          },
          { projectDir, scope: SCOPE },
        )
      );
      returned = result.returned;
      for (let index = 0; index < result.data.length; index += 1) {
        if (result.data[index]?.content?.includes("Internal support runbook")) leakedContent = true;
      }
    });

    assertEquals(returned, 0);
    assertEquals(leakedContent, false);
  });

  it("keeps semantic RAG exclusions under poisoned Array filter and some", async () => {
    let leakedSource = false;
    let matchCount = -1;

    try {
      clearEmbeddingProviders();
      registerScopeEmbeddingProvider();
      await withTempDir(async (projectDir) => {
        await writeKnowledgeFile(
          projectDir,
          "knowledge/support-internal.md",
          "Internal support retrieval marker.",
        );
        const knowledge = projectKnowledge({
          projectDir,
          scope: SCOPE,
          model: "knowledge-scope/test",
          storagePath: join(projectDir, "data", "knowledge-index.json"),
        });
        await knowledge.index();

        const result = await withPoisonedArrayScopeIntrinsics(() => knowledge.retrieve("internal"));
        matchCount = result.matches.length;
        for (let index = 0; index < result.matches.length; index += 1) {
          if (result.matches[index]?.source === "knowledge/support-internal.md") {
            leakedSource = true;
          }
        }
      });
    } finally {
      clearEmbeddingProviders();
    }

    assertEquals(matchCount, 0);
    assertEquals(leakedSource, false);
  });
});
