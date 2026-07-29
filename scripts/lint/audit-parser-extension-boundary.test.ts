import { assertEquals, assertStringIncludes } from "#std/assert";
import {
  collectParserExtensionSourceFiles,
  findUnauthorizedParserExtensionImports,
} from "./audit-parser-extension-boundary.ts";

const PARSER_ONLY = "@veryfront/ext-parser-parse5/parser-only";

Deno.test("parser extension boundary accepts only the exact owner and specifier pair", async () => {
  const issues = await findUnauthorizedParserExtensionImports([
    {
      path: "src/html/head-boundary.ts",
      content: `import { Locator } from "${PARSER_ONLY}";`,
    },
    {
      path: "src/html/other.ts",
      content: `import { Locator } from "${PARSER_ONLY}";`,
    },
    {
      path: "src/html/head-boundary.ts",
      content: 'import parser from "@veryfront/ext-parser-parse5";',
    },
    {
      path: "cli/main.ts",
      content: `await import("${PARSER_ONLY}");`,
    },
  ]);

  assertEquals(issues, [
    {
      path: "src/html/other.ts",
      line: 1,
      specifier: "@veryfront/ext-parser-parse5/parser-only",
    },
    {
      path: "src/html/head-boundary.ts",
      line: 1,
      specifier: "@veryfront/ext-parser-parse5",
    },
    {
      path: "cli/main.ts",
      line: 1,
      specifier: "@veryfront/ext-parser-parse5/parser-only",
    },
  ]);
});

Deno.test("parser extension boundary parses every supported source extension and import form", async () => {
  const issues = await findUnauthorizedParserExtensionImports([
    { path: "src/all.ts", content: `import "${PARSER_ONLY}";` },
    { path: "src/all.tsx", content: `import "${PARSER_ONLY}";` },
    { path: "src/all.mts", content: `import "${PARSER_ONLY}";` },
    { path: "src/all.cts", content: `import "${PARSER_ONLY}";` },
    { path: "src/all.js", content: `import "${PARSER_ONLY}";` },
    { path: "src/all.jsx", content: `import "${PARSER_ONLY}";` },
    { path: "src/all.mjs", content: `import "${PARSER_ONLY}";` },
    { path: "src/all.cjs", content: `require("${PARSER_ONLY}");` },
    {
      path: "src/syntax.ts",
      content: [
        "import {",
        "  Locator,",
        `} from "${PARSER_ONLY}";`,
        `export { Locator as HeadLocator } from "${PARSER_ONLY}";`,
        `export type { HTMLHeadLocator } from "${PARSER_ONLY}";`,
        `const stringDynamic = import("${PARSER_ONLY}");`,
        `const templateDynamic = import(\`${PARSER_ONLY}\`);`,
        `const commonJs = require("${PARSER_ONLY}");`,
        `const resolved = require.resolve("${PARSER_ONLY}");`,
        `import Parser = require("${PARSER_ONLY}");`,
        `import type { LocatorContract } from "${PARSER_ONLY}";`,
      ].join("\n"),
    },
  ]);

  assertEquals(issues, [
    { path: "src/all.ts", line: 1, specifier: PARSER_ONLY },
    { path: "src/all.tsx", line: 1, specifier: PARSER_ONLY },
    { path: "src/all.mts", line: 1, specifier: PARSER_ONLY },
    { path: "src/all.cts", line: 1, specifier: PARSER_ONLY },
    { path: "src/all.js", line: 1, specifier: PARSER_ONLY },
    { path: "src/all.jsx", line: 1, specifier: PARSER_ONLY },
    { path: "src/all.mjs", line: 1, specifier: PARSER_ONLY },
    { path: "src/all.cjs", line: 1, specifier: PARSER_ONLY },
    { path: "src/syntax.ts", line: 1, specifier: PARSER_ONLY },
    { path: "src/syntax.ts", line: 4, specifier: PARSER_ONLY },
    { path: "src/syntax.ts", line: 5, specifier: PARSER_ONLY },
    { path: "src/syntax.ts", line: 6, specifier: PARSER_ONLY },
    { path: "src/syntax.ts", line: 7, specifier: PARSER_ONLY },
    { path: "src/syntax.ts", line: 8, specifier: PARSER_ONLY },
    { path: "src/syntax.ts", line: 9, specifier: PARSER_ONLY },
    { path: "src/syntax.ts", line: 10, specifier: PARSER_ONLY },
    { path: "src/syntax.ts", line: 11, specifier: PARSER_ONLY },
  ]);
});

