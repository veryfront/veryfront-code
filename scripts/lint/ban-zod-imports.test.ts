import { assertEquals } from "#std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { findIllegalZodImports, shouldCheckZodImportPath } from "./ban-zod-imports.ts";

describe("findIllegalZodImports", () => {
  it("flags imports of zod outside extensions/ext-schema-zod", () => {
    const files = [
      { path: "src/foo.ts", content: 'import { z } from "zod";' },
      { path: "extensions/ext-schema-zod/src/adapter.ts", content: 'import { z } from "zod";' },
      { path: "src/bar.ts", content: 'import { defineSchema } from "veryfront/schemas";' },
    ];
    const result = findIllegalZodImports(files);
    assertEquals(result.map((r) => r.path), ["src/foo.ts"]);
  });

  it("ignores zod references in string literals (non-import lines)", () => {
    const files = [
      { path: "src/test.ts", content: "const code = 'import { z } from \"zod\";';" },
    ];
    const result = findIllegalZodImports(files);
    assertEquals(result.length, 0);
  });

  it("catches type-only imports of zod", () => {
    const files = [
      { path: "src/types.ts", content: 'import type { z } from "zod";' },
    ];
    const result = findIllegalZodImports(files);
    assertEquals(result.length, 1);
  });

  it("catches direct npm zod imports", () => {
    const files = [
      { path: "src/types.ts", content: 'import { z } from "npm:zod@4.3.6";' },
    ];
    const result = findIllegalZodImports(files);
    assertEquals(result.length, 1);
  });

  it("catches multiline zod imports", () => {
    const files = [
      {
        path: "src/types.ts",
        content: `import {
  z,
  type ZodSchema,
} from "zod";
`,
      },
    ];
    const result = findIllegalZodImports(files);
    assertEquals(result, [{ path: "src/types.ts", line: 1 }]);
  });

  it("catches side-effect zod imports", () => {
    const files = [
      { path: "src/setup.ts", content: 'import "zod";' },
    ];
    const result = findIllegalZodImports(files);
    assertEquals(result, [{ path: "src/setup.ts", line: 1 }]);
  });

  it("catches type-only dynamic zod imports", () => {
    const files = [
      { path: "src/types.ts", content: 'type Schema = import("zod").ZodSchema;' },
    ];
    const result = findIllegalZodImports(files);
    assertEquals(result.length, 1);
  });

  it("scans source and cli implementation files only", () => {
    assertEquals(shouldCheckZodImportPath("src/tool/factory.ts"), true);
    assertEquals(shouldCheckZodImportPath("cli/shared/args.ts"), true);
    assertEquals(shouldCheckZodImportPath("extensions/ext-schema-zod/src/adapter.ts"), false);
    assertEquals(shouldCheckZodImportPath("cli/templates/files/ai-agent/tools/search.ts"), false);
    assertEquals(shouldCheckZodImportPath("npm/src/src/tool/factory.ts"), false);
    assertEquals(shouldCheckZodImportPath("projects/demo/tools/search.ts"), false);
    assertEquals(shouldCheckZodImportPath("tests/docs/guide-examples.test.ts"), false);
  });
});
