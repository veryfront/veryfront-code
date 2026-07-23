import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { fetchModuleViaHTTP } from "./http-fetcher.ts";
import { MAX_HTTP_MODULE_RESPONSE_BYTES } from "#veryfront/transforms/shared/http-module-response.ts";

describe("module-fetcher/http-fetcher", () => {
  it("rewrites the matched import instead of the same text in an earlier comment", async () => {
    const originalFetch = globalThis.fetch;
    const logger = { debug: () => {}, warn: () => {} } as unknown as Logger;
    const adapter = {
      env: {
        get(key: string) {
          if (key === "VERYFRONT_DEV_PORT") return "3001";
          return undefined;
        },
      },
    } as RuntimeAdapter;

    try {
      globalThis.fetch = async () =>
        new Response([
          `// Previous example: from "./local.js"`,
          `import local from "./local.js";`,
          `export { local };`,
        ].join("\n"));

      const result = await fetchModuleViaHTTP(
        "_vf_modules/pages/index.js",
        adapter,
        (path) => Promise.resolve(`/cache/${path.replaceAll("/", "__")}.mjs`),
        logger,
        "docs",
        true,
      );

      assertEquals(
        result,
        [
          `// Previous example: from "./local.js"`,
          `import local from "file:///cache/.__local.js.mjs";`,
          `export { local };`,
        ].join("\n"),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects invalid ports before making a request", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      return Promise.resolve(new Response(""));
    }) as typeof fetch;
    const logger = { debug: () => {}, warn: () => {} } as unknown as Logger;
    const adapter = {
      env: { get: () => "not-a-port" },
    } as unknown as RuntimeAdapter;

    try {
      const result = await fetchModuleViaHTTP(
        "_vf_modules/pages/index.js",
        adapter,
        () => Promise.resolve(null),
        logger,
        "docs",
        true,
      );

      assertEquals(result, null);
      assertEquals(fetchCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects unsafe module paths before making a request", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      return Promise.resolve(new Response(""));
    }) as typeof fetch;
    const logger = { debug: () => {}, warn: () => {} } as unknown as Logger;
    const adapter = {
      env: { get: () => "3001" },
    } as unknown as RuntimeAdapter;

    try {
      const result = await fetchModuleViaHTTP(
        "../private.js?token=secret-value",
        adapter,
        () => Promise.resolve(null),
        logger,
        "docs",
        true,
      );

      assertEquals(result, null);
      assertEquals(fetchCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns null for oversized responses", async () => {
    const originalFetch = globalThis.fetch;
    const logger = { debug: () => {}, warn: () => {} } as unknown as Logger;
    const adapter = {
      env: { get: () => "3001" },
    } as unknown as RuntimeAdapter;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("body", {
          headers: { "content-length": String(MAX_HTTP_MODULE_RESPONSE_BYTES + 1) },
        }),
      )) as typeof fetch;

    try {
      assertEquals(
        await fetchModuleViaHTTP(
          "_vf_modules/pages/index.js",
          adapter,
          () => Promise.resolve(null),
          logger,
          "docs",
          true,
        ),
        null,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("redacts request and network error details", async () => {
    const originalFetch = globalThis.fetch;
    const logEntries: string[] = [];
    const logger = {
      debug: (...args: unknown[]) => logEntries.push(JSON.stringify(args)),
      warn: (...args: unknown[]) => logEntries.push(JSON.stringify(args)),
    } as unknown as Logger;
    const adapter = {
      env: { get: () => "3001" },
    } as unknown as RuntimeAdapter;
    globalThis.fetch = (() =>
      Promise.reject(
        new Error("request failed for private-module.js?token=secret-value"),
      )) as typeof fetch;

    try {
      const result = await fetchModuleViaHTTP(
        "_vf_modules/pages/private-module.js",
        adapter,
        () => Promise.resolve(null),
        logger,
        "private-project",
        true,
      );

      assertEquals(result, null);
      const output = logEntries.join("\n");
      assertEquals(output.includes("secret-value"), false);
      assertEquals(output.includes("private-module.js"), false);
      assertEquals(output.includes("private-project"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects fallback modules with excessive import fan-out", async () => {
    const originalFetch = globalThis.fetch;
    const logger = { debug: () => {}, warn: () => {} } as unknown as Logger;
    const adapter = {
      env: { get: () => "3001" },
    } as unknown as RuntimeAdapter;
    const imports = Array.from(
      { length: 600 },
      (_, index) => `import value${index} from "./dependency-${index}.js";`,
    ).join("\n");
    globalThis.fetch = (() => Promise.resolve(new Response(imports))) as typeof fetch;
    let nestedFetches = 0;

    try {
      const result = await fetchModuleViaHTTP(
        "_vf_modules/pages/index.js",
        adapter,
        () => {
          nestedFetches += 1;
          return Promise.resolve(null);
        },
        logger,
        "docs",
        true,
      );

      assertEquals(result, null);
      assertEquals(nestedFetches, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
