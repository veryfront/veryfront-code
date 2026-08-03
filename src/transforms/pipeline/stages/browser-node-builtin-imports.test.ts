import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  browserNodeBuiltinImportsPlugin,
  rewriteNodeBuiltinNamedImports,
} from "./browser-node-builtin-imports.ts";
import type { TransformContext } from "../types.ts";

describe("browser-node-builtin-imports", () => {
  it("converts a named import into a namespace import plus destructure", async () => {
    const result = await rewriteNodeBuiltinNamedImports(
      `import { createHash } from "node:crypto";\nexport const h = () => createHash("sha256");`,
    );

    // The named binding no longer has to exist on the polyfill at link time.
    assertEquals(result.includes(`import { createHash } from "node:crypto"`), false);
    assertStringIncludes(result, `import * as __vf_node_builtin_0 from "node:crypto";`);
    assertStringIncludes(result, "const { createHash } = __vf_node_builtin_0;");
    // The call site is untouched, so failure happens there.
    assertStringIncludes(result, `createHash("sha256")`);
  });

  it("preserves aliases", async () => {
    const result = await rewriteNodeBuiltinNamedImports(
      `import { randomUUID as uuid } from "node:crypto";`,
    );
    assertStringIncludes(result, "const { randomUUID: uuid } = __vf_node_builtin_0;");
  });

  it("handles multiple bindings", async () => {
    const result = await rewriteNodeBuiltinNamedImports(
      `import { createHash, randomUUID } from "node:crypto";`,
    );
    assertStringIncludes(result, "const { createHash, randomUUID } = __vf_node_builtin_0;");
  });

  it("keeps a default binding alongside the namespace", async () => {
    const result = await rewriteNodeBuiltinNamedImports(
      `import crypto, { createHash } from "node:crypto";`,
    );
    assertStringIncludes(result, `import crypto from "node:crypto";`);
    assertStringIncludes(result, "const { createHash } = __vf_node_builtin_0;");
  });

  it("leaves a default-only import alone", async () => {
    const code = `import crypto from "node:crypto";\nexport const x = crypto;`;
    assertEquals(await rewriteNodeBuiltinNamedImports(code), code);
  });

  it("leaves a namespace import alone", async () => {
    const code = `import * as crypto from "node:crypto";`;
    assertEquals(await rewriteNodeBuiltinNamedImports(code), code);
  });

  it("leaves a side-effect-only import alone", async () => {
    const code = `import "node:crypto";`;
    assertEquals(await rewriteNodeBuiltinNamedImports(code), code);
  });

  it("leaves non-node imports alone", async () => {
    const code = `import { useState } from "react";`;
    assertEquals(await rewriteNodeBuiltinNamedImports(code), code);
  });

  it("numbers each rewritten import uniquely", async () => {
    const result = await rewriteNodeBuiltinNamedImports(
      `import { createHash } from "node:crypto";\nimport { join } from "node:path";`,
    );
    assertStringIncludes(result, "__vf_node_builtin_0");
    assertStringIncludes(result, "__vf_node_builtin_1");
  });

  // Regression: the stage used to look for " from ", which a production build
  // never contains, so every non-dev build kept the link-time failure.
  describe("minified input", () => {
    it("rewrites a minified named import", async () => {
      const result = await rewriteNodeBuiltinNamedImports(
        `import{createHash as h}from"node:crypto";export const x=()=>h("sha256");`,
      );

      assertStringIncludes(result, `import * as __vf_node_builtin_0 from "node:crypto";`);
      assertStringIncludes(result, "const { createHash: h } = __vf_node_builtin_0;");
      assertEquals(result.includes(`import{createHash as h}from"node:crypto"`), false);
    });

    it("rewrites a minified import with a default binding", async () => {
      const result = await rewriteNodeBuiltinNamedImports(
        `import c,{createHash}from"node:crypto";export const x=c;`,
      );

      assertStringIncludes(result, `import c from "node:crypto";`);
      assertStringIncludes(result, "const { createHash } = __vf_node_builtin_0;");
    });

    it("leaves a minified side-effect-only import alone", async () => {
      const code = `import"node:crypto";`;
      assertEquals(await rewriteNodeBuiltinNamedImports(code), code);
    });

    it("leaves a minified namespace import alone", async () => {
      const code = `import*as c from"node:crypto";export const x=c;`;
      assertEquals(await rewriteNodeBuiltinNamedImports(code), code);
    });

    it("rewrites both imports in a minified module", async () => {
      const result = await rewriteNodeBuiltinNamedImports(
        `import{createHash}from"node:crypto";import{join}from"node:path";`,
      );

      // Statements are rewritten back to front, so the numbering runs the same
      // way. Only uniqueness matters.
      assertStringIncludes(result, "const { createHash } = __vf_node_builtin_1;");
      assertStringIncludes(result, "const { join } = __vf_node_builtin_0;");
      assertStringIncludes(result, `import * as __vf_node_builtin_1 from "node:crypto";`);
      assertStringIncludes(result, `import * as __vf_node_builtin_0 from "node:path";`);
    });

    it("handles a single-quoted specifier", async () => {
      const result = await rewriteNodeBuiltinNamedImports(`import{createHash}from'node:crypto';`);
      assertStringIncludes(result, `import * as __vf_node_builtin_0 from "node:crypto";`);
      assertStringIncludes(result, "const { createHash } = __vf_node_builtin_0;");
    });
  });

  // Regression: the namespace name used to be generated blind, so a module that
  // already used it ended up with two bindings of the same name.
  describe("name collisions", () => {
    const declarationsOf = (code: string, name: string) =>
      code.match(new RegExp(`(?:const|let|var|as)\\s+${name}\\b`, "g"))?.length ?? 0;

    it("avoids a name the module already declares", async () => {
      const result = await rewriteNodeBuiltinNamedImports(
        `const __vf_node_builtin_0 = 1;\nimport { createHash } from "node:crypto";`,
      );

      assertEquals(declarationsOf(result, "__vf_node_builtin_0"), 1);
      assertStringIncludes(result, `import * as __vf_node_builtin__0 from "node:crypto";`);
      assertStringIncludes(result, "const { createHash } = __vf_node_builtin__0;");
      // The user's own binding survives untouched.
      assertStringIncludes(result, "const __vf_node_builtin_0 = 1;");
    });

    it("avoids a name the module already imports", async () => {
      const result = await rewriteNodeBuiltinNamedImports(
        `import { __vf_node_builtin_0 } from "./util.ts";\nimport { createHash } from "node:crypto";`,
      );

      assertStringIncludes(result, `import { __vf_node_builtin_0 } from "./util.ts";`);
      assertStringIncludes(result, `import * as __vf_node_builtin__0 from "node:crypto";`);
      assertStringIncludes(result, "const { createHash } = __vf_node_builtin__0;");
    });

    it("avoids a name aliased in by another import", async () => {
      const result = await rewriteNodeBuiltinNamedImports(
        `import { x as __vf_node_builtin_0 } from "./util.ts";\nimport { join } from "node:path";`,
      );

      assertEquals(declarationsOf(result, "__vf_node_builtin_0"), 1);
      assertStringIncludes(result, "const { join } = __vf_node_builtin__0;");
    });

    it("keeps stepping away until the name is free", async () => {
      const result = await rewriteNodeBuiltinNamedImports(
        `const __vf_node_builtin_0 = 1;\nconst __vf_node_builtin__9 = 2;\n` +
          `import { createHash } from "node:crypto";`,
      );

      assertStringIncludes(result, "const { createHash } = __vf_node_builtin___0;");
    });

    it("avoids a collision in minified source", async () => {
      const result = await rewriteNodeBuiltinNamedImports(
        `import{createHash as h}from"node:crypto";const __vf_node_builtin_0=1;export const x=()=>h(__vf_node_builtin_0);`,
      );

      assertEquals(declarationsOf(result, "__vf_node_builtin_0"), 1);
      assertStringIncludes(result, `import * as __vf_node_builtin__0 from "node:crypto";`);
      assertStringIncludes(result, "const { createHash: h } = __vf_node_builtin__0;");
    });

    it("keeps the numbering unique across imports once renamed", async () => {
      const result = await rewriteNodeBuiltinNamedImports(
        `const __vf_node_builtin_0 = 1;\nimport { createHash } from "node:crypto";\n` +
          `import { join } from "node:path";`,
      );

      assertStringIncludes(result, "const { join } = __vf_node_builtin__0;");
      assertStringIncludes(result, "const { createHash } = __vf_node_builtin__1;");
    });
  });

  it("only runs for the browser target", () => {
    const ctx = (target: "browser" | "ssr") => ({ code: "", target }) as TransformContext;
    assertEquals(browserNodeBuiltinImportsPlugin.condition?.(ctx("ssr")), false);
    assertEquals(browserNodeBuiltinImportsPlugin.condition?.(ctx("browser")), true);
  });
});

describe("browser-node-builtin-imports/real polyfills", () => {
  // node:async_hooks resolves to a polyfill that really does export
  // AsyncLocalStorage, so the named import links. Rewriting it to a destructure
  // moves the binding out of link position, and a cyclic graph that reads it at
  // evaluation time then throws "Cannot access before initialization".
  it("leaves a builtin backed by a real polyfill untouched", async () => {
    const code = [
      `import { AsyncLocalStorage } from "node:async_hooks";`,
      `export const store = new AsyncLocalStorage();`,
    ].join("\n");

    assertEquals(await rewriteNodeBuiltinNamedImports(code), code);
  });

  it("still rewrites a builtin that falls back to the noop", async () => {
    const code =
      `import { createHash } from "node:crypto";\nexport const h = () => createHash("sha256");`;

    const result = await rewriteNodeBuiltinNamedImports(code);

    assertStringIncludes(result, `import * as`);
    assertStringIncludes(result, `const { createHash }`);
  });
});
