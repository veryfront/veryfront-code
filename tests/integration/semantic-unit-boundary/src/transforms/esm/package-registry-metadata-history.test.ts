import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { createDependencySnapshotStoreHandle } from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
import {
  clearReactVersionCache,
  createDependencyPinningSource,
  getDependencyPinningSnapshot,
  getProjectDependenciesSync,
  isCurrentDependencyPinningSnapshot,
  resolveRequestedDependencyPinningSnapshot,
  withDependencyPinningSourceFileSystem,
} from "#veryfront/transforms/esm/package-registry.ts";

const projectId = "00000000-0000-4000-8000-000000000001";
const emptyKey = "on:54uvgwr2ih7p";

describe("package registry metadata history recovery", () => {
  let oldFlag: string | undefined;
  let oldCohort: string | undefined;
  beforeEach(() => {
    oldFlag = getHostEnv("VERYFRONT_DEPENDENCY_PINNING");
    oldCohort = getHostEnv("VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT");
    setEnv("VERYFRONT_DEPENDENCY_PINNING", "1");
    setEnv("VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT", "100");
    clearReactVersionCache();
  });
  afterEach(() => {
    if (oldFlag === undefined) deleteEnv("VERYFRONT_DEPENDENCY_PINNING");
    else setEnv("VERYFRONT_DEPENDENCY_PINNING", oldFlag);
    if (oldCohort === undefined) deleteEnv("VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT");
    else setEnv("VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT", oldCohort);
    clearReactVersionCache();
  });

  function fixture() {
    const adapter = createMockAdapter();
    const content = '{"dependencies":{"react":"19.2.4"}}';
    adapter.fs.readFile = () => Promise.resolve(content);
    adapter.fs.stat = () =>
      Promise.resolve({
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: content.length,
        mtime: new Date(1000),
      });
    let reads = 0;
    const history = {
      version: 1 as const,
      projectId,
      branch: null as string | null,
      entries: [{ dependencies: {}, expiresAt: Date.now() + 60_000 }],
    };
    adapter.fs.readDependencyMetadataHistory = () => {
      reads++;
      return Promise.resolve(history);
    };
    const options = {
      projectDir: "/synthetic-project",
      projectId,
      isLocalProject: false,
      dependencyWritebackTarget: { kind: "main" as const },
      adapter,
    };
    return {
      adapter,
      history,
      options,
      get reads() {
        return reads;
      },
    };
  }

  it("recovers the prior map but never grants it current writeback authority", async () => {
    const f = fixture();
    const source = createDependencyPinningSource(f.options);
    const current = await getDependencyPinningSnapshot(source);
    const recovered = await resolveRequestedDependencyPinningSnapshot(source, emptyKey);
    assertEquals(recovered?.cacheKey, emptyKey);
    assertEquals({ ...recovered?.dependencies }, {});
    assertEquals(isCurrentDependencyPinningSnapshot(source, emptyKey), false);
    assertEquals(isCurrentDependencyPinningSnapshot(source, current.cacheKey), true);
    assertEquals({ ...getProjectDependenciesSync(source, emptyKey) }, {});
    assertEquals(
      (await resolveRequestedDependencyPinningSnapshot(source, emptyKey))?.cacheKey,
      emptyKey,
    );
    assertEquals(
      f.reads,
      1,
      "retain recovered data with its existing expiry, not a new publication",
    );
  });

  it("uses the preview request branch for both source identity and history matching", async () => {
    const f = fixture();
    f.history.branch = "feature/exact";
    const source = createHandlerDependencyPinningSource({
      projectDir: f.options.projectDir,
      projectId,
      adapter: f.adapter,
      securityConfig: null,
      isLocalProject: false,
      requestContext: {
        slug: "synthetic-project",
        token: "",
        branch: "feature/exact",
        mode: "preview",
      },
    });
    assertEquals(source.branch, "feature/exact");
    assertEquals(source.dependencyWritebackTarget, { kind: "branch", branch: "feature/exact" });
    assertEquals(
      (await resolveRequestedDependencyPinningSnapshot(source, emptyKey))?.cacheKey,
      emptyKey,
    );
    assertEquals(f.reads, 1);
  });

  for (const rollback of ["flag", "cohort"] as const) {
    it(`recovers an exact old key after ${rollback} rollback without enabling publication`, async () => {
      const f = fixture();
      f.adapter.fs.readFile = () => Promise.resolve("{}");
      const source = createDependencyPinningSource({
        ...f.options,
        config: { react: { version: "19.1.0" } },
      });
      const original = await getDependencyPinningSnapshot(source);
      f.adapter.fs.readFile = () => Promise.resolve('{"dependencies":{"zod":"3.0.0"}}');
      clearReactVersionCache();
      if (rollback === "flag") setEnv("VERYFRONT_DEPENDENCY_PINNING", "0");
      else setEnv("VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT", "0");
      assertEquals((await getDependencyPinningSnapshot(source)).cacheKey, "off");
      const recovered = await resolveRequestedDependencyPinningSnapshot(source, original.cacheKey);
      assertEquals(recovered?.cacheKey, original.cacheKey);
      assertEquals(recovered?.configuredVersions, original.configuredVersions);
      assertEquals(f.reads, 1);
      assertEquals(isCurrentDependencyPinningSnapshot(source, original.cacheKey), false);
      assertEquals((await getDependencyPinningSnapshot(source)).cacheKey, "off");
    });
  }

  it("passes the registry cancellation signal to the captured history reader", async () => {
    const f = fixture();
    const signals: AbortSignal[] = [];
    f.adapter.fs.readDependencyMetadataHistory = (signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return Promise.resolve(f.history);
    };
    const source = createDependencyPinningSource(f.options);
    assertEquals(
      (await resolveRequestedDependencyPinningSnapshot(source, emptyKey))?.cacheKey,
      emptyKey,
    );
    assertExists(signals[0]);
    assertEquals(signals[0].aborted, false);
  });

  it("does not read metadata when the current snapshot already matches", async () => {
    const f = fixture();
    const source = createDependencyPinningSource(f.options);
    const current = await getDependencyPinningSnapshot(source);
    assertEquals(
      (await resolveRequestedDependencyPinningSnapshot(source, current.cacheKey))?.cacheKey,
      current.cacheKey,
    );
    assertEquals(f.reads, 0);
  });

  it("fails closed on cross-project and cross-branch history", async () => {
    for (const field of ["projectId", "branch"] as const) {
      clearReactVersionCache();
      const f = fixture();
      f.history[field] = "another-scope";
      const source = createDependencyPinningSource(f.options);
      await assertRejects(() => resolveRequestedDependencyPinningSnapshot(source, emptyKey));
      assertEquals(getProjectDependenciesSync(source, emptyKey), undefined);
    }
  });

  it("does not turn expired history into fresh local retention", async () => {
    const f = fixture();
    f.history.entries[0]!.expiresAt = Date.now() - 1;
    const source = createDependencyPinningSource(f.options);
    assertEquals(await resolveRequestedDependencyPinningSnapshot(source, emptyKey), undefined);
    assertEquals(getProjectDependenciesSync(source, emptyKey), undefined);
  });

  it("captures the original own reader and carries it through tracked filesystems", async () => {
    const f = fixture();
    const source = createDependencyPinningSource(f.options);
    f.adapter.fs.readDependencyMetadataHistory = () => Promise.reject(new Error("replaced"));
    const tracked = withDependencyPinningSourceFileSystem(source, "/tracked", {
      readFile: f.adapter.fs.readFile,
      stat: f.adapter.fs.stat,
    });
    assertEquals(
      (await resolveRequestedDependencyPinningSnapshot(tracked, emptyKey))?.cacheKey,
      emptyKey,
    );
    assertEquals(f.reads, 1);
  });

  it("does not invoke accessors when capturing the reader", () => {
    const f = fixture();
    let invoked = false;
    Object.defineProperty(f.adapter.fs, "readDependencyMetadataHistory", {
      get() {
        invoked = true;
        throw new Error("must not invoke");
      },
    });
    assertThrows(() => createDependencyPinningSource(f.options));
    assertEquals(invoked, false);
  });

  it("treats an optional undefined capability as absent", async () => {
    const f = fixture();
    f.adapter.fs.readDependencyMetadataHistory = undefined;
    const source = createDependencyPinningSource(f.options);
    assertEquals(await resolveRequestedDependencyPinningSnapshot(source, emptyKey), undefined);
  });

  it("does not fall back from an explicitly configured shared store", async () => {
    const f = fixture();
    const source = createDependencyPinningSource({
      ...f.options,
      snapshotStore: createDependencySnapshotStoreHandle({
        publish: () => Promise.resolve(),
        read: () => Promise.resolve(null),
      }),
    });
    assertEquals(await resolveRequestedDependencyPinningSnapshot(source, emptyKey), undefined);
    assertEquals(f.reads, 0);
  });

  it("never queries mutable history for a release or an unbound source", async () => {
    for (
      const patch of [{ releaseId: "immutable-release" }, { dependencyWritebackTarget: undefined }]
    ) {
      clearReactVersionCache();
      const f = fixture();
      const source = createDependencyPinningSource({ ...f.options, ...patch });
      assertEquals(await resolveRequestedDependencyPinningSnapshot(source, emptyKey), undefined);
      assertEquals(f.reads, 0);
    }
  });
});
