import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildUnknownIntegrationErrors,
  mergeIntegrationFiles,
  namespaceIntegrationTemplateFiles,
  requiredSetupEnvVars,
} from "./integration-loader-helpers.ts";
import { ALL_AVAILABLE_INTEGRATIONS, loadIntegration } from "./integration-loader.ts";

describe("templates/integration-loader-helpers", () => {
  it("reports unknown integrations with a stable available list", () => {
    assertEquals(
      buildUnknownIntegrationErrors(
        ["github", "unknown"] as Array<"github" | "unknown"> as any,
        ["github", "slack"] as any,
      ),
      ["Unknown integration: unknown. Available: github, slack"],
    );
  });

  it("merges integration files into one sorted set", () => {
    const merged = mergeIntegrationFiles([
      {
        files: [
          { path: "lib/b.ts", content: "b" } as any,
          { path: "lib/a.ts", content: "a" } as any,
        ],
      },
      { files: [{ path: "lib/c.ts", content: "c" } as any] },
    ]);

    assertEquals(
      merged.map((file) => [file.path, file.content]),
      [["lib/a.ts", "a"], ["lib/b.ts", "b"], ["lib/c.ts", "c"]],
    );
  });

  it("refuses to merge two integrations that claim the same file path", () => {
    assertThrows(
      () =>
        mergeIntegrationFiles([
          { files: [{ path: "lib/a.ts", content: "old" } as any] },
          { files: [{ path: "lib/a.ts", content: "new" } as any] },
        ]),
      Error,
      "Integration template file collision at lib/a.ts",
    );
  });

  it("prefixes tool modules with the owning integration", () => {
    assertEquals(
      namespaceIntegrationTemplateFiles("github" as any, [
        { path: "tools/list-issues.ts", content: "t" } as any,
        { path: "lib/github-client.ts", content: "c" } as any,
      ]),
      [
        { path: "tools/github-list-issues.ts", content: "t" },
        { path: "lib/github-client.ts", content: "c" },
      ],
    );
  });

  it("moves provider env examples out of the generated root .env.example", () => {
    assertEquals(
      namespaceIntegrationTemplateFiles("drive" as any, [
        { path: ".env.example", content: "e" } as any,
      ]),
      [{ path: "examples/env/drive.env.example", content: "e" }],
    );
  });

  it("rejects nested tool paths and unsafe namespaces", () => {
    assertThrows(
      () =>
        namespaceIntegrationTemplateFiles("github" as any, [
          { path: "tools/nested/thing.ts", content: "t" } as any,
        ]),
      Error,
      "Integration tool paths must be direct children of tools/",
    );
    assertThrows(
      () => namespaceIntegrationTemplateFiles("../evil" as any, []),
      Error,
      "Invalid integration template namespace",
    );
  });
});

describe("integration scaffold env contract", () => {
  it("requires only env vars an env-backed scaffold's own client reads", async () => {
    const unread: string[] = [];
    for (const name of ALL_AVAILABLE_INTEGRATIONS) {
      const integration = await loadIntegration(name);
      if (!integration?.files.length) continue;
      const required = requiredSetupEnvVars(integration);
      if (!required) continue;
      const source = integration.files
        .filter((file) => /^(lib|tools)\//.test(file.path))
        .map((file) => file.content)
        .join("\n");
      unread.push(
        ...required.filter((envVar) => !source.includes(envVar)).map((v) => `${name}:${v}`),
      );
    }

    assertEquals(unread, []);
  });
});
