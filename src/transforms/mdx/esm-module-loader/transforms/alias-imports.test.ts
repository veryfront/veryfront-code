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
});
