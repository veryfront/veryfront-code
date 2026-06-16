import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findRelativeImports, findVfModuleImports } from "./import-finder.ts";

describe("findVfModuleImports", () => {
  it("finds veryfront module imports", async () => {
    const code = `import { foo } from "/_vf_modules/_veryfront/utils.js";`;
    assertEquals(await findVfModuleImports(code), ["/_vf_modules/_veryfront/utils.js"]);
  });

  it("returns empty array when no vf imports", async () => {
    assertEquals(await findVfModuleImports(`import { x } from "./local.ts";`), []);
  });

  it("deduplicates repeated imports", async () => {
    const code = [
      `import { a } from "/_vf_modules/_veryfront/utils.js";`,
      `import { b } from "/_vf_modules/_veryfront/utils.js";`,
    ].join("\n");
    assertEquals(await findVfModuleImports(code), ["/_vf_modules/_veryfront/utils.js"]);
  });

  it("finds multiple distinct vf imports", async () => {
    const code = [
      `import { a } from "/_vf_modules/_veryfront/utils.js";`,
      `import { b } from "/_vf_modules/_veryfront/errors.js";`,
    ].join("\n");
    assertEquals((await findVfModuleImports(code)).length, 2);
  });

  it("does not match user project vf_modules paths", async () => {
    const code = `import { x } from "/_vf_modules/components/Foo.js";`;
    assertEquals(await findVfModuleImports(code), []);
  });

  it("handles minified code without spaces after from", async () => {
    const code = `import{foo}from"/_vf_modules/_veryfront/utils.js";`;
    assertEquals(await findVfModuleImports(code), ["/_vf_modules/_veryfront/utils.js"]);
  });

  it("handles single-quoted imports", async () => {
    const code = `import { foo } from '/_vf_modules/_veryfront/utils.js';`;
    assertEquals(await findVfModuleImports(code), ["/_vf_modules/_veryfront/utils.js"]);
  });

  it("does not match import-looking text in strings or comments", async () => {
    const code = `
      const text = 'from "/_vf_modules/_veryfront/utils.js"';
      // import { foo } from "/_vf_modules/_veryfront/commented.js";
    `;
    assertEquals(await findVfModuleImports(code), []);
  });
});

describe("findRelativeImports", () => {
  it("finds relative imports with ./", async () => {
    const code = `import { foo } from "./bar.ts";`;
    assertEquals(await findRelativeImports(code), ["./bar.ts"]);
  });

  it("finds relative imports with ../", async () => {
    const code = `import { foo } from "../bar.ts";`;
    assertEquals(await findRelativeImports(code), ["../bar.ts"]);
  });

  it("finds side-effect imports", async () => {
    const code = `import "./styles.css";`;
    assertEquals(await findRelativeImports(code), ["./styles.css"]);
  });

  it("ignores non-relative imports", async () => {
    assertEquals(await findRelativeImports(`import { x } from "react";`), []);
  });

  it("deduplicates", async () => {
    const code = `import { a } from "./x.ts";\nimport { b } from "./x.ts";`;
    assertEquals(await findRelativeImports(code), ["./x.ts"]);
  });

  it("finds both from and side-effect imports", async () => {
    const code = [
      `import { a } from "./utils.ts";`,
      `import "./styles.css";`,
    ].join("\n");
    assertEquals((await findRelativeImports(code)).length, 2);
  });

  it("handles single-quoted imports", async () => {
    const code = `import { foo } from '../bar.ts';`;
    assertEquals(await findRelativeImports(code), ["../bar.ts"]);
  });

  it("does not match import-looking text in strings or comments", async () => {
    const code = `
      const text = 'from "./fake.js"';
      // import "./commented.js";
    `;
    assertEquals(await findRelativeImports(code), []);
  });
});