Deno.test("parser extension boundary rejects package, npm, and normalized relative aliases", async () => {
  const issues = await findUnauthorizedParserExtensionImports([
    {
      path: "src/html/head-boundary.ts",
      content: [
        'import "@veryfront/ext-parser-parse5";',
        'import "@veryfront/ext-parser-parse5/internal";',
        'import "npm:@veryfront/ext-parser-parse5";',
        'import "npm:@veryfront/ext-parser-parse5/parser-only";',
        'import "npm:@veryfront/ext-parser-parse5@7.3.0";',
        'import "npm:@veryfront/ext-parser-parse5@7.3.0/parser-only";',
        'import "../../src/../extensions/ext-parser-parse5/parser-only";',
      ].join("\n"),
    },
    {
      path: "src\\html\\nested\\..\\other.ts",
      content:
        'import "..\\\\..\\\\extensions\\\\ext-parser-parse5\\\\parser-only";',
    },
    {
      path: "cli/main.ts",
      content: 'import "../extensions/ext-parser-parse5/parser-only";',
    },
  ]);

  assertEquals(issues, [
    {
      path: "src/html/head-boundary.ts",
      line: 1,
      specifier: "@veryfront/ext-parser-parse5",
    },
    {
      path: "src/html/head-boundary.ts",
      line: 2,
      specifier: "@veryfront/ext-parser-parse5/internal",
    },
    {
      path: "src/html/head-boundary.ts",
      line: 3,
      specifier: "npm:@veryfront/ext-parser-parse5",
    },
    {
      path: "src/html/head-boundary.ts",
      line: 4,
      specifier: "npm:@veryfront/ext-parser-parse5/parser-only",
    },
    {
      path: "src/html/head-boundary.ts",
      line: 5,
      specifier: "npm:@veryfront/ext-parser-parse5@7.3.0",
    },
    {
      path: "src/html/head-boundary.ts",
      line: 6,
      specifier: "npm:@veryfront/ext-parser-parse5@7.3.0/parser-only",
    },
    {
      path: "src/html/head-boundary.ts",
      line: 7,
      specifier: "../../src/../extensions/ext-parser-parse5/parser-only",
    },
    {
      path: "src/html/other.ts",
      line: 1,
      specifier: "..\\..\\extensions\\ext-parser-parse5\\parser-only",
    },
    {
      path: "cli/main.ts",
      line: 1,
      specifier: "../extensions/ext-parser-parse5/parser-only",
    },
  ]);
});

Deno.test("parser extension boundary scans tests, benches, fixtures, generated files, and templates", async () => {
  const issues = await findUnauthorizedParserExtensionImports([
    { path: "src/html/page.test.ts", content: `import "${PARSER_ONLY}";` },
    { path: "src/html/page.bench.ts", content: `import "${PARSER_ONLY}";` },
    {
      path: "src/html/__fixtures__/page.ts",
      content: `import "${PARSER_ONLY}";`,
    },
    {
      path: "src/html/generated/page.generated.js",
      content: `import "${PARSER_ONLY}";`,
    },
    {
      path: "cli/templates/files/app.ts",
      content: `import "${PARSER_ONLY}";`,
    },
    { path: "cli/setup.ts", content: `import "${PARSER_ONLY}";` },
  ]);

  assertEquals(issues.map(({ path }) => path), [
    "src/html/page.test.ts",
    "src/html/page.bench.ts",
    "src/html/__fixtures__/page.ts",
    "src/html/generated/page.generated.js",
    "cli/templates/files/app.ts",
    "cli/setup.ts",
  ]);
});

Deno.test("parser extension boundary ignores opaque and non-code references", async () => {
  const issues = await findUnauthorizedParserExtensionImports([
    {
      path: "src/html/ignored.ts",
      content: [
        `// import "${PARSER_ONLY}";`,
        `const ordinary = "${PARSER_ONLY}";`,
        "const pattern = /@veryfront\\/ext-parser-parse5\\/parser-only/;",
        "const target = ordinary;",
        "import(target);",
        "import(`@veryfront/ext-parser-parse5/${target}`);",
        "require(target);",
        "require.resolve(target);",
        "function local(require: { resolve(value: string): unknown }) {",
        `  require("${PARSER_ONLY}");`,
        `  require.resolve("${PARSER_ONLY}");`,
        "}",
        "function shadowed() {",
        "  const require = (value: string) => value;",
        `  require("${PARSER_ONLY}");`,
        "}",
      ].join("\n"),
    },
  ]);

  assertEquals(issues, []);
});

