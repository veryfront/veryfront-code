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
import { resolveDependencyPinForImport } from "./dependency-resolution.ts";

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
