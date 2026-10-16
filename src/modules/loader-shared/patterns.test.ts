import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import {
  EXPORT_FROM_PATTERN,
  JSX_IMPORT_PATTERN,
  PROJECT_ALIAS_IMPORT_PATTERN,
  REACT_IMPORT_PATTERN,
  STATIC_IMPORT_PATTERN,
} from "./patterns.ts";

Deno.test("shared import patterns retain default, namespace, multiline and side-effect bindings", () => {
  const source = `import React from "react";
import * as Namespace from "pkg";
import Default, {
  first as renamed,
  second,
} from "./module";
import "./setup";
export { first as renamed } from "./exports";`;
  assertEquals(
    [...source.matchAll(STATIC_IMPORT_PATTERN)].map((match) => match[1]),
    ["react", "pkg", "./module", "./setup"],
  );
  assertEquals([...source.matchAll(EXPORT_FROM_PATTERN)].map((match) => match[1]), ["./exports"]);
  assert(REACT_IMPORT_PATTERN.test(source));
  assert(REACT_IMPORT_PATTERN.test('import * as React from "react"'));
  assertEquals(
    [...('import View from "file:///app/View.tsx"').matchAll(JSX_IMPORT_PATTERN)][0]?.[2],
    "/app/View.tsx",
  );
  assertEquals(
    [...('import View from "@/View"').matchAll(PROJECT_ALIAS_IMPORT_PATTERN)][0]?.[2],
    "View",
  );
});

Deno.test("incomplete declarations do not repeatedly scan later import keywords", () => {
  const source = "import missing ".repeat(30_000);
  const start = performance.now();
  assertEquals([...source.matchAll(STATIC_IMPORT_PATTERN)], []);
  assertEquals([...source.matchAll(EXPORT_FROM_PATTERN)], []);
  assertEquals([...source.matchAll(JSX_IMPORT_PATTERN)], []);
  assertEquals([...source.matchAll(PROJECT_ALIAS_IMPORT_PATTERN)], []);
  assert(performance.now() - start < 2_000, "Malformed imports must complete within two seconds");
});

Deno.test("shared import patterns preserve comments in binding clauses", () => {
  const source = 'import { /* "quoted" (API) */ client } from "some-package";';
  assertEquals([...source.matchAll(STATIC_IMPORT_PATTERN)][0]?.[1], "some-package");
});

Deno.test("unterminated imports with repeated line comments do not backtrack exponentially", () => {
  const source = "import {\n" + "// comment\n".repeat(26);
  const multilinePattern = new RegExp(STATIC_IMPORT_PATTERN.source, "gmu");
  const start = performance.now();
  assertEquals([...source.matchAll(multilinePattern)], []);
  assert(performance.now() - start < 500, "Malformed line-comment imports must complete promptly");
});

Deno.test("shared import syntax admits Unicode, line comments and reserved-word exports", () => {
  const source = [
    'import { café } from "unicode-package";',
    "import { // API",
    "  client,",
    '} from "line-comment-package";',
    'import /* note */ { client } from "leading-comment-package";',
    'export { client as import } from "reserved-export-package";',
  ].join("\n");
  assertEquals([...source.matchAll(STATIC_IMPORT_PATTERN)].map((match) => match[1]), [
    "unicode-package",
    "line-comment-package",
    "leading-comment-package",
  ]);
  assertEquals([...source.matchAll(EXPORT_FROM_PATTERN)].map((match) => match[1]), [
    "reserved-export-package",
  ]);
});