Deno.test("parser extension boundary respects loop, class, and static-block require scopes", async () => {
  const issues = await findUnauthorizedParserExtensionImports([
    {
      path: "src/loop.ts",
      content: [
        "for (let require = (value: string) => value; false;) {",
        `  require("${PARSER_ONLY}");`,
        "}",
        `require("${PARSER_ONLY}");`,
      ].join("\n"),
    },
    {
      path: "src/static-block.ts",
      content: [
        "class Container {",
        "  static {",
        "    const require = (value: string) => value;",
        `    require("${PARSER_ONLY}");`,
        "  }",
        "}",
        `require("${PARSER_ONLY}");`,
      ].join("\n"),
    },
    {
      path: "src/named-class.ts",
      content: [
        "const Container = class require {",
        "  static {",
        `    require("${PARSER_ONLY}");`,
        "  }",
        "};",
        `require("${PARSER_ONLY}");`,
      ].join("\n"),
    },
  ]);

  assertEquals(issues, [
    { path: "src/loop.ts", line: 4, specifier: PARSER_ONLY },
    { path: "src/static-block.ts", line: 7, specifier: PARSER_ONLY },
    { path: "src/named-class.ts", line: 6, specifier: PARSER_ONLY },
  ]);
});

Deno.test("parser extension boundary ignores erased TypeScript require bindings", async () => {
  const issues = await findUnauthorizedParserExtensionImports([
    {
      path: "src/ambient-variable.ts",
      content: [
        "declare const require: (value: string) => unknown;",
        `require("${PARSER_ONLY}");`,
      ].join("\n"),
    },
    {
      path: "src/ambient-class.ts",
      content: [
        "declare class require {}",
        `require("${PARSER_ONLY}");`,
      ].join("\n"),
    },
    {
      path: "src/type-default-import.ts",
      content: [
        'import type require from "./types.ts";',
        `require("${PARSER_ONLY}");`,
      ].join("\n"),
    },
    {
      path: "src/type-named-import.ts",
      content: [
        'import { type require } from "./types.ts";',
        `require("${PARSER_ONLY}");`,
      ].join("\n"),
    },
  ]);

  assertEquals(issues, [
    { path: "src/ambient-variable.ts", line: 2, specifier: PARSER_ONLY },
    { path: "src/ambient-class.ts", line: 2, specifier: PARSER_ONLY },
    { path: "src/type-default-import.ts", line: 2, specifier: PARSER_ONLY },
    { path: "src/type-named-import.ts", line: 2, specifier: PARSER_ONLY },
  ]);
});

Deno.test("parser extension boundary treats type-only import-equals and ambient declarations as erased", async () => {
  const issues = await findUnauthorizedParserExtensionImports([
    {
      path: "src/type-import-equals.ts",
      content: [
        'import type require = require("node:module");',
        `require("${PARSER_ONLY}");`,
      ].join("\n"),
    },
    {
      path: "src/ambient-enum.ts",
      content: [
        "declare enum require { One }",
        `require("${PARSER_ONLY}");`,
      ].join("\n"),
    },
    {
      path: "src/ambient-namespace.ts",
      content: [
        "declare namespace require {}",
        `require("${PARSER_ONLY}");`,
      ].join("\n"),
    },
    {
      path: "src/ambient-module.ts",
      content: [
        "declare module require {}",
        `require("${PARSER_ONLY}");`,
      ].join("\n"),
    },
  ]);

  assertEquals(issues, [
    { path: "src/type-import-equals.ts", line: 2, specifier: PARSER_ONLY },
    { path: "src/ambient-enum.ts", line: 2, specifier: PARSER_ONLY },
    { path: "src/ambient-namespace.ts", line: 2, specifier: PARSER_ONLY },
    { path: "src/ambient-module.ts", line: 2, specifier: PARSER_ONLY },
  ]);
});

Deno.test("parser extension boundary recognizes runtime enum and namespace bindings", async () => {
  const issues = await findUnauthorizedParserExtensionImports([
    {
      path: "src/runtime-enum.ts",
      content: [
        "enum require { One }",
        `require("${PARSER_ONLY}");`,
      ].join("\n"),
    },
    {
      path: "src/runtime-namespace.ts",
      content: [
        "namespace require { export const one = 1; }",
        `require("${PARSER_ONLY}");`,
      ].join("\n"),
    },
    {
      path: "src/runtime-module.ts",
      content: [
        "module require { export const one = 1; }",
        `require("${PARSER_ONLY}");`,
      ].join("\n"),
    },
  ]);

  assertEquals(issues, []);
});

