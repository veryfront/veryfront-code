import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("guide content contracts", () => {
  it("documents the current knowledge ingest JSON result shape", async () => {
    const guide = await Deno.readTextFile(
      "docs/guides/cli-knowledge-ingestion.md",
    );

    assertStringIncludes(guide, '"kind": "knowledge_ingest"');
    assertStringIncludes(guide, '"ingested": [');
    assertStringIncludes(guide, "jq '.ingested'");
    assertEquals(guide.includes(".knowledgeFiles"), false);
  });

  it("uses the public TokenStore method in OAuth verification", async () => {
    const guide = await Deno.readTextFile("docs/guides/oauth.md");

    assertStringIncludes(
      guide,
      "tokenStore.getTokens(githubConfig.serviceId, userId)",
    );
    assertEquals(
      guide.includes("tokenStore.get(userId, githubConfig.id)"),
      false,
    );
  });

  it("does not document removed OAuth provider exports", async () => {
    const docs = [
      await Deno.readTextFile("docs/guides/oauth.md"),
      await Deno.readTextFile("docs/api-reference/veryfront/oauth.md"),
    ].join("\n");

    const removedProviderReferences = [
      "bitbucketConfig",
      "boxConfig",
      "clickupConfig",
      "freshdeskConfig",
      "hubspotConfig",
      "intercomConfig",
      "mailchimpConfig",
      "mondayConfig",
      "pipedriveConfig",
      "quickbooksConfig",
      "salesforceConfig",
      "shopifyConfig",
      "trelloConfig",
      "twitterConfig",
      "webexConfig",
      "xeroConfig",
      "zoomConfig",
      "HubSpot",
      "Salesforce",
      "Shopify",
      "Bitbucket",
    ];

    for (const reference of removedProviderReferences) {
      assertEquals(docs.includes(reference), false);
    }
  });

  it("does not document caller-provided endUserId as tool context authority", async () => {
    const guide = await Deno.readTextFile("docs/guides/tools.md");

    assertEquals(guide.includes("context?.endUserId"), false);
    assertEquals(guide.includes('endUserId: "user-123"'), false);
    assertEquals(
      guide.includes("End-user identity for per-user token resolution"),
      false,
    );
  });

  it("does not claim deploy prints the production URL", async () => {
    const guide = await Deno.readTextFile("docs/guides/deploying.md");

    assertEquals(guide.includes("deploy` prints a URL"), false);
    assertEquals(guide.includes("CLI prints a production URL"), false);
    assertStringIncludes(guide, "veryfront open");
  });

  it("uses serve for local production builds", async () => {
    const docs = [
      "docs/getting-started/deploy-project.md",
      "docs/guides/deploying.md",
    ];

    for (const path of docs) {
      const text = await Deno.readTextFile(path);

      assertStringIncludes(text, "veryfront serve");
      assertEquals(text.includes("veryfront start"), false);
    }
  });

  it("documents the MCP session header for post-init tool calls", async () => {
    const guide = await Deno.readTextFile("docs/guides/mcp-server.md");

    assertStringIncludes(guide, "MCP-Session-Id");
    assertStringIncludes(guide, "SESSION_ID=$(curl -i");
    assertStringIncludes(guide, '-H "MCP-Session-Id: $SESSION_ID"');
    assertEquals(
      guide.includes(
        'curl -X POST http://localhost:3000/api/mcp \\\n  -H "Authorization: Bearer $MCP_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d',
      ),
      false,
    );
  });

  it("does not describe CLI schema as the MCP tool schema", async () => {
    const guide = await Deno.readTextFile("docs/guides/coding-agents.md");

    assertStringIncludes(
      guide,
      "Use `tools/list` to inspect the tools exposed by the active MCP connection.",
    );
    assertStringIncludes(guide, "`vf_get_schema`");
    assertStringIncludes(guide, "CLI command schema");
    assertEquals(
      guide.includes("For the full toolset and current argument shapes, call `vf_get_schema`"),
      false,
    );
  });

  it("recommends the current Node.js LTS in onboarding docs", async () => {
    const docs = [
      "docs/guides/deploying.md",
      "cli/templates/features/mdx/files/app/docs/getting-started/page.mdx",
    ];

    for (const path of docs) {
      const text = await Deno.readTextFile(path);

      assertStringIncludes(text, "current Node.js LTS");
      assertEquals(text.includes("Node.js 18"), false);
      assertEquals(text.includes("Node.js 18+"), false);
    }
  });
});
