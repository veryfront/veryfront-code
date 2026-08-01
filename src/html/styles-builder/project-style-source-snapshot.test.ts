import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { MAX_CSS_FILE_BYTES, MAX_CSS_TOTAL_BYTES } from "#veryfront/utils/constants/css.ts";
import {
  captureProjectStyleSourceSnapshot,
  snapshotProjectStyleSourceFiles,
  snapshotResolvedStyleContentContext,
} from "./project-style-source-snapshot.ts";
import { extractCandidatesFromFiles } from "./candidate-extractor.ts";

describe("styles-builder/project-style-source-snapshot", () => {
  it("rejects a proxied public candidate source listing without invoking traps", () => {
    let trapCalls = 0;
    const files = new Proxy([{
      path: "app/page.tsx",
      content: '<main className="safe" />',
    }], {
      get() {
        trapCalls++;
        throw new Error("candidate source Proxy trap must not run");
      },
      ownKeys() {
        trapCalls++;
        throw new Error("candidate source Proxy trap must not run");
      },
    });

    assertThrows(
      () => extractCandidatesFromFiles(files),
      TypeError,
      "Proxy",
    );
    assertEquals(trapCalls, 0);
  });

  it("rejects accessor-backed public candidate source entries without invoking getters", () => {
    let getterCalls = 0;
    const entry = Object.defineProperties({}, {
      path: {
        enumerable: true,
        get() {
          getterCalls++;
          return "app/page.tsx";
        },
      },
      content: {
        enumerable: true,
        get() {
          getterCalls++;
          return '<main className="unsafe" />';
        },
      },
    }) as { path: string; content: string };

    assertThrows(
      () => extractCandidatesFromFiles([entry]),
      TypeError,
      "data properties",
    );
    assertEquals(getterCalls, 0);
  });

  it("snapshots public candidate sources before caller iteration can mutate them", () => {
    let iteratorCalls = 0;
    class MutatingSourceArray extends Array<{ path: string; content: string }> {
      override *[Symbol.iterator](): ArrayIterator<{ path: string; content: string }> {
        iteratorCalls++;
        this[0]!.content = '<main className="unsafe" />';
        yield* super[Symbol.iterator]();
      }
    }
    const files = new MutatingSourceArray();
    files.push({ path: "app/page.tsx", content: '<main className="safe" />' });

    const candidates = extractCandidatesFromFiles(files);

    assertEquals(iteratorCalls, 0);
    assertEquals(candidates.has("safe"), true);
    assertEquals(candidates.has("unsafe"), false);
  });

  it("captures provider capabilities and results once into a frozen snapshot", async () => {
    const adapter = createMockAdapter();
    let underlyingCalls = 0;
    let contextCalls = 0;
    let projectDataCalls = 0;
    let listingCalls = 0;
    const listing = [{
      path: "app/page.tsx",
      content: 'export default () => <main className="safe" />;',
    }];
    const provider = {
      getContentContext() {
        contextCalls++;
        return {
          sourceType: "release" as const,
          projectSlug: "demo",
          releaseId: "release-1",
        };
      },
      getProjectData() {
        projectDataCalls++;
        return { updated_at: "2026-01-02T03:04:05Z" };
      },
      getAllSourceFiles() {
        listingCalls++;
        return Promise.resolve(listing);
      },
    };
    adapter.fs = {
      ...adapter.fs,
      getUnderlyingAdapter() {
        underlyingCalls++;
        return provider;
      },
    } as typeof adapter.fs & { getUnderlyingAdapter(): typeof provider };

    const snapshot = await captureProjectStyleSourceSnapshot({
      adapter,
      projectDir: "/project",
      config: {},
    });

    assertEquals(underlyingCalls, 1);
    assertEquals(contextCalls, 1);
    assertEquals(projectDataCalls, 1);
    assertEquals(listingCalls, 1);
    assertEquals(snapshot?.contentContext?.sourceType, "release");
    assertEquals(snapshot?.contentContext?.projectSlug, "demo");
    assertEquals(snapshot?.contentContext?.releaseId, "release-1");
    assertEquals(Object.hasOwn(snapshot!.contentContext!, "branch"), true);
    assertEquals(Object.hasOwn(snapshot!.contentContext!, "environmentName"), true);
    assertEquals(snapshot?.projectUpdatedAt, "2026-01-02T03:04:05Z");
    assertEquals(snapshot?.files?.length, 1);
    assertEquals(snapshot?.files?.[0]?.path, "/project/app/page.tsx");
    assertEquals(
      snapshot?.files?.[0]?.content,
      'export default () => <main className="safe" />;',
    );
    assertEquals(Object.isFrozen(snapshot), true);
    assertEquals(Object.isFrozen(snapshot?.contentContext), true);
    assertEquals(Object.isFrozen(snapshot?.files), true);
    assertEquals(Object.isFrozen(snapshot?.files?.[0]), true);

    listing[0]!.content = "mutated";
    assertEquals(snapshot?.files?.[0]?.content.includes("safe"), true);
  });

  it("rejects a proxied content context without invoking its traps", () => {
    let trapCalls = 0;
    const context = new Proxy({
      sourceType: "branch",
      projectSlug: "demo",
      branch: "main",
    }, {
      getOwnPropertyDescriptor(target, property) {
        trapCalls++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    try {
      snapshotResolvedStyleContentContext(context);
      throw new Error("expected content-context rejection");
    } catch (error) {
      assertEquals(error instanceof TypeError, true);
    }
    assertEquals(trapCalls, 0);
  });

  it("rejects a poisoned source array before invoking its iterator", async () => {
    const adapter = createMockAdapter();
    let iteratorCalls = 0;
    const listing = [{ path: "app/page.tsx", content: "export {};" }];
    Object.defineProperty(listing, Symbol.iterator, {
      get() {
        iteratorCalls++;
        throw new Error("iterator must not run");
      },
    });
    adapter.fs = {
      ...adapter.fs,
      getUnderlyingAdapter: () => ({
        getAllSourceFiles: () => listing,
      }),
    } as typeof adapter.fs & { getUnderlyingAdapter(): unknown };

    await assertRejects(
      () =>
        captureProjectStyleSourceSnapshot({
          adapter,
          projectDir: "/project",
          config: {},
        }),
      TypeError,
      "dense data-property array",
    );
    assertEquals(iteratorCalls, 0);
  });

  it("rejects missing inline content through the exact per-file bound", async () => {
    const adapter = createMockAdapter();
    let receivedLimit = 0;
    adapter.fs = {
      ...adapter.fs,
      getUnderlyingAdapter: () => ({
        getAllSourceFiles: () => [{ path: "app/page.tsx" }],
      }),
      readFile: () => Promise.reject(new Error("unbounded source read must not run")),
      readFileBytesWithinLimit: (_path, byteLimit) => {
        receivedLimit = byteLimit;
        return Promise.reject(new RangeError(`File exceeds byte limit of ${byteLimit} bytes`));
      },
    } as typeof adapter.fs & { getUnderlyingAdapter(): unknown };

    await assertRejects(
      () =>
        captureProjectStyleSourceSnapshot({
          adapter,
          projectDir: "/project",
          config: {},
        }),
      TypeError,
      "16777216 bytes",
    );
    assertEquals(receivedLimit, 16 * 1024 * 1024);
  });

  it("rejects missing supplied content when no exact-read authority is provided", async () => {
    await assertRejects(
      () =>
        snapshotProjectStyleSourceFiles(
          [{ path: "app/page.tsx" }],
          { projectDir: "/project", config: {} },
        ),
      TypeError,
      "runtime adapter",
    );
  });

  it("admits an empty inline source after the aggregate byte budget is exactly consumed", async () => {
    const boundaryContent = "x".repeat(MAX_CSS_FILE_BYTES);
    const files = await snapshotProjectStyleSourceFiles(
      [
        { path: "app/one.ts", content: boundaryContent },
        { path: "app/two.ts", content: boundaryContent },
        { path: "app/three.ts", content: boundaryContent },
        { path: "app/four.ts", content: boundaryContent },
        { path: "app/z-empty.ts", content: "" },
      ],
      { projectDir: "/project", config: {} },
    );

    assertEquals(MAX_CSS_FILE_BYTES * 4, MAX_CSS_TOTAL_BYTES);
    assertEquals(files.length, 5);
    assertEquals(files.at(-1)?.content, "");
  });

  it("creates null-prototype records with explicit optional fields", async () => {
    const adapter = createMockAdapter();
    let exactReads = 0;
    adapter.fs = {
      ...adapter.fs,
      readFileBytesWithinLimit: () => {
        exactReads++;
        return Promise.resolve(new TextEncoder().encode("safe"));
      },
    };
    Object.defineProperties(Object.prototype, {
      content: { configurable: true, value: "forged" },
      releaseId: { configurable: true, value: "forged-release" },
      projectUpdatedAt: { configurable: true, value: "forged-version" },
    });
    try {
      const context = snapshotResolvedStyleContentContext({
        sourceType: "branch",
        projectSlug: "demo",
        branch: "main",
      });
      const files = await snapshotProjectStyleSourceFiles(
        [{ path: "app/page.tsx" }],
        { projectDir: "/project", config: {}, adapter },
      );

      assertEquals(Object.getPrototypeOf(context), null);
      assertEquals(Object.hasOwn(context!, "releaseId"), true);
      assertEquals(context!.releaseId, undefined);
      assertEquals(Object.getPrototypeOf(files[0]!), null);
      assertEquals(files[0]!.content, "safe");
      assertEquals(exactReads, 1);
    } finally {
      delete (Object.prototype as Record<string, unknown>).content;
      delete (Object.prototype as Record<string, unknown>).releaseId;
      delete (Object.prototype as Record<string, unknown>).projectUpdatedAt;
    }
  });

  it("does not let Object.prototype fabricate a provider capability", async () => {
    const adapter = createMockAdapter();
    let forgedCalls = 0;
    Object.defineProperty(Object.prototype, "getUnderlyingAdapter", {
      configurable: true,
      value: () => {
        forgedCalls++;
        return {};
      },
    });
    try {
      assertEquals(
        await captureProjectStyleSourceSnapshot({
          adapter,
          projectDir: "/project",
          config: {},
        }),
        null,
      );
      assertEquals(forgedCalls, 0);
    } finally {
      delete (Object.prototype as Record<string, unknown>).getUnderlyingAdapter;
    }
  });
});
