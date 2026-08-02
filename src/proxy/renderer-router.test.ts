import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertThrows } from "#veryfront/testing/assert";
import {
  createRendererRouterFromEnvironment,
  jumpHash,
  RendererRouter,
  type RendererRouterOptions,
} from "./renderer-router.ts";

const FALLBACK_URL = "http://fallback:3001";
const LONG_REFRESH_MS = 300_000;

function createStaticRouter(
  targets: readonly string[],
  options: RendererRouterOptions = {},
): RendererRouter {
  return new RendererRouter("renderer.internal", FALLBACK_URL, {
    ...options,
    staticTargets: targets,
  });
}

Deno.test("jumpHash", async (t) => {
  await t.step("returns value in range [0, numBuckets)", () => {
    for (let bucketCount = 1; bucketCount <= 20; bucketCount++) {
      for (let index = 0; index < 50; index++) {
        const result = jumpHash(`key-${index}`, bucketCount);
        assertEquals(result >= 0, true, `expected >= 0, got ${result}`);
        assertEquals(
          result < bucketCount,
          true,
          `expected < ${bucketCount}, got ${result}`,
        );
      }
    }
  });

  await t.step("is deterministic", () => {
    assertEquals(jumpHash("test", 10), jumpHash("test", 10));
    assertEquals(jumpHash("project-abc", 5), jumpHash("project-abc", 5));
  });

  await t.step("keeps stable 64-bit hash vectors", () => {
    assertEquals(jumpHash("test", 10), 1);
    assertEquals(jumpHash("project-abc", 5), 3);
    assertEquals(jumpHash("key-123", 17), 15);
  });

  await t.step("distributes keys across buckets", () => {
    const buckets = new Map<number, number>();
    const bucketCount = 10;
    const keyCount = 10_000;
    for (let index = 0; index < keyCount; index++) {
      const bucket = jumpHash(`key-${index}`, bucketCount);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    assertEquals(buckets.size, bucketCount);
    const expected = keyCount / bucketCount;
    for (const [bucket, count] of buckets) {
      assertEquals(
        count > expected * 0.5 && count < expected * 1.5,
        true,
        `bucket ${bucket} got ${count} keys, expected ~${expected}`,
      );
    }
  });

  await t.step("single bucket always returns zero", () => {
    for (let index = 0; index < 100; index++) {
      assertEquals(jumpHash(`key-${index}`, 1), 0);
    }
  });

  await t.step("minimizes remapping when a bucket is added or removed", () => {
    const keyCount = 1_000;
    let additions = 0;
    let removals = 0;
    for (let index = 0; index < keyCount; index++) {
      const key = `key-${index}`;
      if (jumpHash(key, 10) !== jumpHash(key, 11)) additions++;
      if (jumpHash(key, 10) !== jumpHash(key, 9)) removals++;
    }
    assertEquals(
      additions < keyCount * 0.2,
      true,
      `too many additions remapped: ${additions}/${keyCount}`,
    );
    assertEquals(
      removals < keyCount * 0.2,
      true,
      `too many removals remapped: ${removals}/${keyCount}`,
    );
  });

  await t.step("rejects invalid keys and bucket counts", () => {
    assertThrows(() => jumpHash("", 1), TypeError, "canonical project slug");
    assertThrows(
      () => jumpHash("not canonical", 1),
      TypeError,
      "canonical project slug",
    );
    assertThrows(() => jumpHash("project", 0), RangeError, "bucket count");
    assertThrows(() => jumpHash("project", 1.5), RangeError, "bucket count");
    assertThrows(() => jumpHash("project", 4_097), RangeError, "bucket count");
  });
});

Deno.test("RendererRouter", async (t) => {
  await t.step("routes static targets deterministically and falls back without a slug", () => {
    const router = createStaticRouter([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
    ]);
    try {
      assertEquals(router.resolve(undefined), FALLBACK_URL);
      assertEquals(router.resolve(""), FALLBACK_URL);
      const first = router.resolve("my-project");
      assertNotEquals(first, FALLBACK_URL);
      assertEquals(first, router.resolve("my-project"));
      assertEquals(first.startsWith("http://10.0.0."), true);
    } finally {
      router.close();
    }
  });

  await t.step("distributes canonical project slugs across targets", () => {
    const router = createStaticRouter([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
      "10.0.0.4",
      "10.0.0.5",
    ]);
    try {
      const seen = new Set<string>();
      for (let index = 0; index < 100; index++) {
        seen.add(router.resolve(`project-${index}`));
      }
      assertEquals(seen.size >= 3, true, `only hit ${seen.size} targets`);
    } finally {
      router.close();
    }
  });

  await t.step("snapshots, sorts, and deduplicates static targets", () => {
    const configured = [
      "10.0.0.2",
      "10.0.0.1",
      "10.0.0.2",
    ];
    const router = createStaticRouter(configured, { serverPort: 21_000 });
    try {
      assertEquals(configured, [
        "10.0.0.2",
        "10.0.0.1",
        "10.0.0.2",
      ]);
      assertEquals(router.targetCount, 2);
      assertEquals(router.resolve("project").endsWith(":21000"), true);
    } finally {
      router.close();
    }
  });

  await t.step("never expires explicitly configured static targets", () => {
    let now = 0;
    const router = createStaticRouter(["10.0.0.1"], {
      now: () => now,
    });
    try {
      now = 24 * 60 * 60 * 1_000;
      assertEquals(router.resolve("project"), "http://10.0.0.1:20000");
    } finally {
      router.close();
    }
  });

  await t.step("keeps cached target resolution available after close", () => {
    const router = createStaticRouter(["10.0.0.1"]);
    router.close();
    router.close();
    assertEquals(router.resolve("project"), "http://10.0.0.1:20000");
  });

  await t.step("routes fresh DNS targets and rejects them after the staleness budget", async () => {
    let now = 100;
    const router = new RendererRouter("renderer.internal", FALLBACK_URL, {
      refreshMs: LONG_REFRESH_MS,
      now: () => now,
      resolveTargets: () => Promise.resolve(["10.0.0.1", "10.0.0.2"]),
    });
    try {
      await router.ready();
      assertNotEquals(router.resolve("project"), FALLBACK_URL);
      now += 5 * 60 * 1_000 + 1;
      assertEquals(router.resolve("project"), FALLBACK_URL);
      assertEquals(router.resolve("project"), FALLBACK_URL);
    } finally {
      router.close();
    }
  });

  await t.step("resolves readiness without targets when initial DNS fails", async () => {
    const router = new RendererRouter("renderer.internal", FALLBACK_URL, {
      refreshMs: LONG_REFRESH_MS,
      resolveTargets: () => Promise.reject(new Error("DNS unavailable")),
    });
    try {
      await router.ready();
      assertEquals(router.targetCount, 0);
      assertEquals(router.resolve("project"), FALLBACK_URL);
    } finally {
      router.close();
    }
  });

  await t.step("keeps the last valid snapshot when a refresh fails validation", async () => {
    let callCount = 0;
    const router = new RendererRouter("renderer.internal", FALLBACK_URL, {
      refreshMs: LONG_REFRESH_MS,
      resolveTargets: () => {
        callCount++;
        return Promise.resolve(
          callCount === 1 ? ["10.0.0.1"] : ["127.1"],
        );
      },
    });
    try {
      await router.ready();
      assertEquals(router.resolve("project"), "http://10.0.0.1:20000");
      await router.refresh();
      assertEquals(callCount, 2);
      assertEquals(router.targetCount, 1);
      assertEquals(router.resolve("project"), "http://10.0.0.1:20000");
    } finally {
      router.close();
    }
  });

  await t.step("accepts an explicit empty DNS snapshot and falls back", async () => {
    let callCount = 0;
    const router = new RendererRouter("renderer.internal", FALLBACK_URL, {
      refreshMs: LONG_REFRESH_MS,
      resolveTargets: () => {
        callCount++;
        return Promise.resolve(callCount === 1 ? ["10.0.0.1"] : []);
      },
    });
    try {
      await router.ready();
      assertEquals(router.targetCount, 1);
      await router.refresh();
      assertEquals(router.targetCount, 0);
      assertEquals(router.resolve("project"), FALLBACK_URL);
    } finally {
      router.close();
    }
  });

  await t.step("coalesces overlapping refresh requests", async () => {
    let resolveDns!: (targets: readonly string[]) => void;
    const dnsResult = new Promise<readonly string[]>((resolve) => {
      resolveDns = resolve;
    });
    let callCount = 0;
    const router = new RendererRouter("renderer.internal", FALLBACK_URL, {
      refreshMs: LONG_REFRESH_MS,
      resolveTargets: () => {
        callCount++;
        return dnsResult;
      },
    });
    try {
      await Promise.resolve();
      await router.refresh();
      await router.refresh();
      assertEquals(callCount, 1);
      resolveDns(["10.0.0.1"]);
      await router.ready();
      assertEquals(router.targetCount, 1);
    } finally {
      router.close();
    }
  });

  await t.step("bounds a resolver that ignores the refresh deadline", async () => {
    let callCount = 0;
    const router = new RendererRouter("renderer.internal", FALLBACK_URL, {
      refreshMs: LONG_REFRESH_MS,
      refreshTimeoutMs: 5,
      resolveTargets: () => {
        callCount++;
        return new Promise<readonly string[]>(() => {});
      },
    });
    try {
      const startedAt = performance.now();
      await router.ready();
      assertEquals(performance.now() - startedAt < 250, true);
      await router.refresh();
      assertEquals(callCount, 1);
      assertEquals(router.resolve("project"), FALLBACK_URL);
    } finally {
      router.close();
    }
  });

  await t.step("generation-fences a DNS result that settles after close", async () => {
    let resolveDns!: (targets: readonly string[]) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const dnsResult = new Promise<readonly string[]>((resolve) => {
      resolveDns = resolve;
    });
    const router = new RendererRouter("renderer.internal", FALLBACK_URL, {
      refreshMs: LONG_REFRESH_MS,
      resolveTargets: () => {
        markStarted();
        return dnsResult;
      },
    });
    await started;
    router.close();
    await router.ready();
    resolveDns(["10.0.0.1"]);
    await Promise.resolve();
    assertEquals(router.targetCount, 0);
    assertEquals(router.resolve("project"), FALLBACK_URL);
  });

  await t.step("rejects malformed construction and routing inputs", () => {
    assertThrows(
      () =>
        new RendererRouter("renderer.internal", "file:///tmp/server", {
          staticTargets: ["10.0.0.1"],
        }),
      TypeError,
      "HTTP(S) origin",
    );
    assertThrows(
      () =>
        new RendererRouter("renderer.internal", "http://@fallback", {
          staticTargets: ["10.0.0.1"],
        }),
      TypeError,
      "invalid",
    );
    assertThrows(
      () =>
        new RendererRouter("bad_host", FALLBACK_URL, {
          staticTargets: ["10.0.0.1"],
        }),
      TypeError,
      "discovery host",
    );
    assertThrows(
      () => new RendererRouter("127.1", FALLBACK_URL),
      TypeError,
      "discovery host",
    );
    assertThrows(
      () => new RendererRouter(undefined, FALLBACK_URL),
      TypeError,
      "required",
    );
    assertThrows(
      () =>
        new RendererRouter("renderer.internal", FALLBACK_URL, {
          refreshMs: 0,
        }),
      RangeError,
      "refresh interval",
    );
    assertThrows(
      () =>
        new RendererRouter("renderer.internal", FALLBACK_URL, {
          serverPort: 65_536,
        }),
      RangeError,
      "server port",
    );
    assertThrows(
      () =>
        new RendererRouter("renderer.internal", FALLBACK_URL, {
          staticTargets: ["10.0.0.1:20000"],
        }),
      TypeError,
      "canonical IPv4",
    );
    assertThrows(
      () =>
        new RendererRouter(
          "renderer.internal",
          FALLBACK_URL,
          { refresMs: 1_000 } as never,
        ),
      TypeError,
      "unknown option",
    );

    let optionReads = 0;
    const accessorOptions = Object.defineProperty({}, "serverPort", {
      get() {
        optionReads++;
        return 20_000;
      },
    });
    assertThrows(
      () =>
        new RendererRouter(
          "renderer.internal",
          FALLBACK_URL,
          accessorOptions,
        ),
      TypeError,
      "data property",
    );
    assertEquals(optionReads, 0);

    let targetReads = 0;
    const accessorTargets: string[] = [];
    Object.defineProperty(accessorTargets, "0", {
      configurable: true,
      enumerable: true,
      get() {
        targetReads++;
        return "10.0.0.1";
      },
    });
    assertThrows(
      () => createStaticRouter(accessorTargets),
      TypeError,
      "canonical IPv4",
    );
    assertEquals(targetReads, 0);

    const router = createStaticRouter(["10.0.0.1"]);
    try {
      assertThrows(
        () => router.resolve("invalid slug"),
        TypeError,
        "project slug",
      );
    } finally {
      router.close();
    }
  });

  await t.step("constructs strict static routing from environment values", () => {
    const values: Record<string, string> = {
      VERYFRONT_SERVER_TARGETS: "10.0.1.2, 10.0.1.1,10.0.1.2",
      VERYFRONT_SERVER_PORT: "21000",
      VERYFRONT_SERVER_DISCOVERY_INTERVAL_MS: "15000",
    };
    const router = createRendererRouterFromEnvironment(
      FALLBACK_URL,
      (name) => values[name],
    );
    try {
      assertEquals(router?.targetCount, 2);
      assertEquals(router?.resolve("project").endsWith(":21000"), true);
    } finally {
      router?.close();
    }

    assertEquals(
      createRendererRouterFromEnvironment(FALLBACK_URL, () => undefined),
      null,
    );
    assertThrows(
      () =>
        createRendererRouterFromEnvironment(FALLBACK_URL, (name) => {
          if (name === "VERYFRONT_SERVER_TARGETS") return "10.0.0.1";
          if (name === "VERYFRONT_SERVER_PORT") return "20000junk";
          return undefined;
        }),
      TypeError,
      "decimal integer",
    );
  });
});
