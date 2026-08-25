import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import {
  clearReactVersionCache,
  type DependencyPinningSource,
  getDependencyPinningSnapshot,
  isCurrentDependencyPinningSnapshot,
} from "../esm/package-registry.ts";
import {
  _clearNpmVersionCache,
  _pendingResolutions,
  _setDependencyResolutionPosterForTest,
} from "../esm/npm-registry-client.ts";
import {
  isPinningEnabledForRewrite,
  resolveDependencyPinForImport,
  validateDependencyResolutionObservations,
} from "./dependency-resolution.ts";

interface MemoryPackageState {
  content: string;
  mtime: Date;
}

function memorySource(
  cacheNamespace: string,
  state: MemoryPackageState,
  provenance: Pick<
    DependencyPinningSource,
    | "branch"
    | "contentSourceId"
    | "dependencyWritebackTarget"
    | "dependencyWritebackToken"
    | "releaseId"
  > = {},
): DependencyPinningSource {
  return {
    projectDir: "/shared/proxy-project",
    cacheNamespace,
    ...provenance,
    fs: {
      readFile: () => Promise.resolve(state.content),
      stat: () =>
        Promise.resolve({
          size: state.content.length,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: state.mtime,
        }),
    },
  };
}

describe("dependency resolution write-back authority", () => {
  let originalFlag: string | undefined;

  beforeEach(() => {
    originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    clearReactVersionCache();
    _clearNpmVersionCache();
  });

  afterEach(async () => {
    await _pendingResolutions();
    _clearNpmVersionCache();
    clearReactVersionCache();
    if (originalFlag === undefined) {
      deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
    } else {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
    }
  });

  it("posts current B once and never lets a later historical A replace it", async () => {
    const state: MemoryPackageState = {
      content: JSON.stringify({ dependencies: { zod: "^3" } }),
      mtime: new Date(1_000),
    };
    const source = memorySource('["project-a","branch-main"]', state, {
      dependencyWritebackTarget: { kind: "main" },
    });
    const snapshotA = await getDependencyPinningSnapshot(source);

    state.content = JSON.stringify({ dependencies: { zod: "^4" } });
    state.mtime = new Date(2_000);
    const snapshotB = await getDependencyPinningSnapshot(source);

    const requests: string[][] = [];
    _setDependencyResolutionPosterForTest((_projectId, specifiers) => {
      requests.push(specifiers);
      return Promise.resolve();
    });

    const resolveFrom = (
      snapshot: Awaited<ReturnType<typeof getDependencyPinningSnapshot>>,
    ) =>
      resolveDependencyPinForImport("zod", {
        projectDir: source.projectDir,
        projectId: "project-a",
        dependencyPinningSource: source,
        dependencyPinningCacheKey: snapshot.cacheKey,
        dependencyPinningDependencies: snapshot.dependencies,
      });

    resolveFrom(snapshotB);
    resolveFrom(snapshotB);
    resolveFrom(snapshotA);
    await _pendingResolutions();

    assertEquals(isCurrentDependencyPinningSnapshot(source, snapshotA.cacheKey), false);
    assertEquals(isCurrentDependencyPinningSnapshot(source, snapshotB.cacheKey), true);
    assertEquals(requests, [["zod@^4"]]);
  });

  it("drops queued A when B becomes current before the flush", async () => {
    const state: MemoryPackageState = {
      content: JSON.stringify({ dependencies: { zod: "^3" } }),
      mtime: new Date(1_000),
    };
    const source = memorySource('["project-a","branch-main"]', state, {
      dependencyWritebackTarget: { kind: "main" },
    });
    const snapshotA = await getDependencyPinningSnapshot(source);
    const requests: string[][] = [];
    _setDependencyResolutionPosterForTest((_projectId, specifiers) => {
      requests.push(specifiers);
      return Promise.resolve();
    });

    resolveDependencyPinForImport("zod", {
      projectDir: source.projectDir,
      projectId: "project-a",
      dependencyPinningSource: source,
      dependencyPinningCacheKey: snapshotA.cacheKey,
      dependencyPinningDependencies: snapshotA.dependencies,
    });

    state.content = JSON.stringify({ dependencies: { zod: "^4" } });
    state.mtime = new Date(2_000);
    // Calling the async capture synchronously revokes A before the scheduler's
    // microtask flush; B is authorized only after its immutable capture lands.
    const snapshotBPromise = getDependencyPinningSnapshot(source);
    const snapshotB = await snapshotBPromise;
    await _pendingResolutions();

    assertEquals(isCurrentDependencyPinningSnapshot(source, snapshotA.cacheKey), false);
    assertEquals(isCurrentDependencyPinningSnapshot(source, snapshotB.cacheKey), true);
    assertEquals(requests, []);
  });

  it("fails closed when a proxy rewrite drops its source namespace", async () => {
    const state: MemoryPackageState = {
      content: JSON.stringify({ dependencies: { zod: "^4" } }),
      mtime: new Date(1_000),
    };
    const source = memorySource('["project-a","release-a"]', state, {
      dependencyWritebackTarget: { kind: "main" },
    });
    const snapshot = await getDependencyPinningSnapshot(source);
    const requests: string[][] = [];
    _setDependencyResolutionPosterForTest((_projectId, specifiers) => {
      requests.push(specifiers);
      return Promise.resolve();
    });

    resolveDependencyPinForImport("zod", {
      projectDir: source.projectDir,
      projectId: "project-a",
      dependencyPinningCacheKey: snapshot.cacheKey,
      dependencyPinningDependencies: snapshot.dependencies,
    });
    await _pendingResolutions();

    assertEquals(requests, []);
  });

  it("forwards the exact main or branch target from the current source", async () => {
    const requests: Array<{ specifiers: string[]; target: string }> = [];
    _setDependencyResolutionPosterForTest((_projectId, specifiers, target) => {
      requests.push({
        specifiers,
        target: target.kind === "main" ? "main" : `branch:${target.branch}`,
      });
      return Promise.resolve();
    });
    const cases: Array<{
      namespace: string;
      provenance: Pick<
        DependencyPinningSource,
        | "branch"
        | "contentSourceId"
        | "dependencyWritebackTarget"
        | "releaseId"
      >;
    }> = [
      {
        namespace: '["project-a","branch-feature"]',
        provenance: {
          branch: "feature",
          dependencyWritebackTarget: { kind: "branch", branch: "feature" },
        },
      },
      {
        namespace: '["project-a","content-preview"]',
        provenance: {
          branch: "main",
          contentSourceId: "preview-main",
          dependencyWritebackTarget: { kind: "main" },
        },
      },
    ];

    for (const { namespace, provenance } of cases) {
      const state: MemoryPackageState = {
        content: JSON.stringify({ dependencies: { zod: "^4" } }),
        mtime: new Date(1_000),
      };
      const source = memorySource(namespace, state, provenance);
      const snapshot = await getDependencyPinningSnapshot(source);

      resolveDependencyPinForImport("zod", {
        projectDir: source.projectDir,
        projectId: "project-a",
        dependencyPinningSource: source,
        dependencyPinningCacheKey: snapshot.cacheKey,
        dependencyPinningDependencies: snapshot.dependencies,
      });
    }
    await _pendingResolutions();

    assertEquals(requests, [
      { specifiers: ["zod@^4"], target: "branch:feature" },
      { specifiers: ["zod@^4"], target: "main" },
    ]);
  });

  it("forwards request-scoped authorization from the current source", async () => {
    const state: MemoryPackageState = {
      content: JSON.stringify({ dependencies: { zod: "^3" } }),
      mtime: new Date(1_000),
    };
    const source = memorySource('["project-a","branch-feature"]', state, {
      branch: "feature",
      dependencyWritebackTarget: { kind: "branch", branch: "feature" },
      dependencyWritebackToken: "request-scoped-token",
    });
    let requestToken: string | undefined;
    _setDependencyResolutionPosterForTest(
      (_projectId, _specifiers, _target, _expected, token) => {
        requestToken = token;
        return Promise.resolve();
      },
    );
    const snapshot = await getDependencyPinningSnapshot(source);

    resolveDependencyPinForImport("zod", {
      projectDir: source.projectDir,
      projectId: "project-a",
      dependencyPinningSource: source,
      dependencyPinningCacheKey: snapshot.cacheKey,
      dependencyPinningDependencies: snapshot.dependencies,
    });
    await _pendingResolutions();

    assertEquals(requestToken, "request-scoped-token");
  });

  it("resolves an own constructor declaration without prototype interference", async () => {
    const state: MemoryPackageState = {
      content: JSON.stringify({ dependencies: { constructor: "^1" } }),
      mtime: new Date(1_000),
    };
    const source = memorySource('["project-a","constructor-declared"]', state, {
      dependencyWritebackTarget: { kind: "main" },
    });
    const snapshot = await getDependencyPinningSnapshot(source);
    const requests: string[][] = [];
    _setDependencyResolutionPosterForTest((_projectId, specifiers) => {
      requests.push(specifiers);
      return Promise.resolve();
    });

    resolveDependencyPinForImport("constructor", {
      projectDir: source.projectDir,
      projectId: "project-a",
      dependencyPinningSource: source,
      dependencyPinningCacheKey: snapshot.cacheKey,
      dependencyPinningDependencies: snapshot.dependencies,
    });
    await _pendingResolutions();

    assertEquals(requests, [["constructor@^1"]]);
  });

  it("treats an inherited constructor property as undeclared", async () => {
    const state: MemoryPackageState = {
      content: JSON.stringify({ dependencies: {} }),
      mtime: new Date(1_000),
    };
    const source = memorySource('["project-a","constructor-absent"]', state, {
      dependencyWritebackTarget: { kind: "main" },
    });
    const snapshot = await getDependencyPinningSnapshot(source);
    const requests: string[][] = [];
    _setDependencyResolutionPosterForTest((_projectId, specifiers) => {
      requests.push(specifiers);
      return Promise.resolve();
    });

    resolveDependencyPinForImport("constructor", {
      projectDir: source.projectDir,
      projectId: "project-a",
      dependencyPinningSource: source,
      dependencyPinningCacheKey: snapshot.cacheKey,
      dependencyPinningDependencies: snapshot.dependencies,
    });
    await _pendingResolutions();

    assertEquals(requests, [["constructor"]]);
  });

  it("never writes release or unproven sources without an explicit target", async () => {
    const requests: string[][] = [];
    _setDependencyResolutionPosterForTest((_projectId, specifiers) => {
      requests.push(specifiers);
      return Promise.resolve();
    });
    const sources = [
      memorySource(
        '["project-a","release-a"]',
        {
          content: JSON.stringify({ dependencies: { zod: "^4" } }),
          mtime: new Date(1_000),
        },
        { releaseId: "release-a" },
      ),
      memorySource('["project-a","unproven"]', {
        content: JSON.stringify({ dependencies: { zod: "^4" } }),
        mtime: new Date(1_000),
      }),
    ];

    for (const source of sources) {
      const snapshot = await getDependencyPinningSnapshot(source);
      resolveDependencyPinForImport("zod", {
        projectDir: source.projectDir,
        projectId: "project-a",
        dependencyPinningSource: source,
        dependencyPinningCacheKey: snapshot.cacheKey,
        dependencyPinningDependencies: snapshot.dependencies,
      });
    }
    await _pendingResolutions();

    assertEquals(requests, []);
  });

  it("treats an inherited __proto__ property as an absent dependency", async () => {
    const state: MemoryPackageState = {
      content: '{"dependencies":{}}',
      mtime: new Date(1_000),
    };
    const source = memorySource('["project-a","prototype-absent"]', state, {
      dependencyWritebackTarget: { kind: "main" },
    });
    const snapshot = await getDependencyPinningSnapshot(source);
    const requests: Array<{
      specifiers: string[];
      expected: Readonly<Record<string, string | null>>;
    }> = [];
    _setDependencyResolutionPosterForTest(
      (_projectId, specifiers, _target, expected) => {
        requests.push({ specifiers, expected });
        return Promise.resolve();
      },
    );

    resolveDependencyPinForImport("__proto__", {
      projectDir: source.projectDir,
      projectId: "project-a",
      dependencyPinningSource: source,
      dependencyPinningCacheKey: snapshot.cacheKey,
      dependencyPinningDependencies: snapshot.dependencies,
    });
    await _pendingResolutions();

    assertEquals(requests.length, 1);
    const request = requests[0]!;
    assertEquals(request.specifiers, ["__proto__"]);
    assertEquals(Object.hasOwn(request.expected, "__proto__"), true);
    assertEquals(request.expected["__proto__"], null);
  });

  it("preserves a declared __proto__ package declaration", async () => {
    const state: MemoryPackageState = {
      content: '{"dependencies":{"__proto__":"^1.2.3"}}',
      mtime: new Date(1_000),
    };
    const source = memorySource('["project-a","prototype-declared"]', state, {
      dependencyWritebackTarget: { kind: "main" },
    });
    const snapshot = await getDependencyPinningSnapshot(source);
    const requests: Array<{
      specifiers: string[];
      expected: Readonly<Record<string, string | null>>;
    }> = [];
    _setDependencyResolutionPosterForTest(
      (_projectId, specifiers, _target, expected) => {
        requests.push({ specifiers, expected });
        return Promise.resolve();
      },
    );

    resolveDependencyPinForImport("__proto__", {
      projectDir: source.projectDir,
      projectId: "project-a",
      dependencyPinningSource: source,
      dependencyPinningCacheKey: snapshot.cacheKey,
      dependencyPinningDependencies: snapshot.dependencies,
    });
    await _pendingResolutions();

    assertEquals(requests.length, 1);
    const request = requests[0]!;
    assertEquals(request.specifiers, ["__proto__@^1.2.3"]);
    assertEquals(request.expected["__proto__"], "^1.2.3");
  });
});

