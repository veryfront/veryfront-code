import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { bundleHttpImports, createHTTPPlugin, hasHttpImports } from "./http-bundler.ts";
import { describeHtmlModuleResponse } from "./http-cache-helpers.ts";
import { DEFAULT_REACT_VERSION } from "./react-cdn.ts";
import { MAX_BUNDLE_CHUNK_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";

type HttpOnLoadResult = {
  contents?: string;
  errors?: Array<{ text: string }>;
};

function captureHttpOnLoad(
  options: Parameters<typeof createHTTPPlugin>[0],
): (args: { path: string }) => Promise<HttpOnLoadResult> {
  let callback:
    | ((args: { path: string }) => Promise<HttpOnLoadResult> | HttpOnLoadResult)
    | undefined;
  const plugin = createHTTPPlugin(options);
  plugin.setup(
    {
      onResolve() {},
      onLoad(_filter: unknown, handler: typeof callback) {
        callback = handler;
      },
    } as unknown as Parameters<typeof plugin.setup>[0],
  );

  assert(callback);
  return async (args) => await callback!(args);
}

describe("transforms/esm/http-bundler", () => {
  describe("hasHttpImports", () => {
    it("returns true for code with https import", () => {
      assertEquals(hasHttpImports(`import React from "https://esm.sh/react@18";`), true);
    });

    it("returns true for code with http import", () => {
      assertEquals(hasHttpImports(`import lib from "http://cdn.com/lib.js";`), true);
    });

    it("returns true for single-quoted https import", () => {
      assertEquals(hasHttpImports(`import React from 'https://esm.sh/react@18';`), true);
    });

    it("returns false for code with no http imports", () => {
      assertEquals(hasHttpImports(`import React from "react";`), false);
    });

    it("returns false for empty string", () => {
      assertEquals(hasHttpImports(""), false);
    });

    it("returns false for http URL not in quotes", () => {
      assertEquals(hasHttpImports("// https://esm.sh/react"), false);
    });

    it("returns true for dynamic import with http URL", () => {
      assertEquals(hasHttpImports(`const m = import("https://esm.sh/react");`), true);
    });
  });

  describe("bundleHttpImports", () => {
    it("returns code unchanged when no http imports exist", () => {
      const code = `import React from "react";`;
      const result = bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(result, code);
    });

    it("adds external and target to esm.sh URLs", async () => {
      const code = `import lib from "https://esm.sh/lodash@4";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(typeof result, "string");
      assertEquals(
        result.includes("external=react,react-dom"),
        true,
        "react and react-dom must both be externalized so SSR keeps one React instance",
      );
      assertEquals(
        result.includes(
          `deps=react@${DEFAULT_REACT_VERSION},react-dom@${DEFAULT_REACT_VERSION}`,
        ),
        true,
        "esm.sh URLs must pin React dep versions",
      );
      assertEquals(result.includes("target=es2022"), true);
    });

    it("skips _vf_modules paths", async () => {
      const code = `import x from "https://esm.sh/react@18";\nimport y from "/_vf_modules/lib.js";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(
        result.includes('from "/_vf_modules/lib.js"'),
        true,
        "internal module path is emitted verbatim",
      );
      assertEquals(
        result.includes("esm.sh/_vf_modules"),
        false,
        "internal module paths are never rewritten to esm.sh",
      );
    });

    it("skips _veryfront paths", async () => {
      const code =
        `import x from "https://esm.sh/react@18";\nimport y from "/_veryfront/runtime.js";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(
        result.includes('from "/_veryfront/runtime.js"'),
        true,
        "internal runtime paths stay untouched",
      );
      assertEquals(
        result.includes("esm.sh/_veryfront/"),
        false,
        "internal runtime paths are never rewritten to esm.sh",
      );
    });

    it("does not add external to React package URLs", async () => {
      const code = `import React from "https://esm.sh/react@18";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(result.includes("external=react,react-dom"), false);
    });

    it("adds target to esm.sh React URLs without target", async () => {
      const code = `import React from "https://esm.sh/react@18";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(result.includes("target=es2022"), true);
    });

    it("converts relative esm.sh paths to full URLs", async () => {
      const code =
        `import lib from "https://esm.sh/lodash@4";\nimport chunk from "/lodash@4/chunk";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(result.includes("https://esm.sh/lodash@4/chunk"), true);
    });

    it("handles esm.veryfront.com URLs the same as esm.sh", async () => {
      const code = `import lib from "https://esm.veryfront.com/lodash@4";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(result.includes("external=react"), true);
    });

    it("does not modify non-esm.sh http URLs", async () => {
      const code = `import lib from "https://cdn.example.com/lib.js";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123");
      assertEquals(result, code, "non-esm.sh HTTP URLs must round-trip unchanged");
    });

    it("uses custom react version for deps param", async () => {
      const code = `import lib from "https://esm.sh/lodash@4";`;
      const result = await bundleHttpImports(code, "/tmp/cache", "abc123", "19.0.0");
      assertEquals(result.includes("react@19.0.0"), true);
    });
  });

  describe("createHTTPPlugin", () => {
    it("rejects and cancels an oversized module response", async () => {
      let cancelled = false;
      const onLoad = captureHttpOnLoad({
        timeoutMs: 1_000,
        fetchFn: (() =>
          Promise.resolve(
            new Response(
              new ReadableStream({
                cancel() {
                  cancelled = true;
                },
              }),
              {
                headers: {
                  "content-length": String(MAX_BUNDLE_CHUNK_SIZE_BYTES + 1),
                },
              },
            ),
          )) as typeof fetch,
      });

      const result = await onLoad({ path: "https://cdn.example/module.js" });

      assert(result.errors?.[0]?.text.includes("response exceeds"));
      assertEquals(cancelled, true);
    });

    it("reports an HTML module response without blaming esm.sh", async () => {
      const onLoad = captureHttpOnLoad({
        timeoutMs: 1_000,
        fetchFn: (() =>
          Promise.resolve(
            new Response("<!doctype html><html><title>ESM oops</title></html>", {
              headers: { "content-type": "text/html" },
            }),
          )) as typeof fetch,
      });

      const result = await onLoad({ path: "https://cdn.example/module.js" });

      assertEquals(
        result.errors?.[0]?.text,
        describeHtmlModuleResponse("https://cdn.example/module.js"),
        "HTML responses are reported by the shared diagnostic",
      );
      assertEquals(
        result.errors?.[0]?.text.includes("esm.sh"),
        false,
        "a non-esm.sh host is not blamed on esm.sh",
      );
      assertEquals(
        result.contents,
        undefined,
        "an HTML error page is never handed to the bundler as JavaScript",
      );
    });

    it("reports and cancels a failed module response", async () => {
      let cancelled = false;
      const onLoad = captureHttpOnLoad({
        timeoutMs: 1_000,
        fetchFn: (() =>
          Promise.resolve(
            new Response(
              new ReadableStream({
                cancel() {
                  cancelled = true;
                },
              }),
              { status: 502 },
            ),
          )) as typeof fetch,
      });

      const result = await onLoad({ path: "https://cdn.example/module.js" });

      assertEquals(
        result.errors?.[0]?.text,
        "Failed to fetch https://cdn.example/module.js: 502",
        "a non-ok response reports its status",
      );
      assertEquals(cancelled, true, "a non-ok response body is cancelled");
    });
  });
});
