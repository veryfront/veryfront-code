import assert from "node:assert/strict";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "node:test";

import { resolve } from "./resolver-hooks.mjs";

const testsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = pathResolve(testsDir, "../..");

function parentContext(relativePath) {
  return { parentURL: pathToFileURL(pathResolve(projectRoot, relativePath)).href };
}

function rejectingNextResolve(specifier) {
  throw new Error(`Unexpected fallback resolution for ${specifier}`);
}

describe("Node resolver deno.json imports", () => {
  it("resolves extension-local relative aliases from the nearest deno.json", async () => {
    const result = await resolve(
      "veryfront/transforms/frontmatter",
      parentContext("extensions/ext-content-mdx/src/compiler/mdx-compile.ts"),
      rejectingNextResolve,
    );

    assert.equal(
      fileURLToPath(result.url),
      pathResolve(projectRoot, "src/transforms/mdx/compiler/frontmatter-extractor.ts"),
    );
  });

  it("resolves extension-local npm aliases without retaining the Deno version", async () => {
    const calls = [];
    const result = await resolve(
      "mdast",
      parentContext("extensions/ext-content-mdx/src/compiler/markdown-compile.ts"),
      (specifier) => {
        calls.push(specifier);
        return { url: `mock:${specifier}` };
      },
    );

    assert.deepEqual(calls, ["@types/mdast"]);
    assert.equal(result.url, "mock:@types/mdast");
  });

  it("maps nested esm.sh package aliases to the installed Node package", async () => {
    const calls = [];
    const result = await resolve(
      "@veryfront/react-upstream",
      parentContext("react/react.ts"),
      (specifier) => {
        calls.push(specifier);
        return { url: `mock:${specifier}` };
      },
    );

    assert.deepEqual(calls, ["react"]);
    assert.equal(result.url, "mock:react");
  });

  it("preserves exact and prefix matches from the root deno.json", async () => {
    const context = parentContext("src/transforms/mdx/index.ts");
    const exact = await resolve("#veryfront/errors", context, rejectingNextResolve);
    const prefix = await resolve("#veryfront/errors/types.ts", context, rejectingNextResolve);

    assert.equal(fileURLToPath(exact.url), pathResolve(projectRoot, "src/errors/index.ts"));
    assert.equal(fileURLToPath(prefix.url), pathResolve(projectRoot, "src/errors/types.ts"));
  });

  it("uses the longest matching import-map prefix", async () => {
    const result = await resolve(
      "fixture/specific/index",
      parentContext("tests/node/fixtures/resolver-import-map/importer.ts"),
      rejectingNextResolve,
    );

    assert.equal(fileURLToPath(result.url), pathResolve(projectRoot, "src/errors/index.ts"));
  });

  it("falls through on malformed percent-encoding in an esm.sh target", async () => {
    const calls = [];
    const specifier = "fixture/malformed";
    const result = await resolve(
      specifier,
      parentContext("tests/node/fixtures/resolver-import-map/importer.ts"),
      (receivedSpecifier) => {
        calls.push(receivedSpecifier);
        return { url: `mock:${receivedSpecifier}` };
      },
    );

    assert.deepEqual(calls, [specifier]);
    assert.equal(result.url, `mock:${specifier}`);
  });

  it("resolves generated JSR modules within the generated dependency root", async () => {
    const result = await resolve(
      "jsr:@std/yaml@1.1.0/parse",
      parentContext("src/security/http/middleware/config-loader.ts"),
      rejectingNextResolve,
    );

    assert.equal(
      fileURLToPath(result.url),
      pathResolve(projectRoot, "npm/esm/deps/jsr.io/@std/yaml/1.1.0/parse.js"),
    );
  });

  it("falls through instead of resolving JSR traversal segments", async () => {
    const specifier = "jsr:@std/yaml@../path/1.1.4/mod";
    const calls = [];
    const result = await resolve(
      specifier,
      parentContext("src/security/http/middleware/config-loader.ts"),
      (receivedSpecifier) => {
        calls.push(receivedSpecifier);
        return { url: `mock:${receivedSpecifier}` };
      },
    );

    assert.deepEqual(calls, [specifier]);
    assert.equal(result.url, `mock:${specifier}`);
  });
});
