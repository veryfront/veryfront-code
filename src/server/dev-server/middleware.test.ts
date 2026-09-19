import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  getCurrentRequestContext,
  runWithRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { loadMiddlewareFile } from "./middleware.ts";

type FileAccess = "exists" | "stat" | "read";

function createVirtualAdapter(
  source: string | undefined,
  filesOrOnFileAccess: Record<string, string> | ((operation: FileAccess) => void) = {},
  onFileAccess?: (operation: FileAccess) => void,
): RuntimeAdapter {
  const files = typeof filesOrOnFileAccess === "function" ? {} : filesOrOnFileAccess;
  const fileAccess = typeof filesOrOnFileAccess === "function" ? filesOrOnFileAccess : onFileAccess;
  const isFile = (path: string) =>
    (source !== undefined && path.endsWith("/middleware.ts")) || Object.hasOwn(files, path);
  // Like the production adapters, directories exist but are not files.
  const isDirectory = (path: string) =>
    Object.keys(files).some((file) => file.startsWith(`${path}/`));
  const fs = {
    getUnderlyingAdapter: () => fs,
    getAdapterType: () => "MultiProjectFSAdapter",
    isVeryfrontAdapter: () => true,
    isMultiProjectMode: () => true,
    exists: (path: string) => {
      fileAccess?.("exists");
      return Promise.resolve(isFile(path) || isDirectory(path));
    },
    stat: (path: string) => {
      fileAccess?.("stat");
      if (!isFile(path) && !isDirectory(path)) return Promise.reject(new Error("not found"));
      return Promise.resolve({
        isFile: isFile(path),
        isDirectory: !isFile(path),
        isSymlink: false,
      });
    },
    readFile: (path: string) => {
      fileAccess?.("read");
      if (isDirectory(path)) return Promise.reject(new Error(`EISDIR: ${path}`));
      return Promise.resolve(files[path] ?? source ?? "");
    },
  } as unknown as RuntimeAdapter["fs"];

  return {
    id: "test",
    name: "test",
    capabilities: {},
    fs,
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      has: () => false,
      toObject: () => ({}),
    },
    server: {} as RuntimeAdapter["server"],
    serve: () => Promise.resolve({ close: () => Promise.resolve() }),
  } as unknown as RuntimeAdapter;
}

describe("loadMiddlewareFile", () => {
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("rejects remote middleware before reading or evaluating project source", async () => {
    const marker = `__vf_middleware_isolation_${crypto.randomUUID().replaceAll("-", "")}`;
    const host = globalThis as unknown as Record<string, unknown>;
    let sourceReads = 0;
    const adapter = createVirtualAdapter(
      `globalThis.${marker} = Deno.env.get("HOST_SECRET"); export default [];`,
      (operation) => {
        if (operation === "read") sourceReads++;
      },
    );

    try {
      await assertRejects(
        () => loadMiddlewareFile("/app", adapter, { throwOnError: true }),
        TypeError,
        "requires explicit trusted-local execution",
      );
      assertEquals(sourceReads, 0);
      assertEquals(host[marker], undefined);
    } finally {
      delete host[marker];
    }
  });

  it("allows shared runtimes to establish that no middleware exists", async () => {
    let sourceReads = 0;
    const adapter = createVirtualAdapter(undefined, (operation) => {
      if (operation === "read") sourceReads++;
    });

    assertEquals(await loadMiddlewareFile("/app", adapter), []);
    assertEquals(sourceReads, 0);
  });

  it("fails closed for invalid production middleware", async () => {
    const adapter = createVirtualAdapter("export default function broken( {");

    await assertRejects(
      () =>
        loadMiddlewareFile("/app", adapter, {
          throwOnError: true,
          allowHostProjectCodeExecution: true,
        }),
      Error,
    );
  });

  it("fails closed when production middleware has no valid default export", async () => {
    const adapter = createVirtualAdapter("export const middleware = () => new Response('ok');");

    await assertRejects(
      () =>
        loadMiddlewareFile("/app", adapter, {
          throwOnError: true,
          allowHostProjectCodeExecution: true,
        }),
      TypeError,
      "Invalid middleware export",
    );
  });

  it("fails closed when a production middleware array contains invalid entries", async () => {
    const adapter = createVirtualAdapter(
      "export default [() => new Response('ok'), 'invalid'];",
    );

    await assertRejects(
      () =>
        loadMiddlewareFile("/app", adapter, {
          throwOnError: true,
          allowHostProjectCodeExecution: true,
        }),
      TypeError,
      "Invalid middleware export",
    );
  });

  it("preserves nonfatal development loading for invalid middleware", async () => {
    const adapter = createVirtualAdapter("export default function broken( {");

    assertEquals(
      await loadMiddlewareFile("/app", adapter, { allowHostProjectCodeExecution: true }),
      [],
    );
  });
});