describe("validateDependencyResolutionObservations", () => {
  const dependencies: Readonly<Record<string, string>> = { zod: "^3", lodash: "4.17.21" };

  it("replays observations that match the current dependency map", () => {
    assertEquals(
      validateDependencyResolutionObservations(
        [
          { packageName: "zod", declaration: "^3" },
          { packageName: "undeclared", declaration: null },
        ],
        dependencies,
      ),
      [
        { packageName: "zod", declaration: "^3" },
        { packageName: "undeclared", declaration: null },
      ],
      "observations agreeing with the current snapshot must replay unchanged",
    );
  });

  it("rejects a duplicate package observation", () => {
    assertEquals(
      validateDependencyResolutionObservations(
        [
          { packageName: "zod", declaration: "^3" },
          { packageName: "zod", declaration: "^3" },
        ],
        dependencies,
      ),
      null,
      "a duplicate package name must not replay",
    );
  });

  it("rejects a declaration captured under another snapshot", () => {
    assertEquals(
      validateDependencyResolutionObservations(
        [{ packageName: "zod", declaration: "^4" }],
        dependencies,
      ),
      null,
      "a declaration that disagrees with the current map must not replay",
    );
  });

  it("rejects an undeclared package claimed as declared", () => {
    assertEquals(
      validateDependencyResolutionObservations(
        [{ packageName: "undeclared", declaration: "^1" }],
        dependencies,
      ),
      null,
      "an undeclared package must observe a null declaration",
    );
  });

  it("rejects observations when the dependency map is unknown", () => {
    assertEquals(
      validateDependencyResolutionObservations(
        [{ packageName: "zod", declaration: "^3" }],
        undefined,
      ),
      null,
      "an unverified dependency map must not authorize a replay",
    );
    assertEquals(
      validateDependencyResolutionObservations([], undefined),
      [],
      "an empty observation list stays safe without a dependency map",
    );
  });

  it("rejects malformed observation metadata", () => {
    assertEquals(
      validateDependencyResolutionObservations("not-an-array", dependencies),
      null,
      "a non-array value must not replay",
    );
    assertEquals(
      validateDependencyResolutionObservations([null], dependencies),
      null,
      "a null entry must not replay",
    );
    assertEquals(
      validateDependencyResolutionObservations(
        [{ packageName: 7, declaration: null }],
        dependencies,
      ),
      null,
      "a non-string package name must not replay",
    );
    assertEquals(
      validateDependencyResolutionObservations(
        [{ packageName: "", declaration: null }],
        dependencies,
      ),
      null,
      "an empty package name must not replay",
    );
    assertEquals(
      validateDependencyResolutionObservations(
        [{ packageName: "zod", declaration: 3 }],
        dependencies,
      ),
      null,
      "a non-string declaration must not replay",
    );
  });
});

