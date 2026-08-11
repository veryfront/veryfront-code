import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildIntegrationDirectory,
  buildUnknownIntegrationErrors,
  mergeIntegrationFiles,
  namespaceIntegrationTemplateFiles,
  resolveIntegrationModuleDir,
} from "./integration-loader-helpers.ts";

describe("templates/integration-loader-helpers", () => {
  it("resolves file module directories for unix and windows paths", () => {
    assertEquals(
      resolveIntegrationModuleDir(
        "file:///Users/test/veryfront-code/templates/integration-loader.ts",
      ),
      "/Users/test/veryfront-code/templates/",
    );
    assertEquals(
      resolveIntegrationModuleDir(
        "file:///C:/veryfront/templates/integration-loader.ts",
        "win32",
      ),
      "C:/veryfront/templates/",
    );
  });

  it("builds integration directories from the module directory", () => {
    assertEquals(
      buildIntegrationDirectory("/Users/test/veryfront-code/templates/", "github"),
      "/Users/test/veryfront-code/templates/integrations/github",
    );
  });

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
