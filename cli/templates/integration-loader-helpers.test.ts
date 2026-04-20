import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildIntegrationDirectory,
  buildUnknownIntegrationErrors,
  mergeIntegrationFiles,
  resolveIntegrationModuleDir,
} from "./integration-loader-helpers.ts";

describe("cli/templates/integration-loader-helpers", () => {
  it("resolves file module directories for unix and windows paths", () => {
    assertEquals(
      resolveIntegrationModuleDir(
        "file:///Users/test/veryfront-code/cli/templates/integration-loader.ts",
      ),
      "/Users/test/veryfront-code/cli/templates/",
    );
    assertEquals(
      resolveIntegrationModuleDir(
        "file:///C:/veryfront/cli/templates/integration-loader.ts",
        "win32",
      ),
      "C:/veryfront/cli/templates/",
    );
  });

  it("builds integration directories from the module directory", () => {
    assertEquals(
      buildIntegrationDirectory("/Users/test/veryfront-code/cli/templates/", "github"),
      "/Users/test/veryfront-code/cli/templates/integrations/github",
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

  it("merges integration files with later files overriding earlier ones", () => {
    const merged = mergeIntegrationFiles([
      {
        files: [
          { path: "lib/a.ts", content: "old" } as any,
          { path: "lib/b.ts", content: "b" } as any,
        ],
      },
      { files: [{ path: "lib/a.ts", content: "new" } as any] },
    ]);

    assertEquals(
      merged.map((file) => [file.path, file.content]),
      [["lib/a.ts", "new"], ["lib/b.ts", "b"]],
    );
  });
});
