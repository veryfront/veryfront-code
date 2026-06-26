import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { exists, mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import { clearEmbeddingProviders, registerEmbeddingProvider } from "#veryfront/embedding/index.ts";
import { formatKnowledgeContext, projectKnowledge } from "./index.ts";

function registerTestEmbeddingProvider(): void {
  registerEmbeddingProvider("test", () =>
    ({
      specificationVersion: "v2",
      provider: "test",
      modelId: "test/demo",
      maxEmbeddingsPerCall: undefined,
      supportsParallelCalls: true,
      async doEmbed({ values }: { values: string[] }) {
        return {
          embeddings: values.map((value) => {
            const vector = new Array<number>(1536).fill(0);
            vector[0] = value.toLowerCase().includes("login") ? 10 : value.length;
            vector[1] = value.toLowerCase().includes("sso") ? 10 : 0;
            return vector;
          }),
          usage: { tokens: 0 },
          rawResponse: undefined,
          warnings: [],
        };
      },
    }) as never);
}

describe("projectKnowledge", () => {
  afterEach(() => {
    clearEmbeddingProviders();
  });

  it("retrieves source-controlled project knowledge with default paths", async () => {
    registerTestEmbeddingProvider();

    await withTempDir(async (projectDir) => {
      await mkdir(join(projectDir, "knowledge"), { recursive: true });
      await writeTextFile(
        join(projectDir, "knowledge", "login-troubleshooting.md"),
        [
          "# Login troubleshooting",
          "",
          "Escalate blocked SSO login issues after a deployment.",
        ].join("\n"),
      );

      const knowledge = projectKnowledge({
        projectDir,
        model: "test/demo",
      });
      await knowledge.index();

      const result = await knowledge.retrieve("SSO login after deployment");

      assertEquals(result.query, "SSO login after deployment");
      assertEquals(result.matches.length, 1);
      assertEquals(result.matches[0]?.title, "login-troubleshooting");
      assertStringIncludes(result.context, "[login-troubleshooting]");
      assertStringIncludes(result.context, "Escalate blocked SSO login issues");
      assertEquals(await exists(join(projectDir, "data", "knowledge-index.json")), true);
    });
  });

  it("does not index or search for blank queries", async () => {
    registerTestEmbeddingProvider();

    await withTempDir(async (projectDir) => {
      await mkdir(join(projectDir, "knowledge"), { recursive: true });
      await writeTextFile(join(projectDir, "knowledge", "login.md"), "Login help");

      const knowledge = projectKnowledge({
        projectDir,
        model: "test/demo",
      });
      const result = await knowledge.retrieve(" \n\t ");

      assertEquals(result, { query: "", matches: [], context: "" });
      assertEquals(await exists(join(projectDir, "data", "knowledge-index.json")), false);
    });
  });

  it("keeps indexing explicit on non-blank retrieval", async () => {
    registerTestEmbeddingProvider();

    await withTempDir(async (projectDir) => {
      await mkdir(join(projectDir, "knowledge"), { recursive: true });
      await writeTextFile(
        join(projectDir, "knowledge", "login.md"),
        "Login troubleshooting content.",
      );

      const knowledge = projectKnowledge({
        projectDir,
        model: "test/demo",
      });
      const result = await knowledge.retrieve("login");

      assertEquals(result.matches, []);
      assertEquals(result.context, "");
      assertEquals(await exists(join(projectDir, "data", "knowledge-index.json")), false);
    });
  });

  it("indexes project knowledge when requested explicitly", async () => {
    registerTestEmbeddingProvider();

    await withTempDir(async (projectDir) => {
      await mkdir(join(projectDir, "knowledge"), { recursive: true });
      await writeTextFile(
        join(projectDir, "knowledge", "login.md"),
        "Login troubleshooting content.",
      );

      const knowledge = projectKnowledge({
        projectDir,
        model: "test/demo",
      });

      await knowledge.index();
      await writeTextFile(
        join(projectDir, "knowledge", "billing.md"),
        "Billing troubleshooting content.",
      );
      const beforeRefresh = await knowledge.retrieve("billing");

      const indexPayload = JSON.parse(
        await Deno.readTextFile(join(projectDir, "data", "knowledge-index.json")),
      ) as { documents: Array<{ source: string }> };

      assertEquals(beforeRefresh.matches.length, 1);
      assertEquals(
        indexPayload.documents.map((document) => document.source),
        [join(projectDir, "knowledge", "login.md")],
      );

      await knowledge.index();

      const refreshedPayload = JSON.parse(
        await Deno.readTextFile(join(projectDir, "data", "knowledge-index.json")),
      ) as { documents: Array<{ source: string }> };

      assertEquals(
        refreshedPayload.documents.map((document) => document.source),
        [
          join(projectDir, "knowledge", "login.md"),
          join(projectDir, "knowledge", "billing.md"),
        ],
      );
    });
  });

  it("formats retrieved knowledge into a deterministic context block", () => {
    const context = formatKnowledgeContext([
      {
        documentId: "doc-1",
        title: "Runbook",
        source: "knowledge/runbook.md",
        type: "md",
        score: 0.9876,
        text: "Step one.\n\nStep two.",
      },
      {
        documentId: "doc-2",
        title: "Policy",
        source: "knowledge/policy.md",
        type: "md",
        score: 0.1234,
        text: "Use approved escalation paths.",
      },
    ]);

    assertEquals(
      context,
      [
        "[Runbook] (score: 0.99)",
        "Step one.\n\nStep two.",
        "",
        "---",
        "",
        "[Policy] (score: 0.12)",
        "Use approved escalation paths.",
      ].join("\n"),
    );
  });
});