describe("isPinningEnabledForRewrite", () => {
  const PERCENT_ENV = "VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT";
  const PROJECTS_ENV = "VERYFRONT_DEPENDENCY_PINNING_PROJECTS";
  let originalFlag: string | undefined;
  let originalPercent: string | undefined;
  let originalProjects: string | undefined;

  beforeEach(() => {
    originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    originalPercent = getHostEnv(PERCENT_ENV);
    originalProjects = getHostEnv(PROJECTS_ENV);
  });

  afterEach(() => {
    if (originalFlag === undefined) deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
    else setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
    if (originalPercent === undefined) deleteEnv(PERCENT_ENV);
    else setEnv(PERCENT_ENV, originalPercent);
    if (originalProjects === undefined) deleteEnv(PROJECTS_ENV);
    else setEnv(PROJECTS_ENV, originalProjects);
  });

  it("should trust an on cache key without consulting the cohort", () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    setEnv(PERCENT_ENV, "0");
    deleteEnv(PROJECTS_ENV);
    // The snapshot already decided. Re-deciding here would let a mid-render
    // configuration change split one render across two policies.
    assertEquals(
      isPinningEnabledForRewrite({
        dependencyPinningCacheKey: "on:abc",
        projectId: "project-abc",
      }),
      true,
    );
  });

  it("should reject the unknown snapshot key", () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    setEnv(PERCENT_ENV, "100");
    assertEquals(
      isPinningEnabledForRewrite({
        dependencyPinningCacheKey: "on:unknown",
        projectId: "project-abc",
      }),
      false,
    );
  });

  it("should treat an off cache key as disabled", () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    setEnv(PERCENT_ENV, "100");
    assertEquals(
      isPinningEnabledForRewrite({
        dependencyPinningCacheKey: "off",
        projectId: "project-abc",
      }),
      false,
    );
  });

  it("should apply the cohort when no cache key is present", () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    setEnv(PERCENT_ENV, "0");
    setEnv(PROJECTS_ENV, "project-abc");
    assertEquals(isPinningEnabledForRewrite({ projectId: "project-abc" }), true);
    assertEquals(isPinningEnabledForRewrite({ projectId: "project-other" }), false);
  });

  it("should stay disabled with no cache key when the flag is off", () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
    setEnv(PERCENT_ENV, "100");
    assertEquals(isPinningEnabledForRewrite({ projectId: "project-abc" }), false);
  });
});
