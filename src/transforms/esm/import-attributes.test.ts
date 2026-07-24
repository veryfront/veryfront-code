import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { stripJsonImportAttributes, upgradeImportAssertions } from "./import-attributes.ts";

describe("upgradeImportAssertions", () => {
  it("rewrites a static assertion clause", async () => {
    assertEquals(
      await upgradeImportAssertions(`import m from "./a.json" assert { type: "json" };`),
      `import m from "./a.json" with { type: "json" };`,
    );
  });

  it("rewrites an assertion clause on a re-export", async () => {
    assertEquals(
      await upgradeImportAssertions(`export { a } from "./a.json" assert { type: "json" };`),
      `export { a } from "./a.json" with { type: "json" };`,
    );
  });

  it("rewrites an assertion clause on a bare side-effect import", async () => {
    assertEquals(
      await upgradeImportAssertions(`import "./a.json" assert { type: "json" };`),
      `import "./a.json" with { type: "json" };`,
    );
  });

  it("rewrites the assertion key of a dynamic import", async () => {
    assertEquals(
      await upgradeImportAssertions(
        `const load = () => import("./a.json", { assert: { type: "json" } });`,
      ),
      `const load = () => import("./a.json", { with: { type: "json" } });`,
    );
  });

  it("rewrites minified output that carries no whitespace", async () => {
    assertEquals(
      await upgradeImportAssertions(`import m from"./a.json"assert{type:"json"};`),
      `import m from"./a.json"with{type:"json"};`,
    );
  });

  it("rewrites every assertion in the module", async () => {
    assertEquals(
      await upgradeImportAssertions(
        `import a from "./a.json" assert { type: "json" };\n` +
          `import b from "./b.json" assert { type: "json" };\n`,
      ),
      `import a from "./a.json" with { type: "json" };\n` +
        `import b from "./b.json" with { type: "json" };\n`,
    );
  });

  it("leaves an attribute clause that already uses the current spelling", async () => {
    const code = `import m from "./a.json" with { type: "json" };`;
    assertEquals(await upgradeImportAssertions(code), code);
  });

  it("leaves module source embedded in a string literal alone", async () => {
    const code = 'export const TPL = `import d from "./a.json" assert { type: "json" };`;';
    assertEquals(await upgradeImportAssertions(code), code);
  });

  it("leaves an assert call that follows an import alone", async () => {
    const code = `import { assert } from "./assert.js";\nassert (true);\n`;
    assertEquals(await upgradeImportAssertions(code), code);
  });

  it("keeps positions correct when the module also imports over HTTP", async () => {
    const code = `import "https://esm.sh/react@19.1.1";\n` +
      `import m from "./a.json" assert { type: "json" };\n`;

    assertEquals(
      await upgradeImportAssertions(code),
      `import "https://esm.sh/react@19.1.1";\n` +
        `import m from "./a.json" with { type: "json" };\n`,
    );
  });
});

describe("stripJsonImportAttributes", () => {
  const stripAll = (code: string) => stripJsonImportAttributes(code, () => true);

  it("removes the clause from a static import", async () => {
    assertEquals(
      await stripAll(`import m from "./a.mjs" with { type: "json" };`),
      `import m from "./a.mjs";`,
    );
  });

  it("removes the options argument from a dynamic import", async () => {
    assertEquals(
      await stripAll(`const load = () => import("./a.mjs", { with: { type: "json" } });`),
      `const load = () => import("./a.mjs");`,
    );
  });

  it("only touches specifiers the predicate accepts", async () => {
    const code = `import a from "./a.mjs" with { type: "json" };\n` +
      `import b from "./b.json" with { type: "json" };\n`;

    assertEquals(
      await stripJsonImportAttributes(code, (specifier) => specifier.endsWith(".mjs")),
      `import a from "./a.mjs";\n` +
        `import b from "./b.json" with { type: "json" };\n`,
    );
  });

  it("keeps an attribute that is not a json type", async () => {
    const code = `import m from "./a.mjs" with { type: "css" };`;
    assertEquals(await stripAll(code), code);
  });

  it("keeps a clause that declares more than the json type", async () => {
    const code = `import m from "./a.mjs" with { type: "json", integrity: "sha384-abc" };`;
    assertEquals(await stripAll(code), code);
  });

  it("leaves module source embedded in a string literal alone", async () => {
    const code = 'export const TPL = `import d from "./a.mjs" with { type: "json" };`;';
    assertEquals(await stripAll(code), code);
  });

  it("keeps positions correct when the module also imports over HTTP", async () => {
    const code = `import "https://esm.sh/react@19.1.1";\n` +
      `import m from "./a.mjs" with { type: "json" };\n`;

    assertEquals(
      await stripAll(code),
      `import "https://esm.sh/react@19.1.1";\nimport m from "./a.mjs";\n`,
    );
  });
});
