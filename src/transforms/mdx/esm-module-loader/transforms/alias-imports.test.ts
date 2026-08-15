import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { FSAdapter } from "../types.ts";
import { transformModuleServerImports, transformProjectAliasImports } from "./alias-imports.ts";

class MemoryFs implements FSAdapter {
  readonly files = new Map<string, string>();

  constructor(files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
      this.files.set(path, content);
    }
  }

  readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`Missing file: ${path}`);
    return Promise.resolve(content);
  }

  mkdir(): Promise<void> {
    return Promise.resolve();
  }

  writeFile(path: string, content: string | Uint8Array): Promise<void> {
    this.files.set(path, typeof content === "string" ? content : new TextDecoder().decode(content));
    return Promise.resolve();
  }

  stat(path: string): Promise<{ isFile?: boolean } | null> {
    return Promise.resolve(this.files.has(path) ? { isFile: true } : null);
  }

  makeTempDir(prefix: string): Promise<string> {
    return Promise.resolve(`${prefix}-tmp`);
  }
}

describe("alias import transforms", () => {
  it("rewrites only real project alias imports", async () => {
    const fs = new MemoryFs({
      "components/Foo.js": `export default function Foo() { return null; }`,
    });
    const code = [
      `const text = 'from "@/components/Foo"';`,
      `// import Foo from "@/components/Commented";`,
      `import Foo from "@/components/Foo";`,
    ].join("\n");

    const result = await transformProjectAliasImports(code, fs, "/cache");

    assertStringIncludes(result, `const text = 'from "@/components/Foo"';`);
    assertStringIncludes(result, `// import Foo from "@/components/Commented";`);
    assertStringIncludes(result, `import Foo from "file:///cache/alias-`);
    assertEquals(fs.files.has("components/Commented.js"), false);
  });

  it("rewrites only real _vf_modules imports", async () => {
    const fs = new MemoryFs({
      "components/Foo.js": `export default function Foo() { return null; }`,
    });
    const code = [
      `const text = 'from "/_vf_modules/components/Foo.js"';`,
      `// import Foo from "/_vf_modules/components/Commented.js";`,
      `import Foo from "/_vf_modules/components/Foo.js?ssr=true";`,
    ].join("\n");

    const result = await transformModuleServerImports(code, fs, "/cache");

    assertStringIncludes(result, `const text = 'from "/_vf_modules/components/Foo.js"';`);
    assertStringIncludes(result, `// import Foo from "/_vf_modules/components/Commented.js";`);
    assertStringIncludes(result, `import Foo from "file:///cache/vfmod-`);
    assertEquals(fs.files.has("components/Commented.js"), false);
  });

  it("resolves alias paths that carry query and hash suffixes", async () => {
    const fs = new MemoryFs({
      "components/Foo.js": `export default function Foo() { return null; }`,
      "components/Bar.js": `export default function Bar() { return null; }`,
    });

    const projectAlias = await transformProjectAliasImports(
      `import Foo from "@/components/Foo.js?raw#hero";`,
      fs,
      "/cache",
    );
    const moduleAlias = await transformModuleServerImports(
      `import Bar from "/_vf_modules/components/Bar.js#client";`,
      fs,
      "/cache",
    );

    assertStringIncludes(projectAlias, `import Foo from "file:///cache/alias-`);
    assertStringIncludes(moduleAlias, `import Bar from "file:///cache/vfmod-`);
    assertEquals(fs.files.has("components/Foo.js"), true);
    assertEquals(fs.files.has("components/Bar.js"), true);
  });

  // The suffix is meaningless on a materialized `alias-<hash>.mjs` — `?raw` is
  // not honoured and cache busting is moot once the content is inlined. Carrying
  // it onto the emitted URL would give one source file two module records, and
  // therefore two copies of its module-level state.
  it("collapses suffixed and unsuffixed aliases of one file onto one module URL", async () => {
    const fs = new MemoryFs({
      "components/Card.js": `export default function Card() { return null; }`,
    });

    const result = await transformProjectAliasImports(
      `import Card from "@/components/Card.js";\n` +
        `import CardRaw from "@/components/Card.js?raw";\n` +
        `import CardFrag from "@/components/Card.js#hero";\n`,
      fs,
      "/cache",
    );

    const urls = [...result.matchAll(/"(file:\/\/\/cache\/alias-[^"]+)"/g)].map((match) =>
      match[1]
    );
    assertEquals(urls.length, 3);
    assertEquals(new Set(urls).size, 1);
    assertEquals(result.includes("?raw"), false);
    assertEquals(result.includes("#hero"), false);
  });
});
