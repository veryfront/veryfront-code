import {
  assertEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
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
    for (const filename of ["deploying.md", "production-path.md"]) {
      const guide = await Deno.readTextFile(`docs/guides/${filename}`);

      assertEquals(guide.includes("deploy` prints a URL"), false);
      assertEquals(guide.includes("CLI prints a production URL"), false);
      assertStringIncludes(guide, "veryfront open");
    }
  });

  it("recommends the current Node.js LTS in onboarding docs", async () => {
    const docs = [
      "docs/guides/production-path.md",
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
