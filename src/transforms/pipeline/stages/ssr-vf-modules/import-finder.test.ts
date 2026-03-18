import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findVfModuleImports, findRelativeImports } from "./import-finder.ts";

describe("findVfModuleImports", () => {
  it("finds veryfront module imports", () => {
    const code = `import { foo } from "/_vf_modules/_veryfront/utils.js";`;
    assertEquals(findVfModuleImports(code), ["/_vf_modules/_veryfront/utils.js"]);
  });

  it("returns empty array when no vf imports", () => {
    assertEquals(findVfModuleImports(`import { x } from "./local.ts";`), []);
  });

  it("deduplicates repeated imports", () => {
    const code = [
      `import { a } from "/_vf_modules/_veryfront/utils.js";`,
      `import { b } from "/_vf_modules/_veryfront/utils.js";`,
    ].join("\n");
    assertEquals(findVfModuleImports(code), ["/_vf_modules/_veryfront/utils.js"]);
  });

  it("finds multiple distinct vf imports", () => {
    const code = [
      `import { a } from "/_vf_modules/_veryfront/utils.js";`,
      `import { b } from "/_vf_modules/_veryfront/errors.js";`,
    ].join("\n");
    assertEquals(findVfModuleImports(code).length, 2);
  });

  it("does not match user project vf_modules paths", () => {
    const code = `import { x } from "/_vf_modules/components/Foo.js";`;
    assertEquals(findVfModuleImports(code), []);
  });

  it("handles minified code without spaces after from", () => {
    const code = `import{foo}from"/_vf_modules/_veryfront/utils.js";`;
    assertEquals(findVfModuleImports(code), ["/_vf_modules/_veryfront/utils.js"]);
  });

  it("handles single-quoted imports", () => {
    const code = `import { foo } from '/_vf_modules/_veryfront/utils.js';`;
    assertEquals(findVfModuleImports(code), ["/_vf_modules/_veryfront/utils.js"]);
  });
});

describe("findRelativeImports", () => {
  it("finds relative imports with ./", () => {
    const code = `import { foo } from "./bar.ts";`;
    assertEquals(findRelativeImports(code), ["./bar.ts"]);
  });

  it("finds relative imports with ../", () => {
    const code = `import { foo } from "../bar.ts";`;
    assertEquals(findRelativeImports(code), ["../bar.ts"]);
  });

  it("finds side-effect imports", () => {
    const code = `import "./styles.css";`;
    assertEquals(findRelativeImports(code), ["./styles.css"]);
  });

  it("ignores non-relative imports", () => {
    assertEquals(findRelativeImports(`import { x } from "react";`), []);
  });

  it("deduplicates", () => {
    const code = `import { a } from "./x.ts";\nimport { b } from "./x.ts";`;
    assertEquals(findRelativeImports(code), ["./x.ts"]);
  });

  it("finds both from and side-effect imports", () => {
    const code = [
      `import { a } from "./utils.ts";`,
      `import "./styles.css";`,
    ].join("\n");
    assertEquals(findRelativeImports(code).length, 2);
  });

  it("handles single-quoted imports", () => {
    const code = `import { foo } from '../bar.ts';`;
    assertEquals(findRelativeImports(code), ["../bar.ts"]);
  });
});
