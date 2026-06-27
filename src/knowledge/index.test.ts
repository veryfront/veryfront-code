import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { exists, mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import { clearEmbeddingProviders, registerEmbeddingProvider } from "#veryfront/embedding/index.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { createSearchKnowledgeTool, formatKnowledgeContext, projectKnowledge } from "./index.ts";

const originalFetch = globalThis.fetch;

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
    globalThis.fetch = originalFetch;
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

  it("looks up local OKF knowledge frontmatter with the hosted response shape", async () => {
    await withTempDir(async (projectDir) => {
      await mkdir(join(projectDir, "knowledge"), { recursive: true });
      await writeTextFile(
        join(projectDir, "knowledge", "billing-escalation.md"),
        [
          "---",
          "type: runbook",
          "title: Billing escalation",
          "description: Escalate billing disputes to finance after account review.",
          "added: 2026-06-26",
          "tags:",
          "  - billing",
          "  - escalation",
          "---",
          "",
          "# Billing escalation",
          "",
          "Body text should not be required for manifest lookup.",
        ].join("\n"),
      );
      await writeTextFile(
        join(projectDir, "knowledge", "login-troubleshooting.md"),
        [
          "---",
          "type: runbook",
          "title: Login troubleshooting",
          "description: Diagnose SSO failures after releases.",
          "tags:",
          "  - auth",
          "---",
          "",
          "# Login troubleshooting",
        ].join("\n"),
      );

      const result = await projectKnowledge({ projectDir }).lookup({
        query: "billing escalation",
        limit: 3,
      });

      assertEquals(result.query, "billing escalation");
      assertEquals(result.mode, "search");
      assertEquals(result.returned, 1);
      assertEquals(result.total_matches, 1);
      assertEquals(result.data[0]?.path, "knowledge/billing-escalation.md");
      assertEquals(result.data[0]?.matched_fields.includes("title"), true);
      assertEquals(
        result.data[0]?.frontmatter.find((field) => field.key === "title")?.value,
        "Billing escalation",
      );
      assertEquals(
        result.data[0]?.frontmatter.find((field) => field.key === "added")?.value,
        "2026-06-26",
      );
      assertEquals(result.shard, { shard_index: 0, shard_count: 1, total_items: 2 });
    });
  });

  it("returns document content for explicit local knowledge lookup targets", async () => {
    await withTempDir(async (projectDir) => {
      await mkdir(join(projectDir, "knowledge"), { recursive: true });
      await writeTextFile(
        join(projectDir, "knowledge", "login-troubleshooting.md"),
        [
          "---",
          "type: runbook",
          "title: Login troubleshooting",
          "description: Diagnose SSO failures after releases.",
          "---",
          "",
          "# Login troubleshooting",
          "",
          "Check identity provider metadata and callback URL changes.",
        ].join("\n"),
      );

      const knowledge = projectKnowledge({ projectDir });
      const searchResult = await knowledge.lookup({ query: "login troubleshooting" });
      const lookupResult = await knowledge.lookup({
        query: "login troubleshooting",
        lookup_target: { path: "knowledge/login-troubleshooting.md" },
      });

      assertEquals(searchResult.data[0]?.content, undefined);
      assertEquals(lookupResult.returned, 1);
      assertEquals(lookupResult.data[0]?.path, "knowledge/login-troubleshooting.md");
      assertStringIncludes(
        lookupResult.data[0]?.content ?? "",
        "Check identity provider metadata and callback URL changes.",
      );
    });
  });

  it("falls back to browse order and paginates local knowledge lookups", async () => {
    await withTempDir(async (projectDir) => {
      await mkdir(join(projectDir, "knowledge"), { recursive: true });
      await writeTextFile(
        join(projectDir, "knowledge", "billing.md"),
        [
          "---",
          "type: runbook",
          "title: Billing",
          "---",
          "",
          "Billing content.",
        ].join("\n"),
      );
      await writeTextFile(
        join(projectDir, "knowledge", "login.md"),
        [
          "---",
          "type: runbook",
          "title: Login",
          "---",
          "",
          "Login content.",
        ].join("\n"),
      );

      const knowledge = projectKnowledge({ projectDir });
      const firstPage = await knowledge.lookup({ query: "zxqv yjkp", limit: 1 });

      assertEquals(firstPage.mode, "browse");
      assertEquals(firstPage.returned, 1);
      assertEquals(firstPage.total_matches, 2);
      assertEquals(typeof firstPage.page_info.next, "string");

      const secondPage = await knowledge.lookup({
        query: "zxqv yjkp",
        cursor: firstPage.page_info.next ?? undefined,
      });

      assertEquals(secondPage.mode, "browse");
      assertEquals(secondPage.page_info.self, firstPage.page_info.next);
      assertEquals(secondPage.returned, 1);
      assertEquals(secondPage.page_info.next, null);
      assertEquals(secondPage.data.map((item) => item.path), ["knowledge/login.md"]);
    });
  });

  it("creates a local search_knowledge tool for parity with hosted MCP", async () => {
    await withTempDir(async (projectDir) => {
      await mkdir(join(projectDir, "knowledge"), { recursive: true });
      await writeTextFile(
        join(projectDir, "knowledge", "billing.md"),
        [
          "---",
          "type: runbook",
          "title: Billing escalation",
          "---",
          "",
          "Billing content.",
        ].join("\n"),
      );

      const searchKnowledge = createSearchKnowledgeTool({ projectDir });
      const result = await searchKnowledge.execute({ query: "billing" });

      assertEquals(searchKnowledge.id, "search_knowledge");
      assertEquals(searchKnowledge.inputSchemaJson?.properties?.query?.type, "string");
      assertEquals(result.data.map((item) => item.path), ["knowledge/billing.md"]);
    });
  });

  it("looks up hosted OKF knowledge from the request-scoped project context", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      requestedUrls.push(url);
      assertEquals(new Headers(init?.headers).get("Authorization"), "Bearer tenant-token");

      const parsed = new URL(url);
      if (
        parsed.pathname === "/projects/acme/releases/release-1/files" &&
        parsed.searchParams.get("include_server_functions") === "true" &&
        parsed.searchParams.get("path") === "knowledge/" &&
        !parsed.searchParams.has("pattern")
      ) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "file-1",
                version_id: "version-1",
                path: "knowledge/login-troubleshooting.md",
                content: [
                  "---",
                  "type: runbook",
                  "title: Login troubleshooting",
                  "description: Diagnose SSO failures after releases.",
                  "---",
                  "",
                  "# Login troubleshooting",
                ].join("\n"),
                type: "file",
                size: 128,
                updated_at: "2026-06-26T00:00:00.000Z",
              },
              {
                id: "file-2",
                version_id: "version-2",
                path: "app/page.tsx",
                content: "export default function Page() { return null; }",
                type: "file",
                size: 48,
                updated_at: "2026-06-26T00:00:00.000Z",
              },
            ],
            page_info: {
              self: null,
              first: null,
              next: null,
              prev: null,
            },
            release_id: "release-1",
            release_version: "1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ error: "unexpected request", url }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const searchKnowledge = createSearchKnowledgeTool();
    const result = await runWithRequestContext(
      {
        projectSlug: "acme",
        projectId: "project-1",
        token: "tenant-token",
        productionMode: true,
        releaseId: "release-1",
      },
      () => searchKnowledge.execute({ query: "sso release" }),
    );

    assertEquals(result.mode, "search");
    assertEquals(result.returned, 1);
    assertEquals(result.data[0]?.path, "knowledge/login-troubleshooting.md");
    assertEquals(
      result.data[0]?.frontmatter.find((field) => field.key === "title")?.value,
      "Login troubleshooting",
    );
    assertEquals(requestedUrls.length, 1);
    assertStringIncludes(requestedUrls[0] ?? "", "/projects/acme/releases/release-1/files");
    assertStringIncludes(requestedUrls[0] ?? "", "path=knowledge%2F");
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
