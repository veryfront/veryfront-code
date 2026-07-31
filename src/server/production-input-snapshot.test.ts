import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Extension } from "#veryfront/extensions/types.ts";
import {
  snapshotProductionConfig,
  snapshotProductionLocalProjects,
} from "./production-input-snapshot.ts";

describe("production startup input snapshots", () => {
  it("detaches structural config containers while preserving callable entries and extension DAGs", () => {
    class CacheService {
      readonly kind = "cache";
    }
    const corsOrigin = (origin: string) => origin === "https://example.com";
    const middleware = () => new Response("middleware");
    const setup = () => {};
    const sharedCapability = { type: "render", options: { mode: "safe" } };
    const sharedHeaders = ["x-request-id"];
    const bytes = new Uint8Array([1, 2, 3]);
    const cacheService = new CacheService();
    const symbolService = Symbol("symbol-service");
    const bigintService = 42n;
    const firstExtension: Extension = {
      name: "first",
      version: "1.0.0",
      capabilities: [sharedCapability],
      setup,
      provides: {
        Cache: cacheService,
        SymbolService: symbolService,
        BigIntService: bigintService,
      },
    };
    const secondExtension: Extension = {
      name: "second",
      version: "1.0.0",
      capabilities: [sharedCapability],
    };
    const source = {
      security: {
        cors: {
          origin: corsOrigin,
          allowedHeaders: sharedHeaders,
          exposedHeaders: sharedHeaders,
        },
      },
      middleware: { custom: [middleware] },
      fs: {
        type: "memory" as const,
        memory: { files: { "/asset.bin": bytes } },
      },
      extensions: [firstExtension, secondExtension],
    };

    const snapshot = snapshotProductionConfig(source);
    const snapshottedBytes = snapshot.fs?.memory?.files?.["/asset.bin"] as Uint8Array;
    const extensions = snapshot.extensions! as Extension[];

    assertStrictEquals(
      (snapshot.security?.cors as { origin: typeof corsOrigin }).origin,
      corsOrigin,
    );
    assertStrictEquals(snapshot.middleware?.custom?.[0], middleware);
    const cors = snapshot.security?.cors as {
      allowedHeaders: readonly string[];
      exposedHeaders: readonly string[];
    };
    assertEquals(cors.allowedHeaders, sharedHeaders);
    assertEquals(cors.exposedHeaders, sharedHeaders);
    assertEquals(cors.allowedHeaders === sharedHeaders, false);
    assertEquals(cors.exposedHeaders === sharedHeaders, false);
    assertStrictEquals(extensions[0]?.setup, setup);
    assertStrictEquals(extensions[0]?.provides?.Cache, cacheService);
    assertStrictEquals(extensions[0]?.provides?.SymbolService, symbolService);
    assertStrictEquals(extensions[0]?.provides?.BigIntService, bigintService);
    assertEquals(snapshottedBytes === bytes, false);
    assertEquals([...snapshottedBytes], [1, 2, 3]);
    assertStrictEquals(
      extensions[0]?.capabilities[0],
      extensions[1]?.capabilities[0],
    );
    assertEquals(Object.isFrozen(snapshot), true);
    assertEquals(Object.isFrozen(snapshot.middleware), true);
    assertEquals(Object.isFrozen(snapshot.middleware?.custom), true);
    assertEquals(Object.isFrozen(extensions), true);
    assertEquals(Object.isFrozen(extensions[0]), true);
    assertEquals(Object.isFrozen(extensions[0]?.capabilities[0]), true);

    bytes[0] = 99;
    firstExtension.name = "mutated";
    sharedCapability.options.mode = "mutated";

    assertEquals([...snapshottedBytes], [1, 2, 3]);
    assertEquals(extensions[0]?.name, "first");
    assertEquals(
      (extensions[0]?.capabilities[0] as typeof sharedCapability).options.mode,
      "safe",
    );
    snapshottedBytes[1] = 88;
    assertEquals(bytes[1], 2);
    assertEquals([...snapshottedBytes], [1, 88, 3]);
  });

  it("keeps callable closures and extension providers opaque by identity", () => {
    const closureState = { allowed: false };
    const origin = () => closureState.allowed;
    const provider = { cacheHits: 0 };
    const snapshot = snapshotProductionConfig({
      security: { cors: { origin } },
      extensions: [{
        name: "mutable-provider",
        version: "1.0.0",
        provides: { Cache: provider },
      }],
    });

    closureState.allowed = true;
    provider.cacheHits = 1;

    const snapshottedOrigin = (snapshot.security?.cors as { origin: typeof origin }).origin;
    const snapshottedProvider = (snapshot.extensions?.[0] as Extension).provides?.Cache as {
      cacheHits: number;
    };
    assertStrictEquals(snapshottedOrigin, origin);
    assertEquals(snapshottedOrigin(), true);
    assertStrictEquals(snapshottedProvider, provider);
    assertEquals(snapshottedProvider.cacheHits, 1);
    assertEquals(Object.isFrozen(snapshottedProvider), false);
  });

  it("rejects callable proxies without invoking them", () => {
    let calls = 0;
    const origin = new Proxy(
      () => {
        calls++;
        return true;
      },
      {},
    );

    assertThrows(
      () => snapshotProductionConfig({ security: { cors: { origin } } }),
      TypeError,
      "proxies",
    );
    assertEquals(calls, 0);
  });

  it("detaches and freezes local-project records", () => {
    const source = { demo: "/projects/demo" };
    const snapshot = snapshotProductionLocalProjects(source)!;

    source.demo = "/projects/mutated";

    assertEquals(snapshot.demo, "/projects/demo");
    assertEquals(snapshot === source, false);
    assertEquals(Object.isFrozen(snapshot), true);
  });

  it("accepts the established 1,000-entry local-project boundary", () => {
    const source = Object.fromEntries(
      Array.from({ length: 1_000 }, (_, index) => [
        `project-${index}`,
        `/projects/project-${index}`,
      ]),
    );

    const snapshot = snapshotProductionLocalProjects(source)!;

    assertEquals(Object.keys(snapshot).length, 1_000);
    assertEquals(snapshot["project-999"], "/projects/project-999");
  });

  it("rejects non-lowercase local-project slugs", () => {
    assertThrows(
      () => snapshotProductionLocalProjects({ Demo: "/projects/demo" }),
      TypeError,
      "canonical slug",
    );
  });

  it("does not impose a snapshot-only cap on schema-supported memory files", () => {
    const bytes = new Uint8Array(32 * 1024 * 1024 + 1);
    bytes[bytes.length - 1] = 7;

    const snapshot = snapshotProductionConfig({
      fs: {
        type: "memory",
        memory: { files: { "/large.bin": bytes } },
      },
    });
    const captured = snapshot.fs?.memory?.files?.["/large.bin"] as Uint8Array;

    assertEquals(captured === bytes, false);
    assertEquals(captured.byteLength, bytes.byteLength);
    assertEquals(captured[captured.length - 1], 7);
  });
});
