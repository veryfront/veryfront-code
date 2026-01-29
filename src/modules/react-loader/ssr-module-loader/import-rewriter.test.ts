import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rewriteCrossProjectImport, rewriteLocalImports } from "./import-rewriter.ts";

describe("rewriteCrossProjectImport", () => {
  it("rewrites .tsx specifier to file:// path", () => {
    const code = `import { Foo } from "@acme/ui@1.0.0/@/components/Button.tsx";`;
    const result = rewriteCrossProjectImport(
      code,
      "@acme/ui@1.0.0/@/components/Button.tsx",
      "/tmp/cache/cross-project/Button.js",
    );
    assertEquals(result, `import { Foo } from "file:///tmp/cache/cross-project/Button.js";`);
  });

  it("rewrites .js version of .tsx specifier", () => {
    const code = `import { Foo } from "@acme/ui@1.0.0/@/components/Button.js";`;
    const result = rewriteCrossProjectImport(
      code,
      "@acme/ui@1.0.0/@/components/Button.tsx",
      "/tmp/cache/cross-project/Button.js",
    );
    assertEquals(result, `import { Foo } from "file:///tmp/cache/cross-project/Button.js";`);
  });

  it("rewrites multiple occurrences", () => {
    const code = [
      `import { A } from "@acme/ui@1.0.0/@/A.tsx";`,
      `import { B } from "@acme/ui@1.0.0/@/A.tsx";`,
    ].join("\n");
    const result = rewriteCrossProjectImport(
      code,
      "@acme/ui@1.0.0/@/A.tsx",
      "/tmp/A.js",
    );
    assertEquals(result.match(/file:\/\//g)?.length, 2);
  });

  it("handles specifiers with special regex characters", () => {
    const code = `import { X } from "pkg+foo(bar)";`;
    const result = rewriteCrossProjectImport(code, "pkg+foo(bar)", "/tmp/pkg.js");
    assertEquals(result, `import { X } from "file:///tmp/pkg.js";`);
  });

  it("handles single-quoted imports", () => {
    const code = `import { Foo } from 'my-pkg';`;
    const result = rewriteCrossProjectImport(code, "my-pkg", "/tmp/my-pkg.js");
    assertEquals(result, `import { Foo } from "file:///tmp/my-pkg.js";`);
  });

  it("leaves unrelated imports untouched", () => {
    const code = `import { Foo } from "react";\nimport { Bar } from "other";`;
    const result = rewriteCrossProjectImport(code, "react", "/tmp/react.js");
    assertEquals(result.includes(`from "other"`), true);
  });
});

describe("rewriteLocalImports", () => {
  const projectDir = "/project";

  it("returns unchanged code when map is empty", () => {
    const code = `import { A } from "./A.js";`;
    const result = rewriteLocalImports(code, new Map(), "/project/pages/index.tsx", projectDir);
    assertEquals(result, code);
  });

  it("rewrites @/ alias import from depth-1 directory", () => {
    // From pages/index.tsx, @/components/Button resolves to ../components/Button.js
    const map = new Map([["@/components/Button", "/tmp/Button.js"]]);
    const code = `import { Button } from "../components/Button.js";`;
    const result = rewriteLocalImports(code, map, "/project/pages/index.tsx", projectDir);
    assertEquals(result, `import { Button } from "file:///tmp/Button.js";`);
  });

  it("rewrites @/ alias import from root-level file", () => {
    // From root index.tsx, @/components/Button resolves to ./components/Button.js
    const map = new Map([["@/components/Button", "/tmp/Button.js"]]);
    const code = `import { Button } from "./components/Button.js";`;
    const result = rewriteLocalImports(code, map, "/project/index.tsx", projectDir);
    assertEquals(result, `import { Button } from "file:///tmp/Button.js";`);
  });

  it("rewrites @/ alias import from nested directory", () => {
    // From pages/blog/post.tsx (depth 2), @/utils/helpers resolves to ../../utils/helpers.js
    const map = new Map([["@/utils/helpers", "/tmp/helpers.js"]]);
    const code = `import { h } from "../../utils/helpers.js";`;
    const result = rewriteLocalImports(code, map, "/project/pages/blog/post.tsx", projectDir);
    assertEquals(result, `import { h } from "file:///tmp/helpers.js";`);
  });

  it("rewrites relative import (./)", () => {
    const map = new Map([["./sibling", "/tmp/sibling.js"]]);
    const code = `import { S } from "./sibling.js";`;
    const result = rewriteLocalImports(code, map, "/project/components/parent.tsx", projectDir);
    assertEquals(result, `import { S } from "file:///tmp/sibling.js";`);
  });

  it("rewrites relative import (../)", () => {
    const map = new Map([["../utils/log", "/tmp/log.js"]]);
    const code = `import { log } from "../utils/log.js";`;
    const result = rewriteLocalImports(code, map, "/project/components/Button.tsx", projectDir);
    assertEquals(result, `import { log } from "file:///tmp/log.js";`);
  });

  it("rewrites absolute path starting with projectDir", () => {
    // From pages/index.tsx, /project/lib/api.ts resolves to ../lib/api.js
    const map = new Map([["/project/lib/api.ts", "/tmp/api.js"]]);
    const code = `import { fetch } from "../lib/api.js";`;
    const result = rewriteLocalImports(code, map, "/project/pages/index.tsx", projectDir);
    assertEquals(result, `import { fetch } from "file:///tmp/api.js";`);
  });

  it("strips trailing slash from projectDir", () => {
    // From pages/index.tsx, @/utils/log resolves to ../utils/log.js
    const map = new Map([["@/utils/log", "/tmp/log.js"]]);
    const code = `import { log } from "../utils/log.js";`;
    const result = rewriteLocalImports(code, map, "/project/pages/index.tsx", "/project/");
    assertEquals(result, `import { log } from "file:///tmp/log.js";`);
  });

  it("rewrites .tsx extensions to .js in alias patterns", () => {
    // From pages/index.tsx, @/components/Card.tsx resolves to ../components/Card.js
    const map = new Map([["@/components/Card.tsx", "/tmp/Card.js"]]);
    const code = `import { Card } from "../components/Card.js";`;
    const result = rewriteLocalImports(code, map, "/project/pages/index.tsx", projectDir);
    assertEquals(result, `import { Card } from "file:///tmp/Card.js";`);
  });

  it("handles multiple imports in the same code", () => {
    const map = new Map([
      ["./A", "/tmp/A.js"],
      ["./B", "/tmp/B.js"],
    ]);
    const code = `import { A } from "./A.js";\nimport { B } from "./B.js";`;
    const result = rewriteLocalImports(code, map, "/project/src/index.tsx", projectDir);
    assertEquals(result.includes("file:///tmp/A.js"), true);
    assertEquals(result.includes("file:///tmp/B.js"), true);
  });
});
