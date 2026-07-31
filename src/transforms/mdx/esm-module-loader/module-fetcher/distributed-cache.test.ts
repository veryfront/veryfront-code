import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { join } from "#veryfront/compat/path/index.ts";
import type {
  CacheRevisionMutation,
  CacheRevisionSnapshot,
  RevisionedCacheBackend,
} from "#veryfront/cache/types.ts";
import { buildRevisionedCacheKey } from "#veryfront/cache/backend.ts";
import { TRANSFORM_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import {
  __injectCachesForTests as injectTransformCachesForTests,
  __resetInitStateForTests,
} from "#veryfront/transforms/esm/transform-cache.ts";
import {
  __clearInFlightHttpFetches,
  __injectCachesForTests as injectHttpCachesForTests,
  type AcknowledgedBundleManifestAuthority,
  cacheHttpImportsToLocal,
} from "../../../esm/http-cache.ts";
import { computeManifestId } from "../../../esm/bundle-manifest.ts";
import { __setDistributedCacheAccessorForTests } from "../../../esm/http-cache-wrapper.ts";
import {
  type MdxPrimaryPublicationPermit,
  readDistributedCache,
  resolveMdxDistributedTransformCacheKey,
  writeDistributedCache,
} from "./distributed-cache.ts";
import { parseMdxModuleRecoveryPayload } from "./recovery-payload.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

interface LogEntry {
  level: "debug" | "warn" | "info" | "error";
  message: string;
  metadata?: unknown;
}

interface AtomicRecord {
  value: string | null;
  revision: string;
  expiresAtMs?: number;
}

interface ExchangeCall {
  key: string;
  expectedRevision: string;
  mutation: CacheRevisionMutation;
  result: boolean;
}

class FakeRevisionedCache implements RevisionedCacheBackend {
  readonly type = "distributed" as const;
  readonly ordinaryCalls: string[] = [];
  readonly revisionReads: string[] = [];
  readonly exchanges: ExchangeCall[] = [];
  readonly events: string[] = [];
  snapshotOverride?: () => unknown;
  exchangeOverride?: (key: string, mutation: CacheRevisionMutation) => unknown;
  private readonly records = new Map<string, AtomicRecord>();
  private nextRevision = 0;

  get(key: string): Promise<string | null> {
    this.ordinaryCalls.push(`get:${key}`);
    return Promise.reject(new Error("ordinary get must not be used"));
  }

  set(key: string): Promise<void> {
    this.ordinaryCalls.push(`set:${key}`);
    return Promise.reject(new Error("ordinary set must not be used"));
  }

  del(key: string): Promise<void> {
    this.ordinaryCalls.push(`del:${key}`);
    return Promise.reject(new Error("ordinary del must not be used"));
  }

  getWithRevision(key: string): Promise<CacheRevisionSnapshot> {
    this.revisionReads.push(key);
    if (this.snapshotOverride) {
      return Promise.resolve(this.snapshotOverride() as CacheRevisionSnapshot);
    }
    const record = this.records.get(key);
    return Promise.resolve({
      value: record?.value ?? null,
      revision: record?.revision ?? "0",
    });
  }

  compareExchange(
    key: string,
    expectedRevision: string,
    mutation: CacheRevisionMutation,
  ): Promise<boolean> {
    const override = this.exchangeOverride?.(key, mutation);
    if (override !== undefined) return Promise.resolve(override as boolean);

    const current = this.records.get(key);
    const currentRevision = current?.revision ?? "0";
    const accepted = currentRevision === expectedRevision;
    if (accepted) {
      const revision = String(++this.nextRevision);
      this.records.set(key, {
        value: mutation.kind === "set" ? mutation.value : null,
        revision,
        expiresAtMs: mutation.kind === "set" ? mutation.expiresAtMs : undefined,
      });
    }
    this.exchanges.push({ key, expectedRevision, mutation, result: accepted });
    this.events.push(key.includes(":recovery:") ? "recovery-cas" : "primary-cas");
    return Promise.resolve(accepted);
  }

  seed(key: string, value: string | null): AtomicRecord {
    const record = { value, revision: String(++this.nextRevision) };
    this.records.set(key, record);
    return record;
  }

  peek(key: string): AtomicRecord | undefined {
    return this.records.get(key);
  }
}

function createCapturingLogger(): { log: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const log = {
    debug(message: string, metadata?: unknown) {
      entries.push({ level: "debug", message, metadata });
    },
    warn(message: string, metadata?: unknown) {
      entries.push({ level: "warn", message, metadata });
    },
    info(message: string, metadata?: unknown) {
      entries.push({ level: "info", message, metadata });
    },
    error(message: string, metadata?: unknown) {
      entries.push({ level: "error", message, metadata });
    },
    child: () => log,
  } as unknown as Logger;
  return { log, entries };
}

function installDistributedCache(cache: FakeRevisionedCache): void {
  injectTransformCachesForTests({ cacheBackend: cache });
}

async function primaryKey(transformCacheKey: string): Promise<string> {
  return buildRevisionedCacheKey(
    await resolveMdxDistributedTransformCacheKey(transformCacheKey),
  );
}

async function readCache(
  cache: FakeRevisionedCache,
  transformCacheKey: string,
  projectDir: string,
  log: Logger,
) {
  installDistributedCache(cache);
  return await readDistributedCache(
    transformCacheKey,
    "project-a",
    "preview-main",
    "app/page.mdx",
    "project-a",
    projectDir,
    undefined,
    log,
  );
}

function requirePermit(
  result: Awaited<ReturnType<typeof readDistributedCache>>,
): MdxPrimaryPublicationPermit {
  assert(result?.publicationPermit, "Expected a primary publication permit");
  return result.publicationPermit;
}

function extractBundleHashes(code: string): string[] {
  return [
    ...new Set(
      [...code.matchAll(/http-([a-f0-9]+)\.mjs/gi)]
        .map((match) => match[1]?.toLowerCase())
        .filter((hash): hash is string => hash !== undefined),
    ),
  ].sort();
}

async function createTrustedEnvelope(
  code: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const codeHash = await computeHash(code);
  const bundleHashes = extractBundleHashes(code);
  const bundleManifestId = bundleHashes.length > 0
    ? await computeHash(bundleHashes.join(":"))
    : null;
  const envelopeHash = await computeHash(JSON.stringify([
    "veryfront:mdx-distributed-transform:v2",
    codeHash,
    bundleManifestId,
    bundleHashes,
  ]));
  return JSON.stringify({
    formatVersion: 2,
    code,
    codeHash,
    bundleManifestId,
    envelopeHash,
    ...overrides,
  });
}

async function createEnvelopeWithBoundManifestId(
  code: string,
  bundleManifestId: string,
): Promise<string> {
  const codeHash = await computeHash(code);
  const bundleHashes = extractBundleHashes(code);
  return JSON.stringify({
    formatVersion: 2,
    code,
    codeHash,
    bundleManifestId,
    envelopeHash: await computeHash(JSON.stringify([
      "veryfront:mdx-distributed-transform:v2",
      codeHash,
      bundleManifestId,
      bundleHashes,
    ])),
  });
}

async function createManifestAuthority(
  hashes: readonly string[],
): Promise<AcknowledgedBundleManifestAuthority> {
  const bundleHashes = Object.freeze([...new Set(hashes)].sort());
  return Object.freeze({
    manifestId: await computeManifestId([...bundleHashes]),
    bundleHashes,
  });
}

async function createAcknowledgedHttpAuthority(
  projectDir: string,
  label: string,
): Promise<AcknowledgedBundleManifestAuthority> {
  injectHttpCachesForTests({
    cachedPaths: new Map(),
    processingStack: new Set(),
    lastDistributedRefresh: new Map(),
  });
  __setDistributedCacheAccessorForTests(() => Promise.resolve(null));
  const moduleUrl = `https://modules.example/${label}-${crypto.randomUUID()}.js`;
  const result = await withMockFetch(
    (() =>
      Promise.resolve(
        new Response("export const value = true;", {
          headers: { "content-type": "application/javascript" },
        }),
      )) as typeof fetch,
    () =>
      cacheHttpImportsToLocal(
        `import { value } from "${moduleUrl}"; export default value;`,
        {
          cacheDir: join(projectDir, `http-authority-${label}`),
          importMap: { imports: {}, scopes: {} },
        },
        { storeBundleManifest: () => Promise.resolve(true) },
      ),
  );
  assert(result.bundleManifestAuthority, "Expected acknowledged HTTP graph authority");
  return result.bundleManifestAuthority;
}

async function publish(
  permit: MdxPrimaryPublicationPermit,
  moduleCode: string,
  log: Logger,
  bundleManifestAuthority: AcknowledgedBundleManifestAuthority | null = null,
): Promise<void> {
  await writeDistributedCache(
    permit,
    "project-a",
    "preview-main",
    moduleCode,
    bundleManifestAuthority,
    "_vf_modules/app/page.js",
    log,
  );
}

describe("module-fetcher/distributed-cache", () => {
  afterEach(() => {
    injectTransformCachesForTests(null);
    __resetInitStateForTests();
    injectHttpCachesForTests(null);
    __setDistributedCacheAccessorForTests(null);
    __clearInFlightHttpFetches();
  });

  it("returns a frozen primary permit on a revisioned miss", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();

      const result = await readCache(cache, "transform:missing", projectDir, log);

      assertEquals(result?.code, null);
      assertEquals(Object.isFrozen(result?.publicationPermit), true);
      assertEquals(cache.revisionReads, [await primaryKey("transform:missing")]);
    });
  });

  it("rejects a structurally fabricated primary publication permit", async () => {
    const cache = new FakeRevisionedCache();
    const { log } = createCapturingLogger();
    installDistributedCache(cache);

    await assertRejects(
      () =>
        publish(
          Object.freeze({}) as MdxPrimaryPublicationPermit,
          "export const fabricated = true;",
          log,
        ),
      TypeError,
      "MDX primary publication permit is invalid or already used",
    );

    assertEquals(cache.exchanges, []);
  });

  it("allows a genuine primary publication permit to be consumed only once", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const result = await readCache(cache, "transform:single-use", projectDir, log);
      const permit = requirePermit(result);

      await publish(permit, "export const first = true;", log);
      const exchangeCount = cache.exchanges.length;

      await assertRejects(
        () => publish(permit, "export const second = true;", log),
        TypeError,
        "MDX primary publication permit is invalid or already used",
      );

      assertEquals(cache.exchanges.length, exchangeCount);
    });
  });

  it("uses no ordinary backend operation", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const result = await readCache(cache, "transform:atomic-only", projectDir, log);
      const expectedPrimaryKey = await primaryKey("transform:atomic-only");

      await publish(requirePermit(result), "export const value = 1;", log);

      assertEquals(cache.ordinaryCalls, []);
      assertEquals(cache.revisionReads.includes(expectedPrimaryKey), true);
      assertEquals(
        cache.exchanges.some((call) => call.key === expectedPrimaryKey),
        true,
      );
    });
  });

  it("returns validated cached module code on a v2 revisioned hit", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log, entries } = createCapturingLogger();
      cache.seed(
        await primaryKey("transform:hit"),
        await createTrustedEnvelope("export const value = 1;"),
      );

      const result = await readCache(cache, "transform:hit", projectDir, log);

      assertEquals(result?.code, "export const value = 1;");
      assertEquals(
        entries.some((entry) => entry.message.includes("Distributed transform cache HIT")),
        true,
      );
    });
  });

  it("invalid primary data preserves the original publication revision", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const key = await primaryKey("transform:tampered");
      const original = cache.seed(key, '{"formatVersion":2}');

      const result = await readCache(cache, "transform:tampered", projectDir, log);
      await publish(requirePermit(result), "export const replacement = true;", log);

      const primaryExchange = cache.exchanges.find((call) => call.key === key);
      assertEquals(primaryExchange?.expectedRevision, original.revision);
      assertEquals(primaryExchange?.result, true);
      assertEquals(cache.ordinaryCalls, []);
    });
  });

  it("preserves the pre-read deadline and performs no post-compute primary read", async () => {
    using time = new FakeTime();
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const key = await primaryKey("transform:deadline");
      const observedAt = Date.now();
      const result = await readCache(cache, "transform:deadline", projectDir, log);

      await time.tickAsync(30_000);
      await publish(requirePermit(result), "export const delayed = true;", log);

      assertEquals(cache.revisionReads.filter((readKey) => readKey === key).length, 1);
      assertEquals(
        cache.peek(key)?.expiresAtMs,
        observedAt + TRANSFORM_DISTRIBUTED_TTL_SEC * 1_000,
      );
    });
  });

  it("a stale primary writer loses without retry", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const key = await primaryKey("transform:stale-writer");
      const first = await readCache(cache, "transform:stale-writer", projectDir, log);
      const second = await readCache(cache, "transform:stale-writer", projectDir, log);

      await publish(requirePermit(second), "export const winner = 2;", log);
      await publish(requirePermit(first), "export const stale = 1;", log);

      const primaryCalls = cache.exchanges.filter((call) => call.key === key);
      assertEquals(primaryCalls.map((call) => call.result), [true, false]);
      assertEquals(primaryCalls.length, 2);
      assertEquals(
        (JSON.parse(cache.peek(key)?.value ?? "null") as { code?: string }).code,
        "export const winner = 2;",
      );
    });
  });

  it("same-byte primary ABA invalidates the stale permit", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const key = await primaryKey("transform:same-byte-aba");
      const stale = await readCache(cache, "transform:same-byte-aba", projectDir, log);
      const firstWriter = await readCache(cache, "transform:same-byte-aba", projectDir, log);

      await publish(requirePermit(firstWriter), "export const same = true;", log);
      const secondWriter = await readCache(cache, "transform:same-byte-aba", projectDir, log);
      await publish(requirePermit(secondWriter), "export const same = true;", log);
      await publish(requirePermit(stale), "export const stale = true;", log);

      const primaryCalls = cache.exchanges.filter((call) => call.key === key);
      assertEquals(primaryCalls.map((call) => call.result), [true, true, false]);
    });
  });

  it("binds the manifest ID and code-derived bundle hashes into envelopeHash", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const transformKey = "transform:bound-envelope";
      const result = await readCache(cache, transformKey, projectDir, log);
      const manifestAuthority = await createAcknowledgedHttpAuthority(
        projectDir,
        "bound-envelope",
      );
      const directHash = manifestAuthority.bundleHashes[0]!;
      const portableCode = `import value from "./http-${directHash}.mjs"; export default value;`;
      const expectedManifestId = manifestAuthority.manifestId;

      await publish(requirePermit(result), portableCode, log, manifestAuthority);

      const envelope = JSON.parse(cache.peek(await primaryKey(transformKey))?.value ?? "null") as {
        formatVersion: number;
        code: string;
        codeHash: string;
        bundleManifestId: string | null;
        envelopeHash: string;
      };
      const expectedCodeHash = await computeHash(portableCode);
      const expectedEnvelopeHash = await computeHash(JSON.stringify([
        "veryfront:mdx-distributed-transform:v2",
        expectedCodeHash,
        expectedManifestId,
        [directHash],
      ]));

      assertEquals(envelope, {
        formatVersion: 2,
        code: portableCode,
        codeHash: expectedCodeHash,
        bundleManifestId: expectedManifestId,
        envelopeHash: expectedEnvelopeHash,
      });
    });
  });

  it("rejects tampered code and envelope hash", async () => {
    await withTempDir(async (projectDir) => {
      const cases = [
        {
          name: "code",
          envelope: await createTrustedEnvelope("export const original = 1;", {
            code: "export const tampered = 1;",
          }),
        },
        {
          name: "envelope hash",
          envelope: await createTrustedEnvelope("export const value = 1;", {
            envelopeHash: "0".repeat(64),
          }),
        },
      ];

      for (const testCase of cases) {
        const cache = new FakeRevisionedCache();
        const { log, entries } = createCapturingLogger();
        const transformKey = `transform:tampered-${testCase.name}`;
        cache.seed(await primaryKey(transformKey), testCase.envelope);

        const result = await readCache(cache, transformKey, projectDir, log);

        assertEquals(result?.code, null, testCase.name);
        assert(result?.publicationPermit, testCase.name);
        assertEquals(
          entries.some((entry) =>
            entry.level === "warn" &&
            entry.message.includes("Invalid distributed transform cache entry")
          ),
          true,
          testCase.name,
        );
      }
    });
  });

  it("rejects a missing rich manifest instead of falling back to direct code", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log, entries } = createCapturingLogger();
      const transformKey = "transform:missing-rich-manifest";
      const code = 'import value from "./http-aaa111.mjs"; export default value;';
      const authority = await createManifestAuthority(["aaa111", "bbb222"]);
      cache.seed(
        await primaryKey(transformKey),
        await createEnvelopeWithBoundManifestId(code, authority.manifestId),
      );

      const result = await readCache(cache, transformKey, projectDir, log);

      assertEquals(result?.code, null);
      const failure = entries.find((entry) =>
        entry.message.includes("Cached HTTP bundle authority validation failed")
      );
      assertEquals(failure?.metadata, {
        normalizedPath: "app/page.mdx",
        failedHashCount: 0,
        reason: "manifest_missing",
      });
    });
  });

  it("requires null manifest identity when code has no HTTP bundles", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const transformKey = "transform:no-bundles";
      const result = await readCache(cache, transformKey, projectDir, log);

      await publish(requirePermit(result), "export const local = true;", log);

      const envelope = JSON.parse(cache.peek(await primaryKey(transformKey))?.value ?? "null") as {
        bundleManifestId?: unknown;
      };
      assertStrictEquals(envelope.bundleManifestId, null);
    });
  });

  it("withholds publication when bundle-free code carries manifest authority", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const result = await readCache(cache, "transform:unexpected-manifest", projectDir, log);

      await publish(
        requirePermit(result),
        "export const local = true;",
        log,
        await createAcknowledgedHttpAuthority(projectDir, "bundle-free"),
      );

      assertEquals(cache.exchanges, []);
    });
  });

  it("publishes recovery before the primary CAS without rewriting the manifest", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const transformKey = "transform:ordered";
      const result = await readCache(cache, transformKey, projectDir, log);
      const manifestAuthority = await createAcknowledgedHttpAuthority(projectDir, "ordered");
      const directHash = manifestAuthority.bundleHashes[0]!;

      await publish(
        requirePermit(result),
        `import value from "./http-${directHash}.mjs"; export default value;`,
        log,
        manifestAuthority,
      );

      const primaryIndex = cache.events.lastIndexOf("primary-cas");
      assert(primaryIndex > cache.events.indexOf("recovery-cas"));
      assertEquals(cache.events.includes("manifest-store"), false);
    });
  });

  it("missing manifest acknowledgement prevents recovery and primary CAS", async () => {
    await withTempDir(async (projectDir) => {
      for (const missingAuthority of [null, undefined] as const) {
        const cache = new FakeRevisionedCache();
        const { log } = createCapturingLogger();
        const transformKey = `transform:manifest-failure-${String(missingAuthority)}`;
        const expectedPrimaryKey = await primaryKey(transformKey);
        const result = await readCache(cache, transformKey, projectDir, log);

        await publish(
          requirePermit(result),
          'import value from "./http-bad123.mjs"; export default value;',
          log,
          missingAuthority as AcknowledgedBundleManifestAuthority | null,
        );

        assertEquals(
          cache.exchanges.some((call) => call.key === expectedPrimaryKey),
          false,
        );
        assertEquals(cache.exchanges.length, 0);
      }
    });
  });

  it("rejects a structurally forged graph authority without publication", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const transformKey = "transform:forged-authority";
      const expectedPrimaryKey = await primaryKey(transformKey);
      const result = await readCache(cache, transformKey, projectDir, log);

      await publish(
        requirePermit(result),
        'import value from "./http-deadbeef.mjs"; export default value;',
        log,
        await createManifestAuthority(["deadbeef"]),
      );

      assertEquals(
        cache.exchanges.some((call) => call.key === expectedPrimaryKey),
        false,
      );
      assertEquals(cache.exchanges.length, 0);
    });
  });

  it("mismatched manifest acknowledgement prevents recovery and primary CAS", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const transformKey = "transform:mismatched-manifest";
      const expectedPrimaryKey = await primaryKey(transformKey);
      const result = await readCache(cache, transformKey, projectDir, log);
      const authority = await createAcknowledgedHttpAuthority(projectDir, "mismatched");

      await publish(
        requirePermit(result),
        'import value from "./http-deadbeef.mjs"; export default value;',
        log,
        authority,
      );

      assertEquals(
        cache.exchanges.some((call) => call.key === expectedPrimaryKey),
        false,
      );
      assertEquals(cache.exchanges.length, 0);
    });
  });

  it("two code/manifest writers expose only the CAS winner's bound pair", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const transformKey = "transform:two-manifests";
      const first = await readCache(cache, transformKey, projectDir, log);
      const second = await readCache(cache, transformKey, projectDir, log);
      const firstAuthority = await createAcknowledgedHttpAuthority(projectDir, "writer-first");
      const secondAuthority = await createAcknowledgedHttpAuthority(projectDir, "writer-second");
      const firstHash = firstAuthority.bundleHashes[0]!;
      const secondHash = secondAuthority.bundleHashes[0]!;

      await publish(
        requirePermit(second),
        `import value from "./http-${secondHash}.mjs"; export default value;`,
        log,
        secondAuthority,
      );
      await publish(
        requirePermit(first),
        `import value from "./http-${firstHash}.mjs"; export default value;`,
        log,
        firstAuthority,
      );

      const envelope = JSON.parse(cache.peek(await primaryKey(transformKey))?.value ?? "null") as {
        code: string;
        bundleManifestId: string;
      };
      assertEquals(envelope.code.includes(`http-${secondHash}.mjs`), true);
      assertEquals(envelope.bundleManifestId, secondAuthority.manifestId);
    });
  });

  it("publishes a root-to-child graph with detached authority and no manifest rewrite", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const transformKey = "transform:rich-manifest";
      const result = await readCache(cache, transformKey, projectDir, log);
      const rootUrl = `https://modules.example/root-${crypto.randomUUID()}.js`;
      const childUrl = `https://modules.example/child-${crypto.randomUUID()}.js`;
      const cacheDir = join(projectDir, "veryfront-http-bundle");
      let storedManifestBytes: string | undefined;
      let manifestStoreCalls = 0;
      injectHttpCachesForTests({
        cachedPaths: new Map(),
        processingStack: new Set(),
        lastDistributedRefresh: new Map(),
      });
      __setDistributedCacheAccessorForTests(() => Promise.resolve(null));

      const httpResult = await withMockFetch(
        ((input: string | URL | Request) => {
          const code = String(input) === rootUrl
            ? `import { child } from "${childUrl}"; export { child };`
            : "export const child = true;";
          return Promise.resolve(
            new Response(code, {
              headers: { "content-type": "application/javascript" },
            }),
          );
        }) as typeof fetch,
        () =>
          cacheHttpImportsToLocal(
            `import { child } from "${rootUrl}"; export default child;`,
            { cacheDir, importMap: { imports: {}, scopes: {} } },
            {
              storeBundleManifest: async (manifest) => {
                manifestStoreCalls += 1;
                storedManifestBytes = JSON.stringify(manifest);
                manifest.bundles.push({
                  hash: "c0ffee",
                  url: "https://mutator.invalid/ignored.js",
                  sizeBytes: 0,
                });
                await Promise.resolve();
                return true;
              },
            },
          ),
      );
      assert(httpResult.bundleManifestId);
      assert(httpResult.bundleManifestAuthority);
      assertEquals(Object.isFrozen(httpResult.bundleManifestAuthority), true);
      assertEquals(Object.isFrozen(httpResult.bundleManifestAuthority.bundleHashes), true);
      assertEquals(httpResult.bundleManifestAuthority.bundleHashes.length, 2);
      const directHashes = extractBundleHashes(httpResult.code);
      assertEquals(directHashes.length, 1);
      assertEquals(
        httpResult.bundleManifestAuthority.bundleHashes.includes(directHashes[0]!),
        true,
      );
      assertEquals(httpResult.bundleManifestAuthority.bundleHashes.includes("c0ffee"), false);
      const richManifestBytes = storedManifestBytes;
      assert(richManifestBytes);

      await publish(
        requirePermit(result),
        httpResult.code,
        log,
        httpResult.bundleManifestAuthority,
      );

      assertEquals(storedManifestBytes, richManifestBytes);
      assertEquals(manifestStoreCalls, 1);
      assert(cache.peek(await primaryKey(transformKey))?.value);
      assertEquals(cache.ordinaryCalls, []);
    });
  });

  it("performs no :bm read, write, or delete", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const result = await readCache(cache, "transform:no-pointer", projectDir, log);
      const authority = await createAcknowledgedHttpAuthority(projectDir, "no-pointer");
      const directHash = authority.bundleHashes[0]!;

      await publish(
        requirePermit(result),
        `import value from "./http-${directHash}.mjs"; export default value;`,
        log,
        authority,
      );

      assertEquals(
        [...cache.revisionReads, ...cache.exchanges.map((call) => call.key)]
          .some((key) => key.includes(":bm")),
        false,
      );
      assertEquals(cache.ordinaryCalls, []);
    });
  });

  it("rejects malformed revision snapshots without creating a permit", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      cache.snapshotOverride = () => ({ value: null, revision: "1", extra: true });

      const result = await readCache(cache, "transform:bad-snapshot", projectDir, log);

      assertEquals(result?.code, null);
      assertEquals(result?.publicationPermit ?? null, null);
      assertEquals(cache.revisionReads.length, 1);
      assertEquals(cache.exchanges.length, 0);
    });
  });

  it("classifies a hostile cache failure without invoking proxy traps", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log, entries } = createCapturingLogger();
      const trapFailure = new Error("getPrototypeOf trap must not escape");
      const thrownValue = new Proxy({}, {
        getPrototypeOf() {
          throw trapFailure;
        },
      });
      cache.snapshotOverride = () => {
        throw thrownValue;
      };

      const result = await readCache(cache, "transform:hostile-failure", projectDir, log);

      assertEquals(result, { code: null, publicationPermit: null });
      assertEquals(
        entries.find((entry) => entry.message.includes("observation failed"))?.metadata,
        {
          normalizedPath: "app/page.mdx",
          errorName: "object",
        },
      );
    });
  });

  it("rejects non-boolean primary exchanges without exposing a record", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log, entries } = createCapturingLogger();
      const transformKey = "transform:bad-exchange";
      const key = await primaryKey(transformKey);
      const result = await readCache(cache, transformKey, projectDir, log);
      cache.exchangeOverride = (candidateKey) => candidateKey === key ? 1 : undefined;

      await publish(requirePermit(result), "export const value = 1;", log);

      assertEquals(cache.peek(key), undefined);
      assertEquals(
        entries.some((entry) => entry.message.includes("publication failed")),
        true,
      );
    });
  });

  it("publishes a revisioned recovery payload with the primary deadline", async () => {
    await withTempDir(async (projectDir) => {
      const cache = new FakeRevisionedCache();
      const { log } = createCapturingLogger();
      const result = await readCache(cache, "transform:recovery", projectDir, log);
      await publish(requirePermit(result), "export default 1;", log);

      const recovery = cache.exchanges.find((call) => call.key.includes(":recovery:"));
      const primary = cache.exchanges.find((call) => !call.key.includes(":recovery:"));
      assertEquals(recovery?.mutation.kind, "set");
      assertEquals(primary?.mutation.kind, "set");
      if (recovery?.mutation.kind === "set" && primary?.mutation.kind === "set") {
        assertEquals(recovery.mutation.expiresAtMs, primary.mutation.expiresAtMs);
        const payload = parseMdxModuleRecoveryPayload(recovery.mutation.value, {
          projectId: "project-a",
          contentSourceId: "preview-main",
          fileName: JSON.parse(recovery.mutation.value).fileName,
        });
        assertEquals(payload?.portableCode, "export default 1;");
      }
    });
  });

  it("hashes keys whose fully prefixed identity exceeds API constraints", async () => {
    const prefix = "transform:";
    const boundaryKey = "k".repeat(512 - prefix.length);
    const oversizedKey = `${boundaryKey}k`;
    const unsafeKey = "_vf_modules/app/(marketing)/[slug].tsx";

    assertEquals(await resolveMdxDistributedTransformCacheKey(boundaryKey), boundaryKey);
    assertEquals(
      await resolveMdxDistributedTransformCacheKey(oversizedKey),
      `sha256:${await computeHash(`${prefix}${oversizedKey}`)}`,
    );
    assertEquals(
      await resolveMdxDistributedTransformCacheKey(unsafeKey),
      `sha256:${await computeHash(`${prefix}${unsafeKey}`)}`,
    );
  });

  it("uses one bounded reserved identity for long and unsafe primary keys", async () => {
    await withTempDir(async (projectDir) => {
      for (
        const sourceKey of [
          `mdx:${"nested/".repeat(90)}module:content`,
          "_vf_modules/app/(marketing)/[slug].tsx",
        ]
      ) {
        const cache = new FakeRevisionedCache();
        const { log } = createCapturingLogger();
        const result = await readCache(cache, sourceKey, projectDir, log);
        await publish(requirePermit(result), "export const written = true;", log);

        const expectedKey = await primaryKey(sourceKey);
        assertEquals(cache.revisionReads.filter((key) => key === expectedKey).length, 1);
        assertEquals(cache.exchanges.some((call) => call.key === expectedKey), true);
        assertEquals(cache.ordinaryCalls, []);
      }
    });
  });
});