describe("dev-server/middleware: actionable rejection", () => {
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("names the Next.js convention when a named middleware export is found", async () => {
    // A root middleware.ts written for Next.js takes down every route, so the
    // error has to be enough to fix the file without reading framework source.
    const adapter = createVirtualAdapter(
      "export function middleware(request) { return new Response('ok'); }",
    );

    const error = await assertRejects(
      () =>
        loadMiddlewareFile("/app", adapter, {
          throwOnError: true,
          allowHostProjectCodeExecution: true,
        }),
      TypeError,
    );

    // assertRejects hands back an unknown; narrow it before reading the copy.
    assertInstanceOf(error, TypeError);
    assertStringIncludes(error.message, "middleware.ts");
    assertStringIncludes(error.message, "Next.js convention");
    assertStringIncludes(error.message, "(c, next)");
    assertStringIncludes(error.message, "export default");
    assertStringIncludes(error.message, "docs/guides/middleware.md");
  });

  it("lists the offending exports when the shape is merely wrong", async () => {
    const adapter = createVirtualAdapter("export const handler = 1; export const other = 2;");

    const error = await assertRejects(
      () =>
        loadMiddlewareFile("/app", adapter, {
          throwOnError: true,
          allowHostProjectCodeExecution: true,
        }),
      TypeError,
    );

    assertInstanceOf(error, TypeError);
    assertStringIncludes(error.message, "Found export(s):");
    assertStringIncludes(error.message, "handler");
    assertStringIncludes(error.message, "other");
  });

  it("describes a default export array with a non-function entry", async () => {
    // Every wrong shape with a default export used to collapse to the useless
    // "Found export(s): default." because the message read the namespace keys,
    // not the resolved default.
    const adapter = createVirtualAdapter(
      "export default [async (c, next) => await next(), 'audit'];",
    );

    const error = await assertRejects(
      () =>
        loadMiddlewareFile("/app", adapter, {
          throwOnError: true,
          allowHostProjectCodeExecution: true,
        }),
      TypeError,
    );

    assertInstanceOf(error, TypeError);
    assertStringIncludes(error.message, "non-function at index 1");
    assertStringIncludes(error.message, "(string)");
  });

  it("describes an empty default export array", async () => {
    const adapter = createVirtualAdapter("export default [];");

    const error = await assertRejects(
      () =>
        loadMiddlewareFile("/app", adapter, {
          throwOnError: true,
          allowHostProjectCodeExecution: true,
        }),
      TypeError,
    );

    assertInstanceOf(error, TypeError);
    assertStringIncludes(error.message, "empty default export array");
  });

  it("describes a default export object that is not middleware", async () => {
    const adapter = createVirtualAdapter(
      "export default { handler: async (c, next) => await next() };",
    );

    const error = await assertRejects(
      () =>
        loadMiddlewareFile("/app", adapter, {
          throwOnError: true,
          allowHostProjectCodeExecution: true,
        }),
      TypeError,
    );

    assertInstanceOf(error, TypeError);
    assertStringIncludes(error.message, "default export of type object");
    assertStringIncludes(error.message, "handler");
  });

  it("still accepts a valid default export", async () => {
    const adapter = createVirtualAdapter(
      "export default async function (c, next) { return await next(); }",
    );

    const middleware = await loadMiddlewareFile("/app", adapter, {
      throwOnError: true,
      allowHostProjectCodeExecution: true,
    });
    assertEquals(middleware.length, 1);
  });

  it("resolves project-local imports from a virtual filesystem", async () => {
    const adapter = createVirtualAdapter(
      'import middleware from "./lib/pmo-auth"; export default middleware;',
      {
        "/app/lib/pmo-auth.ts": "export default async function (c, next) { return await next(); }",
      },
    );

    const middleware = await loadMiddlewareFile("/app", adapter, {
      throwOnError: true,
      allowHostProjectCodeExecution: true,
    });

    assertEquals(middleware.length, 1);
  });

  describe("virtual filesystem imports", () => {
    const passThrough = "export default async function (c, next) { return await next(); }";
    const load = (adapter: RuntimeAdapter, projectDir = "/app") =>
      loadMiddlewareFile(projectDir, adapter, {
        throwOnError: true,
        allowHostProjectCodeExecution: true,
      });

    it("resolves the @/ project-root alias", async () => {
      const adapter = createVirtualAdapter(
        'import middleware from "@/lib/auth"; export default middleware;',
        { "/app/lib/auth.ts": passThrough },
      );

      assertEquals((await load(adapter)).length, 1);
    });

    it("treats root-absolute imports as project-relative", async () => {
      const adapter = createVirtualAdapter(
        'import middleware from "/lib/auth"; export default middleware;',
        { "/app/lib/auth.ts": passThrough },
      );

      assertEquals((await load(adapter)).length, 1);
    });

    it("resolves a directory import to its index module", async () => {
      const adapter = createVirtualAdapter(
        'import middleware from "./lib"; export default middleware;',
        { "/app/lib/index.ts": passThrough },
      );

      assertEquals((await load(adapter)).length, 1);
    });

    it("loads JSON modules with the JSON loader", async () => {
      const adapter = createVirtualAdapter(
        'import policy from "./policy.json"; ' +
          "export default policy.enabled ? async (c, next) => await next() : [];",
        { "/app/policy.json": '{ "enabled": true }' },
      );

      assertEquals((await load(adapter)).length, 1);
    });

    it("loads .mts and .cts modules as TypeScript", async () => {
      const typed =
        "export default async (c: unknown, next: () => Promise<Response>) => await next();";
      const adapter = createVirtualAdapter(
        'import first from "./lib/first"; import second from "./lib/second.cts"; ' +
          "export default [first, second];",
        { "/app/lib/first.mts": typed, "/app/lib/second.cts": typed },
      );

      assertEquals((await load(adapter)).length, 2);
    });

    it("resolves JavaScript specifiers to TypeScript sources", async () => {
      const adapter = createVirtualAdapter(
        'import middleware from "./lib/auth.js"; export default middleware;',
        { "/app/lib/auth.ts": passThrough },
      );

      assertEquals((await load(adapter)).length, 1);
    });

    it("prefers an existing JavaScript file over its TypeScript alternative", async () => {
      const adapter = createVirtualAdapter(
        'import middleware from "./lib/auth.js"; export default middleware;',
        {
          "/app/lib/auth.js": passThrough,
          "/app/lib/auth.ts": "export default [];",
        },
      );

      assertEquals((await load(adapter)).length, 1);
    });

    it("separates query and fragment suffixes before probing project files", async () => {
      const adapter = createVirtualAdapter(
        'import first from "./lib/auth.ts?v=1"; import second from "./lib/auth#named"; ' +
          "export default [first, second];",
        { "/app/lib/auth.ts": passThrough },
      );

      assertEquals((await load(adapter)).length, 2);
    });

    it("redacts import suffixes from resolver errors", async () => {
      const suffixValue = `suffix-${crypto.randomUUID()}`;
      const adapter = createVirtualAdapter(
        `import missing from "./lib/missing.ts?value=${suffixValue}"; ` +
          `import escaped from "../outside.ts#${suffixValue}"; ` +
          "export default [missing, escaped];",
      );

      const error = await assertRejects(() => load(adapter));
      const message = String(error);
      assertStringIncludes(message, "./lib/missing.ts<redacted suffix>");
      assertStringIncludes(message, "../outside.ts<redacted suffix>");
      assertEquals(message.includes(suffixValue), false);
    });

    it("prefers .tsx over .ts for extensionless imports", async () => {
      const adapter = createVirtualAdapter(
        'import middleware from "./lib/auth"; export default middleware;',
        {
          "/app/lib/auth.tsx": passThrough,
          "/app/lib/auth.ts": "export default [];",
        },
      );

      assertEquals((await load(adapter)).length, 1);
    });

    it("compiles JSX dependencies with the automatic runtime", async () => {
      const adapter = createVirtualAdapter(
        'import { element } from "./lib/banner.tsx"; ' +
          'export default element.type === "p" ? async (c, next) => await next() : [];',
        { "/app/lib/banner.tsx": "export const element = <p>ok</p>;" },
      );

      assertEquals((await load(adapter)).length, 1);
    });

    it("keeps bare specifiers external even when a same-named project file exists", async () => {
      const adapter = createVirtualAdapter(
        'import { sep } from "node:path"; ' +
          'export default sep === "project" ? [] : async (c, next) => await next();',
        { "/app/node:path.ts": 'export const sep = "project";' },
      );

      assertEquals((await load(adapter)).length, 1);
    });

    it("rejects relative imports that escape the project root", async () => {
      // Root the virtual project at a real host directory so that, without the
      // containment check, the bundler would read the sibling host file.
      const projectDir = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
      const adapter = createVirtualAdapter(
        'import { isServerShuttingDown } from "../shutdown-state.ts"; ' +
          "export default async () => new Response(String(isServerShuttingDown()));",
      );

      const error = await assertRejects(() => load(adapter, projectDir));
      assertStringIncludes(String(error), "outside the project root");
    });

    it("rejects project-relative imports that do not exist", async () => {
      const adapter = createVirtualAdapter(
        'import middleware from "./lib/missing"; export default middleware;',
      );

      const error = await assertRejects(() => load(adapter));
      assertStringIncludes(String(error), "Could not resolve");
    });

    it("preserves the request context in bundler callbacks", async () => {
      const { build } = await import("veryfront/extensions/bundler");
      // Start the bundler service outside any request context, as on a warm
      // server whose first build served another request.
      await build({ write: false, stdin: { contents: "1;", loader: "js" } });

      // Like MultiProjectFSAdapter, refuse to operate without the store.
      const adapter = createVirtualAdapter(
        'import middleware from "./lib/auth"; export default middleware;',
        { "/app/lib/auth.ts": passThrough },
        () => {
          if (!getCurrentRequestContext()) throw new Error("No request context available");
        },
      );

      const middleware = await runWithRequestContext(
        { projectSlug: "middleware-project", token: "middleware-token", productionMode: false },
        () => load(adapter),
      );

      assertEquals(middleware.length, 1);
    });
  });

  it("still accepts an array of functions", async () => {
    const adapter = createVirtualAdapter(
      "export default [async (c, next) => await next(), async (c, next) => await next()];",
    );

    const middleware = await loadMiddlewareFile("/app", adapter, {
      throwOnError: true,
      allowHostProjectCodeExecution: true,
    });
    assertEquals(middleware.length, 2);
  });
});
