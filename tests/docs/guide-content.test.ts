import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
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

  it("documents feature-gated integrations without describing them as removed", async () => {
    const docs = [
      await Deno.readTextFile("docs/guides/integrations.md"),
      await Deno.readTextFile("docs/guides/oauth.md"),
      await Deno.readTextFile("docs/api-reference/veryfront/oauth.md"),
    ].join("\n");

    assertStringIncludes(docs, "VERYFRONT_EXPERIMENTAL_INTEGRATIONS");
    assertStringIncludes(docs, "feature-gated integrations");
    assertStringIncludes(docs, "salesforceConfig");
    assertStringIncludes(docs, "Salesforce");

    assertEquals(docs.includes("removed OAuth provider exports"), false);
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

  it("documents Push before Deploy for every Veryfront Cloud path", async () => {
    const docs = [
      "docs/getting-started/deploy-project.md",
      "docs/guides/deploying.md",
      "docs/guides/deploy-from-ci.md",
    ];
    const push = "veryfront push --branch main --yes";
    const deploy = "veryfront deploy --branch main --env production --yes";

    for (const path of docs) {
      const text = await Deno.readTextFile(path);
      const pushIndex = text.indexOf(push);
      const deployIndex = text.indexOf(deploy);

      assert(pushIndex >= 0, `${path} must document the canonical Push command`);
      assert(deployIndex > pushIndex, `${path} must document Deploy after Push`);
    }
  });

  it("keeps the CI workflow serialized, auditable, and rollback-safe", async () => {
    const guide = await Deno.readTextFile("docs/guides/deploy-from-ci.md");

    assertStringIncludes(guide, "same Git checkout and CI job");
    assertStringIncludes(guide, "cancel-in-progress: false");
    assertStringIncludes(guide, "not an enforced repository connection");
    assertStringIncludes(guide, "Skipping superseded main commit");
    assertStringIncludes(guide, "working-directory: apps/storefront");
    assertStringIncludes(guide, ".veryfront/` in `.gitignore");
    assertStringIncludes(guide, "commit it to Git");
    assertStringIncludes(guide, "RUNNER_TEMP");
    assertStringIncludes(guide, "NDJSON records");
    assertStringIncludes(guide, "git revert");
    assertStringIncludes(guide, "Start the pilot in staging");
    assertStringIncludes(guide, "veryfront push --branch main --dry-run");
    assertStringIncludes(guide, "does not create a missing project or branch");
    assertStringIncludes(guide, "veryfront deploy --branch main --env staging --yes");
    assertStringIncludes(guide, "veryfront open --env staging");
    assertStringIncludes(guide, "Do not edit or publish directly from Studio `main`");
    assertStringIncludes(guide, "before anyone starts new Studio work");
    assertStringIncludes(guide, "supported text files only");
    assertStringIncludes(guide, "Binary images, fonts, archives");
    assertEquals(guide.includes("--quiet"), false);
    assertEquals(guide.includes("--release-name <previous>"), false);
  });

  it("uses an immutable release for the Studio-to-Git handoff", async () => {
    const guide = await Deno.readTextFile(
      "docs/guides/move-studio-changes-to-git.md",
    );

    assertStringIncludes(guide, "immutable release");
    assertStringIncludes(guide, "publish it to a non-production environment");
    assertStringIncludes(guide, "Open the Releases panel in Studio");
    assertStringIncludes(guide, ".veryfront/` in `.gitignore");
    assertStringIncludes(
      guide,
      'veryfront pull --release "$VERYFRONT_RELEASE" --prune --dry-run',
    );
    assertStringIncludes(guide, "Resolve conflicts in Git");
    assertStringIncludes(guide, "failure can leave a partial Git diff");
    assertStringIncludes(guide, "BASE_GIT_SHA");
    assertStringIncludes(guide, "gh pr create");
    assertStringIncludes(guide, "--base main");
    assertStringIncludes(guide, "full managed-source snapshot");
    assertStringIncludes(guide, "does not perform a three-way merge");
    assertStringIncludes(guide, "Do not edit");
    assertStringIncludes(guide, "directly from Studio `main`");
    assertStringIncludes(guide, "before anyone starts another Studio change");
    assertStringIncludes(guide, "--yes` and `--force` skip");
    assertStringIncludes(guide, "does not write or delete");
    assertStringIncludes(guide, "local files");
    assertStringIncludes(guide, "git merge origin/main");
    assertEquals(guide.includes("veryfront pull --branch"), false);
  });

  it("keeps the Phase 0 Pull safety contract in command help", async () => {
    const help = await Deno.readTextFile("cli/commands/pull/command-help.ts");

    assertStringIncludes(help, "full managed-source snapshot");
    assertStringIncludes(help, "does not perform a Git merge");
    assertStringIncludes(help, "--yes and --force skip confirmation only");
    assertStringIncludes(help, "never writes or deletes local files");
    assertStringIncludes(help, "preserves remote bytes exactly");
    assertStringIncludes(help, "symlink-traversing remote paths fail");
    assertStringIncludes(help, "A fetch failure causes no writes or pruning");
  });

  it("tracks Phase 0 release acceptance separately from public guides", async () => {
    const planPath = "docs/plans/2026-07-14-phase-0-git-handoff-acceptance.md";
    const plan = await Deno.readTextFile(planPath);
    const index = await Deno.readTextFile("docs/plans/README.md");

    assertStringIncludes(index, "Phase 0 Git handoff acceptance");
    assertStringIncludes(index, "Acceptance pending");
    assertStringIncludes(plan, "Compatibility baseline | `v0.1.1063`");
    assertStringIncludes(plan, "## A. Staging-first CI pilot");
    assertStringIncludes(plan, "## B. Studio release to Git pull request");
    assertStringIncludes(plan, "## C. Failure and recovery safety");
    assertStringIncludes(plan, "## D. Compatibility checks");
    assertStringIncludes(plan, "## E. Production promotion");
    assertStringIncludes(plan, "## Accepted Phase 0 limitations");
    assertStringIncludes(plan, "Do not mark this plan complete from unit-test counts alone");
  });

  it("never recommends exposing a secret to verify environment config", async () => {
    const guide = await Deno.readTextFile("docs/guides/configuration.md");

    assertStringIncludes(guide, "VERYFRONT_CONFIG_CHECK=enabled");
    assertStringIncludes(guide, "Never return API tokens");
    assertEquals(
      guide.includes('return `getEnv("VERYFRONT_API_TOKEN")`'),
      false,
    );
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
