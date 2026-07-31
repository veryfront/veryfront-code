import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { MAX_CSS_FILE_BYTES } from "#veryfront/utils/constants/css.ts";
import type { HandlerContext } from "../types.ts";
import { extractProjectCandidates } from "./styles-candidate-scanner.ts";
import { extractProjectCssImports } from "./styles-css-import-scanner.ts";

function makeContext(
  getAllSourceFiles: () => unknown | Promise<unknown>,
  fsOverrides: Partial<RuntimeAdapter["fs"]> = {},
): HandlerContext {
  const adapter = createMockAdapter();
  const runtime = {
    ...adapter,
    fs: {
      ...adapter.fs,
      ...fsOverrides,
      getUnderlyingAdapter: () => ({ getAllSourceFiles }),
    },
  } as RuntimeAdapter;

  return {
    projectDir: "/project",
    projectSlug: `scanner-${crypto.randomUUID()}`,
    adapter: runtime,
    securityConfig: null,
    cspUserHeader: null,
  } as HandlerContext;
}

describe("server/handlers/dev style source scanners", () => {
  it("rejects remote listings above 10,000 entries before inspecting entries", async () => {
    const oversizedSparseListing = new Array(10_001);

    await assertRejects(
      () =>
        extractProjectCandidates(
          makeContext(() => oversizedSparseListing),
          { projectVersion: "v1", developmentMode: false },
        ),
      TypeError,
      "10000 entries",
    );
  });

  it("rejects accessor-backed remote entries without invoking accessors", async () => {
    let accessorCalls = 0;
    const entry: Record<string, unknown> = { content: "export {};" };
    Object.defineProperty(entry, "path", {
      enumerable: true,
      get() {
        accessorCalls++;
        return "app/page.tsx";
      },
    });

    await assertRejects(
      () =>
        extractProjectCandidates(
          makeContext(() => [entry]),
          { projectVersion: "v1", developmentMode: false },
        ),
      TypeError,
      "data properties",
    );
    assertEquals(accessorCalls, 0);
  });

  it("rejects remote source paths outside the project", async () => {
    await assertRejects(
      () =>
        extractProjectCandidates(
          makeContext(() => [{ path: "/outside/page.tsx", content: "export {};" }]),
          { projectVersion: "v1", developmentMode: false },
        ),
      TypeError,
      "within the project",
    );
  });

  it("rejects overlong remote source paths before reading", async () => {
    let reads = 0;

    await assertRejects(
      () =>
        extractProjectCandidates(
          makeContext(
            () => [{ path: `/${"a".repeat(4_096)}.tsx` }],
            {
              readFile: () => {
                reads++;
                return Promise.resolve("export {};");
              },
            },
          ),
          { projectVersion: "v1", developmentMode: false },
        ),
      TypeError,
      "4096 characters",
    );
    assertEquals(reads, 0);
  });

  it("rejects remote source content above the 16 MiB UTF-8 file limit", async () => {
    const content = "é".repeat(8 * 1024 * 1024 + 1);

    await assertRejects(
      () =>
        extractProjectCandidates(
          makeContext(() => [{ path: "app/page.tsx", content }]),
          { projectVersion: "v1", developmentMode: false },
        ),
      TypeError,
      "16777216 bytes",
    );
  });

  it("propagates operational reads for remote source entries without inline content", async () => {
    const failure = Object.assign(new Error("source read failed"), { code: "EIO" });

    await assertRejects(
      () =>
        extractProjectCandidates(
          makeContext(
            () => [{ path: "app/page.tsx" }],
            { readFileBytesWithinLimit: () => Promise.reject(failure) },
          ),
          { projectVersion: "v1", developmentMode: false },
        ),
      Error,
      "source read failed",
    );
  });

  it("does not turn operational CSS-import source reads into absence", async () => {
    const failure = Object.assign(new Error("CSS import source read failed"), { code: "EACCES" });

    await assertRejects(
      () =>
        extractProjectCssImports(
          makeContext(
            () => [{ path: "app/layout.tsx" }],
            { readFileBytesWithinLimit: () => Promise.reject(failure) },
          ),
        ),
      Error,
      "CSS import source read failed",
    );
  });

  it("uses bounded bytes when a remote entry omits inline content", async () => {
    let unboundedReads = 0;
    let requestedLimit = 0;
    await assertRejects(
      () =>
        extractProjectCandidates(
          makeContext(
            () => [{ path: "app/page.tsx" }],
            {
              readFile: () => {
                unboundedReads++;
                throw new Error("unbounded text read must not be invoked");
              },
              readFileBytesWithinLimit: (_path, byteLimit) => {
                requestedLimit = byteLimit;
                return Promise.reject(
                  new RangeError(`File exceeds byte limit of ${byteLimit} bytes`),
                );
              },
            },
          ),
          { projectVersion: "v1", developmentMode: false },
        ),
      TypeError,
      `${MAX_CSS_FILE_BYTES} bytes`,
    );
    assertEquals(requestedLimit, MAX_CSS_FILE_BYTES);
    assertEquals(unboundedReads, 0);
  });

  it("fails closed before an unbounded remote read when bounded bytes are unavailable", async () => {
    let unboundedReads = 0;
    await assertRejects(
      () =>
        extractProjectCandidates(
          makeContext(
            () => [{ path: "app/page.tsx" }],
            {
              readFile: () => {
                unboundedReads++;
                return Promise.resolve("export default null;");
              },
              readFileBytesWithinLimit: undefined,
            },
          ),
          { projectVersion: "v1", developmentMode: false },
        ),
      TypeError,
      "bounded byte reader",
    );
    assertEquals(unboundedReads, 0);
  });

  it("rejects a relative remote project directory before resolving source paths", async () => {
    const ctx = makeContext(() => [{ path: "app/page.tsx", content: "export {};" }]);
    ctx.projectDir = "relative/project";

    await assertRejects(
      () =>
        extractProjectCandidates(ctx, {
          projectVersion: "v1",
          developmentMode: false,
        }),
      TypeError,
      "must be absolute",
    );
  });

  it("rejects proxied remote listings without invoking proxy traps", async () => {
    let trapCalls = 0;
    const listing = new Proxy([{ path: "app/page.tsx", content: "export {};" }], {
      getOwnPropertyDescriptor(target, property) {
        trapCalls++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      ownKeys(target) {
        trapCalls++;
        return Reflect.ownKeys(target);
      },
    });

    await assertRejects(
      () =>
        extractProjectCandidates(
          makeContext(() => listing),
          { projectVersion: "v1", developmentMode: false },
        ),
      TypeError,
      "must not be a Proxy",
    );
    assertEquals(trapCalls, 0);
  });

  it("rejects proxied remote entries without invoking proxy traps", async () => {
    let trapCalls = 0;
    const entry = new Proxy({ path: "app/page.tsx", content: "export {};" }, {
      getOwnPropertyDescriptor(target, property) {
        trapCalls++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    await assertRejects(
      () =>
        extractProjectCandidates(
          makeContext(() => [entry]),
          { projectVersion: "v1", developmentMode: false },
        ),
      TypeError,
      "must not be a Proxy",
    );
    assertEquals(trapCalls, 0);
  });

  it("rejects a proxied source provider without invoking provider traps", async () => {
    let trapCalls = 0;
    const provider = new Proxy({
      getAllSourceFiles: () => [{ path: "app/page.tsx", content: "export {};" }],
    }, {
      get(target, property, receiver) {
        trapCalls++;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        trapCalls++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const ctx = makeContext(() => []);
    Object.defineProperty(ctx.adapter.fs, "getUnderlyingAdapter", {
      configurable: true,
      value: () => provider,
    });

    await assertRejects(
      () =>
        extractProjectCandidates(ctx, {
          projectVersion: "v1",
          developmentMode: false,
        }),
      TypeError,
      "non-Proxy object",
    );
    assertEquals(trapCalls, 0);
  });

  it("rejects accessor-backed source-provider capabilities without invoking them", async () => {
    let accessorCalls = 0;
    const provider = {};
    Object.defineProperty(provider, "getAllSourceFiles", {
      get() {
        accessorCalls++;
        return () => [];
      },
    });
    const ctx = makeContext(() => []);
    Object.defineProperty(ctx.adapter.fs, "getUnderlyingAdapter", {
      configurable: true,
      value: () => provider,
    });

    await assertRejects(
      () =>
        extractProjectCandidates(ctx, {
          projectVersion: "v1",
          developmentMode: false,
        }),
      TypeError,
      "data-property function",
    );
    assertEquals(accessorCalls, 0);
  });
});
