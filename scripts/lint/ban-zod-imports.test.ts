import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { findIllegalZodImports } from "./ban-zod-imports.ts";

describe("findIllegalZodImports", () => {
  it("flags imports of zod outside extensions/ext-zod", () => {
    const files = [
      { path: "src/foo.ts", content: 'import { z } from "zod";' },
      { path: "extensions/ext-zod/src/adapter.ts", content: 'import { z } from "zod";' },
      { path: "src/bar.ts", content: 'import { defineSchema } from "veryfront/schemas";' },
    ];
    const result = findIllegalZodImports(files);
    assertEquals(result.map((r) => r.path), ["src/foo.ts"]);
  });

  it("ignores zod references in string literals (non-import lines)", () => {
    const files = [
      { path: "src/test.ts", content: 'const code = \'import { z } from "zod";\';' },
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
});
