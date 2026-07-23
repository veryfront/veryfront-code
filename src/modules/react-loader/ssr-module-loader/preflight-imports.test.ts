import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { FRAMEWORK_SRC_DIR } from "#veryfront/platform/compat/framework-source-resolver.ts";
import type { LocalImport } from "#veryfront/transforms/esm/import-parser.ts";
import { preflightLocalImports } from "./preflight-imports.ts";

describe("modules/react-loader/ssr-module-loader/preflight-imports", () => {
  it("keeps non-absolute imports without fs checks", async () => {
    const imports: LocalImport[] = [{ specifier: "./local", absolutePath: "relative/path.ts" }];

    let statCalls = 0;
    const fs = {
      stat: (_path: string) => {
        statCalls++;
        return Promise.resolve({ isFile: true });
      },
    };

    const result = await preflightLocalImports(imports, "/project/pages/index.tsx", fs);
    assertEquals(result.validImports, imports);
    assertEquals(result.missingImports, []);
    assertEquals(statCalls, 0);
  });

  it("marks absolute imports missing when not a file or inaccessible", async () => {
    const imports: LocalImport[] = [
      { specifier: "./a", absolutePath: "/project/a.ts" },
      { specifier: "./b", absolutePath: "/project/b.ts" },
      { specifier: "./c", absolutePath: "/project/c.ts" },
    ];

    const fs = {
      stat: (path: string) => {
        if (path.endsWith("/a.ts")) return Promise.resolve({ isFile: true });
        if (path.endsWith("/b.ts")) return Promise.resolve({ isFile: false });
        return Promise.reject(new Error("not found"));
      },
    };

    const result = await preflightLocalImports(imports, "/project/pages/index.tsx", fs);
    assertEquals(result.validImports, [{ specifier: "./a", absolutePath: "/project/a.ts" }]);
    assertEquals(result.missingImports.length, 2);
    assertEquals(result.missingImports[0]?.reason.includes("not a file on disk"), true);
    assertEquals(result.missingImports[1]?.reason.includes("dependency is not accessible"), true);
  });

  it("checks framework source imports with the local filesystem", async () => {
    const frameworkCorePath = join(FRAMEWORK_SRC_DIR, "react/runtime/core.ts");
    const imports: LocalImport[] = [
      { specifier: "../runtime/core.ts", absolutePath: frameworkCorePath },
    ];

    let projectFsStatCalls = 0;
    const projectFs = {
      stat: (_path: string) => {
        projectFsStatCalls++;
        return Promise.reject(new Error("project fs cannot stat framework source"));
      },
    };

    const result = await preflightLocalImports(
      imports,
      join(FRAMEWORK_SRC_DIR, "react/router/index.tsx"),
      projectFs,
    );

    assertEquals(result.validImports, imports);
    assertEquals(result.missingImports, []);
    assertEquals(projectFsStatCalls, 0);
  });
});