Deno.test("parser extension boundary reports every ECMAScript line terminator", async () => {
  const issues = await findUnauthorizedParserExtensionImports([
    {
      path: "src/carriage-return.ts",
      content: `export {};\rimport "${PARSER_ONLY}";`,
    },
    {
      path: "src/line-separator.ts",
      content: `export {};\u2028import "${PARSER_ONLY}";`,
    },
    {
      path: "src/paragraph-separator.ts",
      content: `export {};\u2029import "${PARSER_ONLY}";`,
    },
  ]);

  assertEquals(issues, [
    { path: "src/carriage-return.ts", line: 2, specifier: PARSER_ONLY },
    { path: "src/line-separator.ts", line: 2, specifier: PARSER_ONLY },
    { path: "src/paragraph-separator.ts", line: 2, specifier: PARSER_ONLY },
  ]);
});

Deno.test("parser extension collector walks both roots without exclusions", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/src/__fixtures__`, { recursive: true });
    await Deno.mkdir(`${root}/cli/templates`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/src/__fixtures__/seed.test.ts`,
      `import "${PARSER_ONLY}";`,
    );
    await Deno.writeTextFile(
      `${root}/src/__fixtures__/clean.tsx`,
      "export {};",
    );
    await Deno.writeTextFile(
      `${root}/src/__fixtures__/clean.mts`,
      "export {};",
    );
    await Deno.writeTextFile(
      `${root}/src/__fixtures__/clean.cts`,
      "export {};",
    );
    await Deno.writeTextFile(`${root}/cli/templates/clean.js`, "export {};");
    await Deno.writeTextFile(`${root}/cli/templates/clean.jsx`, "export {};");
    await Deno.writeTextFile(`${root}/cli/templates/clean.mjs`, "export {};");
    await Deno.writeTextFile(
      `${root}/cli/templates/clean.cjs`,
      "module.exports = {};",
    );
    await Deno.writeTextFile(`${root}/cli/templates/not-source.txt`, "ignored");

    const files = await collectParserExtensionSourceFiles(root);
    assertEquals(files.length, 8);
    assertEquals(files.map(({ path }) => path).sort(), [
      "cli/templates/clean.cjs",
      "cli/templates/clean.js",
      "cli/templates/clean.jsx",
      "cli/templates/clean.mjs",
      "src/__fixtures__/clean.cts",
      "src/__fixtures__/clean.mts",
      "src/__fixtures__/clean.tsx",
      "src/__fixtures__/seed.test.ts",
    ]);
    assertEquals(await findUnauthorizedParserExtensionImports(files), [
      {
        path: "src/__fixtures__/seed.test.ts",
        line: 1,
        specifier: "@veryfront/ext-parser-parse5/parser-only",
      },
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("parser extension boundary executable reports visited files and rejects zero-file scans", async () => {
  const projectRoot = new URL("../../", import.meta.url).pathname;
  const script =
    new URL("./audit-parser-extension-boundary.ts", import.meta.url)
      .pathname;
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/src`, { recursive: true });
    await Deno.mkdir(`${root}/cli`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/src/seed.ts`,
      `import "${PARSER_ONLY}";`,
    );
    await Deno.writeTextFile(`${root}/cli/clean.js`, "export {};");

    const seeded = await new Deno.Command(Deno.execPath(), {
      cwd: projectRoot,
      args: [
        "run",
        "--frozen",
        "--allow-read",
        `--config=${projectRoot}/deno.json`,
        script,
        root,
      ],
    }).output();
    assertEquals(seeded.code, 1);
    const seededError = new TextDecoder().decode(seeded.stderr);
    assertStringIncludes(seededError, "scanned 2 source files");
    assertStringIncludes(
      seededError,
      "src/seed.ts:1 imports @veryfront/ext-parser-parse5/parser-only",
    );

    await Deno.remove(`${root}/src/seed.ts`);
    await Deno.remove(`${root}/cli/clean.js`);
    const empty = await new Deno.Command(Deno.execPath(), {
      cwd: projectRoot,
      args: [
        "run",
        "--frozen",
        "--allow-read",
        `--config=${projectRoot}/deno.json`,
        script,
        root,
      ],
    }).output();
    assertEquals(empty.code, 1);
    assertStringIncludes(
      new TextDecoder().decode(empty.stderr),
      "scanned zero source files",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
