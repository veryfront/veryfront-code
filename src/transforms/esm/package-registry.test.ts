import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import {
  _clearNpmVersionCache,
  _pendingResolutions,
  _setDependencyResolutionPosterForTest,
} from "#veryfront/transforms/esm/npm-registry-client.ts";
import { rewriteSSRImportsCompat } from "../import-rewriter/ssr-adapter.ts";
import {
  _getDependencyVersionReadOperationsForTest,
  _primeDependenciesCache,
  clearReactVersionCache,
  createDependencyPinningSource,
  type DependencyPinningSource,
  ensureProjectDependenciesLoaded,
  getDependencyPinningCacheKey,
  getDependencyPinningSnapshot,
  getProjectDependenciesSync,
  isValidReactVersion,
  normalizeReactVersion,
  readProjectDependencyVersions,
  resolveDependencyPinningSnapshot,
  resolveDependencyWritebackTarget,
  resolveProjectPackageVersions,
  resolveProjectReactVersion,
  resolveRequestedDependencyPinningSnapshot,
  stripSemverRange,
} from "./package-registry.ts";
import { DEFAULT_REACT_VERSION } from "./react-cdn.ts";

function cacheKeyForDependencies(
  dependencies: Readonly<Record<string, string>>,
): string {
  const sortedEntries = Object.entries(dependencies).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `on:${hashString(JSON.stringify(sortedEntries))}`;
}

describe("package-registry", () => {
  describe("stripSemverRange", () => {
    it("should strip ^ prefix", () => {
      assertEquals(stripSemverRange("^19.0.0"), "19.0.0");
    });

    it("should strip ~ prefix", () => {
      assertEquals(stripSemverRange("~19.0.0"), "19.0.0");
    });

    it("should strip >= prefix", () => {
      assertEquals(stripSemverRange(">=19.0.0"), "19.0.0");
    });

    it("should strip > prefix", () => {
      assertEquals(stripSemverRange(">19.0.0"), "19.0.0");
    });

    it("should not modify exact versions", () => {
      assertEquals(stripSemverRange("19.1.1"), "19.1.1");
    });

    it("strips the remaining documented range prefixes", () => {
      assertEquals(stripSemverRange("<=19.0.0"), "19.0.0", "strips <=");
      assertEquals(stripSemverRange("<19.0.0"), "19.0.0", "strips <");
      assertEquals(stripSemverRange("=19.0.0"), "19.0.0", "strips bare =");
    });
  });

  describe("isValidReactVersion", () => {
    it("accepts stable, v-prefixed, prerelease, and build exact SemVer", () => {
      assertEquals(isValidReactVersion("19.1.1"), true);
      assertEquals(isValidReactVersion("v19.1.1"), true);
      assertEquals(isValidReactVersion("19.2.0-rc.1"), true);
      assertEquals(isValidReactVersion("19.2.0-rc.1+build.7"), true);
    });

    it("should reject range prefixes", () => {
      assertEquals(isValidReactVersion("^19.0.0"), false);
    });

    it("should reject incomplete versions", () => {
      assertEquals(isValidReactVersion("19.0"), false);
    });
  });

  describe("normalizeReactVersion", () => {
    it("should return valid version unchanged", () => {
      assertEquals(normalizeReactVersion("19.0.0"), "19.0.0");
    });

    it("preserves exact v-prefixed, prerelease, and build versions", () => {
      assertEquals(normalizeReactVersion("v19.1.1"), "v19.1.1");
      assertEquals(normalizeReactVersion("19.2.0-rc.1"), "19.2.0-rc.1");
      assertEquals(
        normalizeReactVersion("19.2.0-rc.1+build.7"),
        "19.2.0-rc.1+build.7",
      );
    });

    it("should fallback to default for undefined", () => {
      assertEquals(normalizeReactVersion(undefined), DEFAULT_REACT_VERSION);
    });

    it("should fallback to default for invalid format", () => {
      assertEquals(normalizeReactVersion("not-a-version"), DEFAULT_REACT_VERSION);
    });
  });

  describe("resolveDependencyWritebackTarget", () => {
    it("returns main target for a mutable preview context", () => {
      assertEquals(
        resolveDependencyWritebackTarget({
          environment: "preview",
          isLocalProject: false,
          releaseId: null,
          branch: null,
        }),
        { kind: "main" },
      );
    });

    it("returns branch target for a non-main preview branch", () => {
      assertEquals(
        resolveDependencyWritebackTarget({
          environment: "preview",
          isLocalProject: false,
          releaseId: null,
          branch: "feature-x",
        }),
        { kind: "branch", branch: "feature-x" },
      );
    });

    it("rejects production and missing environment", () => {
      assertEquals(
        resolveDependencyWritebackTarget({
          environment: "production",
          isLocalProject: false,
          releaseId: null,
        }),
        undefined,
      );
      assertEquals(
        resolveDependencyWritebackTarget({ isLocalProject: false, releaseId: null }),
        undefined,
      );
    });

    it("rejects local and unknown project mode (fail closed)", () => {
      assertEquals(
        resolveDependencyWritebackTarget({
          environment: "preview",
          isLocalProject: true,
          releaseId: null,
        }),
        undefined,
      );
      assertEquals(
        resolveDependencyWritebackTarget({ environment: "preview", releaseId: null }),
        undefined,
      );
    });

    it("rejects any present release ID, including empty string (fail closed)", () => {
      assertEquals(
        resolveDependencyWritebackTarget({
          environment: "preview",
          isLocalProject: false,
          releaseId: "rel_123",
        }),
        undefined,
      );
      assertEquals(
        resolveDependencyWritebackTarget({
          environment: "preview",
          isLocalProject: false,
          releaseId: "",
        }),
        undefined,
      );
    });

    it("rejects malformed branch values", () => {
      assertEquals(
        resolveDependencyWritebackTarget({
          environment: "preview",
          isLocalProject: false,
          releaseId: null,
          branch: "",
        }),
        undefined,
      );
      assertEquals(
        resolveDependencyWritebackTarget({
          environment: "preview",
          isLocalProject: false,
          releaseId: null,
          branch: " padded ",
        }),
        undefined,
      );
    });

    it("treats the main branch as the main target", () => {
      assertEquals(
        resolveDependencyWritebackTarget({
          environment: "preview",
          isLocalProject: false,
          releaseId: null,
          branch: "main",
        }),
        { kind: "main" },
      );
    });
  });

  describe("resolveProjectReactVersion", () => {
    afterEach(() => {
      clearReactVersionCache();
    });

    it("should return DEFAULT_REACT_VERSION when no options", async () => {
      const version = await resolveProjectReactVersion({});
      assertEquals(version, DEFAULT_REACT_VERSION);
    });

    it("should return DEFAULT_REACT_VERSION for null projectDir", async () => {
      const version = await resolveProjectReactVersion({ projectDir: null });
      assertEquals(version, DEFAULT_REACT_VERSION);
    });

    it("should return DEFAULT_REACT_VERSION for nonexistent projectDir", async () => {
      const version = await resolveProjectReactVersion({
        projectDir: "/nonexistent/path",
      });
      assertEquals(version, DEFAULT_REACT_VERSION);
    });

    it("should prefer config override over everything", async () => {
      const version = await resolveProjectReactVersion({
        projectDir: "/nonexistent/path",
        config: {
          client: {
            cdn: {
              versions: {
                react: "18.3.1",
              },
            },
          },
        },
      });
      assertEquals(version, "18.3.1");
    });

    it("uses the documented top-level React version override", async () => {
      const version = await resolveProjectReactVersion({
        projectDir: "/nonexistent/path",
        config: {
          react: { version: "18.3.1" },
        },
      });

      assertEquals(version, "18.3.1");
    });

    it("should strip range prefix from config override", async () => {
      const version = await resolveProjectReactVersion({
        config: {
          client: {
            cdn: {
              versions: {
                react: "^18.3.1",
              },
            },
          },
        },
      });
      assertEquals(version, "18.3.1");
    });

    it("should skip config when versions is 'auto'", async () => {
      const version = await resolveProjectReactVersion({
        config: {
          client: {
            cdn: {
              versions: "auto",
            },
          },
        },
      });
      assertEquals(version, DEFAULT_REACT_VERSION);
    });

    it("should skip config when versions.react is not set", async () => {
      const version = await resolveProjectReactVersion({
        config: {
          client: {
            cdn: {
              versions: {
                veryfront: "0.1.10",
              },
            },
          },
        },
      });
      assertEquals(version, DEFAULT_REACT_VERSION);
    });

    it("uses the captured dependency snapshot instead of the current package state", async () => {
      const dir = await Deno.makeTempDir({ prefix: "vf-snapshot-react-version-" });

      try {
        await Deno.writeTextFile(
          `${dir}/package.json`,
          JSON.stringify({ dependencies: { react: "^19.1.1" } }),
        );

        const version = await resolveProjectReactVersion({
          projectDir: dir,
          dependencyPinningCacheKey: "on:snapshot-a",
          dependencyPinningDependencies: { react: "^18.3.1" },
        });

        assertEquals(version, "18.3.1");
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    });

    it("preserves an exact prerelease React version from the captured snapshot", async () => {
      const version = await resolveProjectReactVersion({
        dependencyPinningCacheKey: "on:snapshot-prerelease",
        dependencyPinningDependencies: {
          react: "19.2.0-rc.1+build.7",
        },
      });

      assertEquals(version, "19.2.0-rc.1+build.7");
    });

    it("keeps a captured dependency snapshot authoritative over current config", async () => {
      const snapshot = {
        dependencyPinningCacheKey: "on:snapshot-a",
        dependencyPinningDependencies: { react: "^18.2.0" },
      };

      assertEquals(
        await resolveProjectReactVersion({
          ...snapshot,
          config: { react: { version: "^19.1.1" } },
        }),
        "18.2.0",
      );
      assertEquals(
        await resolveProjectReactVersion({
          ...snapshot,
          config: {
            client: {
              cdn: { versions: { react: "^19.0.0" } },
            },
          },
        }),
        "18.2.0",
      );
    });

    it("resolves React and Veryfront from one captured map with config overrides first", async () => {
      const snapshot = {
        dependencyPinningCacheKey: "on:snapshot-a",
        dependencyPinningDependencies: {
          react: "^18.3.1",
          veryfront: "^0.1.10",
        },
      };

      assertEquals(await resolveProjectPackageVersions(snapshot), {
        react: "18.3.1",
        veryfront: "0.1.10",
      });
      assertEquals(
        await resolveProjectPackageVersions({
          ...snapshot,
          config: {
            react: { version: "^19.1.1" },
            client: {
              cdn: {
                versions: {
                  react: "^19.0.0",
                  veryfront: "^0.2.0",
                },
              },
            },
          },
        }),
        {
          react: "18.3.1",
          veryfront: "0.1.10",
        },
      );
    });

    it("does not consult current package state when an enabled snapshot omits React", async () => {
      const dir = await Deno.makeTempDir({ prefix: "vf-snapshot-without-react-" });

      try {
        await Deno.writeTextFile(
          `${dir}/package.json`,
          JSON.stringify({ dependencies: { react: "^19.1.1" } }),
        );

        const version = await resolveProjectReactVersion({
          projectDir: dir,
          dependencyPinningCacheKey: "on:snapshot-without-react",
          dependencyPinningDependencies: {},
        });

        assertEquals(version, DEFAULT_REACT_VERSION);
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    });

    it("invalidates cached package versions when package.json changes", async () => {
      const dir = await Deno.makeTempDir({ prefix: "vf-react-version-cache-" });

      try {
        const packageJsonPath = `${dir}/package.json`;
        await Deno.writeTextFile(
          packageJsonPath,
          JSON.stringify({
            dependencies: { react: "^18.3.1", veryfront: "^0.1.10" },
          }),
        );

        const first = await readProjectDependencyVersions(dir);
        assertEquals(first.react, "18.3.1");
        assertEquals(first.veryfront, "0.1.10");

        await new Promise((resolve) => setTimeout(resolve, 5));
        await Deno.writeTextFile(
          packageJsonPath,
          JSON.stringify({
            dependencies: { react: "^19.0.0", veryfront: "^0.2.0" },
          }),
        );

        const second = await readProjectDependencyVersions(dir);
        assertEquals(second.react, "19.0.0");
        assertEquals(second.veryfront, "0.2.0");
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    });
  });
});

describe("package-registry adapter-backed snapshot sources", () => {
  let originalFlag: string | undefined;

  beforeEach(() => {
    originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    clearReactVersionCache();
  });

  afterEach(() => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
    clearReactVersionCache();
  });

  function memorySource(
    cacheNamespace: string,
    state: { content: string; mtime: Date },
    config?: DependencyPinningSource["config"],
  ): DependencyPinningSource {
    return {
      projectDir: "/shared/proxy-project",
      cacheNamespace,
      config,
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

  it("tags project and content identity kinds to prevent namespace collisions", () => {
    const adapter = {
      fs: {
        readFile: () => Promise.resolve("{}"),
        stat: () =>
          Promise.resolve({
            size: 2,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: new Date(1),
          }),
      },
    } as unknown as Parameters<typeof createDependencyPinningSource>[0]["adapter"];
    const base = {
      projectDir: "/shared/proxy-project",
      adapter,
      isLocalProject: false,
    };

    const byId = createDependencyPinningSource({
      ...base,
      projectId: "project",
      releaseId: "source",
    });
    const bySlug = createDependencyPinningSource({
      ...base,
      projectSlug: "project",
      releaseId: "source",
    });
    const byContent = createDependencyPinningSource({
      ...base,
      projectId: "project",
      contentSourceId: "release:source",
    });

    assertEquals(byId.cacheNamespace === bySlug.cacheNamespace, false);
    assertEquals(byId.cacheNamespace === byContent.cacheNamespace, false);
  });

  it("isolates two proxy projects that share the same projectDir", async () => {
    const mtime = new Date(1_000);
    const stateA = {
      content: JSON.stringify({ dependencies: { tenant: "1.0.0" } }),
      mtime,
    };
    const stateB = {
      content: JSON.stringify({ dependencies: { tenant: "2.0.0" } }),
      mtime,
    };
    const sourceA = memorySource('["project-a","release-a"]', stateA);
    const sourceB = memorySource('["project-b","release-a"]', stateB);

    const [snapshotA, snapshotB] = await Promise.all([
      getDependencyPinningSnapshot(sourceA),
      getDependencyPinningSnapshot(sourceB),
    ]);

    assertEquals(snapshotA.cacheKey === snapshotB.cacheKey, false);
    assertEquals(snapshotA.dependencies?.tenant, "1.0.0");
    assertEquals(snapshotB.dependencies?.tenant, "2.0.0");
    assertEquals(
      getProjectDependenciesSync(sourceA, snapshotA.cacheKey)?.tenant,
      "1.0.0",
    );
    assertEquals(
      getProjectDependenciesSync(sourceB, snapshotB.cacheKey)?.tenant,
      "2.0.0",
    );
  });

  it("detects same-mtime, same-size remote package.json changes", async () => {
    const state = {
      content: JSON.stringify({ dependencies: { tenant: "1.0.0" } }),
      mtime: new Date(2_000),
    };
    const source = memorySource('["project-a","preview-main"]', state);
    const snapshotA = await getDependencyPinningSnapshot(source);

    state.content = JSON.stringify({ dependencies: { tenant: "2.0.0" } });
    const snapshotB = await getDependencyPinningSnapshot(source);

    assertEquals(snapshotA.cacheKey === snapshotB.cacheKey, false);
    assertEquals(snapshotA.dependencies?.tenant, "1.0.0");
    assertEquals(snapshotB.dependencies?.tenant, "2.0.0");
    assertEquals(
      (await resolveRequestedDependencyPinningSnapshot(
        source,
        snapshotA.cacheKey,
      ))?.dependencies?.tenant,
      "1.0.0",
    );
  });

  it("never treats a missing mtime as package-version freshness authority", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
    let content = JSON.stringify({ dependencies: { react: "19.1.0" } });
    let reads = 0;
    const source: DependencyPinningSource = {
      projectDir: "/shared/proxy-project",
      cacheNamespace: "missing-mtime-freshness",
      fs: {
        readFile: () => {
          reads += 1;
          return Promise.resolve(content);
        },
        stat: () =>
          Promise.resolve({
            size: content.length,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: null,
          }),
      },
    };

    assertEquals((await readProjectDependencyVersions(source)).react, "19.1.0");
    content = JSON.stringify({ dependencies: { react: "19.2.0" } });
    assertEquals((await readProjectDependencyVersions(source)).react, "19.2.0");
    assertEquals(reads, 2);
  });

  it("captures config versions in the token and keeps historical config authoritative", async () => {
    const state = {
      content: JSON.stringify({ dependencies: { tenant: "1.0.0" } }),
      mtime: new Date(3_000),
    };
    const sourceA = memorySource('["project-a","release-a"]', state, {
      react: { version: "^18.3.1" },
      client: {
        cdn: {
          versions: {
            veryfront: "^0.1.10",
          },
        },
      },
    });
    const snapshotA = await getDependencyPinningSnapshot(sourceA);
    const sourceB = memorySource('["project-a","release-a"]', state, {
      react: { version: "19.1.1" },
      client: {
        cdn: {
          versions: {
            veryfront: "0.2.0",
          },
        },
      },
    });
    const snapshotB = await getDependencyPinningSnapshot(sourceB);
    const resolvedSnapshotA = await resolveDependencyPinningSnapshot(
      sourceB,
      snapshotA.cacheKey,
      snapshotA.dependencies,
    );

    assertEquals(snapshotA.cacheKey === snapshotB.cacheKey, false);
    assertEquals(snapshotA.dependencies?.react, "18.3.1");
    assertEquals(snapshotA.dependencies?.veryfront, "0.1.10");
    assertEquals(snapshotA.configuredVersions?.react?.declaration, "^18.3.1");
    assertEquals(snapshotA.configuredVersions?.veryfront?.declaration, "^0.1.10");
    assertEquals(
      resolvedSnapshotA.configuredVersions?.react?.declaration,
      "^18.3.1",
    );
    assertEquals(
      (await resolveRequestedDependencyPinningSnapshot(
        sourceB,
        snapshotA.cacheKey,
      ))?.dependencies?.react,
      "18.3.1",
    );
    assertEquals(
      await resolveProjectReactVersion({
        config: sourceB.config,
        dependencyPinningCacheKey: snapshotA.cacheKey,
        dependencyPinningDependencies: snapshotA.dependencies,
      }),
      "18.3.1",
    );
  });

  it("resolves a config-derived caller snapshot after remembered state is cleared", async () => {
    const state = {
      content: JSON.stringify({ dependencies: { tenant: "1.0.0" } }),
      mtime: new Date(3_500),
    };
    const source = memorySource('["project-a","release-cold"]', state, {
      react: { version: "^18.3.1" },
      client: {
        cdn: {
          versions: {
            veryfront: "^0.1.10",
          },
        },
      },
    });
    const captured = await getDependencyPinningSnapshot(source);

    clearReactVersionCache();
    const resolved = await resolveDependencyPinningSnapshot(
      source,
      captured.cacheKey,
      captured.dependencies,
    );

    assertEquals(resolved.cacheKey, captured.cacheKey);
    assertEquals(resolved.dependencies?.tenant, "1.0.0");
    assertEquals(resolved.dependencies?.react, "18.3.1");
    assertEquals(resolved.dependencies?.veryfront, "0.1.10");
    assertEquals(resolved.configuredVersions?.react?.declaration, "^18.3.1");
    assertEquals(resolved.configuredVersions?.veryfront?.declaration, "^0.1.10");
    assertEquals(Object.isFrozen(resolved), true);
    assertEquals(Object.isFrozen(resolved.dependencies), true);
    assertEquals(Object.isFrozen(resolved.configuredVersions), true);
    assertEquals(Object.isFrozen(resolved.configuredVersions?.react), true);
    assertEquals(Object.isFrozen(resolved.configuredVersions?.veryfront), true);

    await assertRejects(
      () =>
        resolveDependencyPinningSnapshot(
          source,
          captured.cacheKey,
          { ...captured.dependencies, tenant: "2.0.0" },
        ),
      Error,
      "does not match supplied dependencies",
    );
  });

  it("bounds adapter-backed live dependency maps with least-recently-used eviction", async () => {
    const sources: DependencyPinningSource[] = [];
    for (let index = 0; index < 256; index++) {
      const source = memorySource(
        `["project-${index}","release-a"]`,
        {
          content: JSON.stringify({
            dependencies: { tenant: `${index}.0.0` },
          }),
          mtime: new Date(4_000),
        },
      );
      sources.push(source);
      await getDependencyPinningSnapshot(source);
    }

    assertEquals(getProjectDependenciesSync(sources[0])?.tenant, "0.0.0");
    const overflowSource = memorySource(
      '["project-overflow","release-a"]',
      {
        content: JSON.stringify({
          dependencies: { tenant: "overflow" },
        }),
        mtime: new Date(4_000),
      },
    );
    await getDependencyPinningSnapshot(overflowSource);

    assertEquals(getProjectDependenciesSync(sources[0])?.tenant, "0.0.0");
    assertEquals(getProjectDependenciesSync(sources[1]), undefined);
    assertEquals(getProjectDependenciesSync(overflowSource)?.tenant, "overflow");
  });
});

describe("readProjectDependencyVersions: flag-gated dependency materialization", () => {
  let tmpDir: string;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    tmpDir = await Deno.makeTempDir({ prefix: "vf-dep-flag-" });
    await Deno.writeTextFile(
      `${tmpDir}/package.json`,
      JSON.stringify({ dependencies: { lodash: "4.17.21", react: "^18.3.1" } }),
    );
    originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    clearReactVersionCache();
  });

  afterEach(async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
    clearReactVersionCache();
    await Deno.remove(tmpDir, { recursive: true });
  });

  it("does not materialize the dependency map when the flag is off", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
    const result = await readProjectDependencyVersions(tmpDir);

    assertEquals(result.react, "18.3.1");
    assertEquals(result.dependencies, undefined);
    assertEquals(getProjectDependenciesSync(tmpDir), undefined);
  });

  it("materializes the dependency map when the flag is on", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    const result = await readProjectDependencyVersions(tmpDir);

    assertEquals(result.dependencies?.["lodash"], "4.17.21");
    assertEquals(getProjectDependenciesSync(tmpDir)?.["lodash"], "4.17.21");
  });

  it("coalesces concurrent package.json refreshes", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    const before = _getDependencyVersionReadOperationsForTest();

    const results = await Promise.all(
      Array.from({ length: 20 }, () => readProjectDependencyVersions(tmpDir)),
    );

    assertEquals(
      _getDependencyVersionReadOperationsForTest() - before,
      1,
    );
    assertEquals(
      results.every((result) => result.dependencies?.lodash === "4.17.21"),
      true,
    );
  });

  it("upgrades a flag-off cache entry when the flag is later turned on", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
    await readProjectDependencyVersions(tmpDir);
    assertEquals(getProjectDependenciesSync(tmpDir), undefined);

    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    await readProjectDependencyVersions(tmpDir);
    assertEquals(getProjectDependenciesSync(tmpDir)?.["lodash"], "4.17.21");
  });

  it("keys caches by flag state and a sorted dependency map", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
    assertEquals(await getDependencyPinningCacheKey(tmpDir), "off");

    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    const first = await getDependencyPinningCacheKey(tmpDir);
    assertEquals(first.startsWith("on:"), true);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await Deno.writeTextFile(
      `${tmpDir}/package.json`,
      JSON.stringify({ dependencies: { react: "^18.3.1", lodash: "4.17.21" } }),
    );
    const reordered = await getDependencyPinningCacheKey(tmpDir);
    assertEquals(reordered, first);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await Deno.writeTextFile(
      `${tmpDir}/package.json`,
      JSON.stringify({ dependencies: { react: "^18.3.1", lodash: "4.17.20" } }),
    );
    const changed = await getDependencyPinningCacheKey(tmpDir);
    assertEquals(changed === first, false);
  });

  it("captures an immutable key and dependency map pair", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    const snapshot = await getDependencyPinningSnapshot(tmpDir);

    assertEquals(snapshot.cacheKey.startsWith("on:"), true);
    assertEquals(snapshot.dependencies?.lodash, "4.17.21");
    assertEquals(Object.isFrozen(snapshot), true);
    assertEquals(Object.isFrozen(snapshot.dependencies), true);
  });

  it("keeps the request-local dependency map when the shared cache changes after its read", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    clearReactVersionCache();

    const initialRead = readProjectDependencyVersions(tmpDir);
    const overwriteSharedCache = initialRead.then(() => {
      _primeDependenciesCache(tmpDir, {
        lodash: "5.0.0",
        react: "^19.1.1",
      });
    });
    const snapshotPromise = getDependencyPinningSnapshot(tmpDir);

    await overwriteSharedCache;
    const snapshot = await snapshotPromise;

    assertEquals(snapshot.dependencies?.lodash, "4.17.21");
    assertEquals(snapshot.dependencies?.react, "^18.3.1");
    assertEquals(getProjectDependenciesSync(tmpDir)?.lodash, "5.0.0");
  });

  it("resolves a remembered request snapshot without another package.json read", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    const snapshot = await getDependencyPinningSnapshot(tmpDir);
    const before = _getDependencyVersionReadOperationsForTest();

    const resolved = await Promise.all(
      Array.from(
        { length: 50 },
        () =>
          resolveRequestedDependencyPinningSnapshot(
            tmpDir,
            snapshot.cacheKey,
          ),
      ),
    );

    assertEquals(
      _getDependencyVersionReadOperationsForTest() - before,
      0,
    );
    assertEquals(resolved.every((value) => value === snapshot), true);
  });

  it("clones canonical supplied maps and fails closed when an on snapshot is unavailable", async () => {
    const dependencies = { lodash: "4.17.21" };
    const cacheKey = cacheKeyForDependencies(dependencies);
    const snapshot = await resolveDependencyPinningSnapshot(
      tmpDir,
      cacheKey,
      dependencies,
    );
    dependencies.lodash = "5.0.0";

    assertEquals(snapshot.dependencies?.lodash, "4.17.21");
    assertEquals(Object.isFrozen(snapshot), true);
    assertEquals(Object.isFrozen(snapshot.dependencies), true);
    await assertRejects(
      () =>
        resolveDependencyPinningSnapshot(
          tmpDir,
          cacheKeyForDependencies({ missing: "1.0.0" }),
        ),
      Error,
      "snapshot is unavailable",
    );
    await assertRejects(
      () => resolveDependencyPinningSnapshot(tmpDir, "malformed", {}),
      Error,
      "Invalid dependency pinning snapshot key",
    );
  });

  it("rejects noncanonical caller snapshot keys", async () => {
    await assertRejects(
      () =>
        resolveDependencyPinningSnapshot(
          tmpDir,
          "on:caller-snapshot",
          { lodash: "4.17.21" },
        ),
      Error,
      "Invalid dependency pinning snapshot key",
    );
  });

  it("rejects the same canonical key with a different dependency map", async () => {
    const cacheKey = cacheKeyForDependencies({ lodash: "4.17.21" });
    await resolveDependencyPinningSnapshot(
      tmpDir,
      cacheKey,
      { lodash: "4.17.21" },
    );

    await assertRejects(
      () =>
        resolveDependencyPinningSnapshot(
          tmpDir,
          cacheKey,
          { lodash: "5.0.0" },
        ),
      Error,
      "does not match supplied dependencies",
    );
  });

  it("drops stale pins when package.json is deleted", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    const validKey = await getDependencyPinningCacheKey(tmpDir);
    assertEquals(getProjectDependenciesSync(tmpDir)?.["lodash"], "4.17.21");

    await Deno.remove(`${tmpDir}/package.json`);
    const missingKey = await getDependencyPinningCacheKey(tmpDir);

    assertEquals(missingKey === validKey, false);
    assertEquals(getProjectDependenciesSync(tmpDir), undefined);
  });

  it("drops stale pins when package.json becomes malformed", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    const validKey = await getDependencyPinningCacheKey(tmpDir);
    assertEquals(getProjectDependenciesSync(tmpDir)?.["lodash"], "4.17.21");

    await new Promise((resolve) => setTimeout(resolve, 5));
    await Deno.writeTextFile(`${tmpDir}/package.json`, "{ malformed");
    const malformedSnapshot = await getDependencyPinningSnapshot(tmpDir);

    assertEquals(malformedSnapshot.cacheKey, "on:unknown");
    assertEquals(malformedSnapshot.cacheKey === validKey, false);
    assertEquals(malformedSnapshot.dependencies, undefined);
    assertEquals(getProjectDependenciesSync(tmpDir), undefined);
  });

  it("does not write back latest when package declarations are malformed", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await Deno.writeTextFile(`${tmpDir}/package.json`, "{ malformed");
    const snapshot = await getDependencyPinningSnapshot(tmpDir);
    let posts = 0;
    _setDependencyResolutionPosterForTest(() => {
      posts++;
      return Promise.resolve();
    });

    try {
      rewriteSSRImportsCompat(`import value from "undeclared";`, {
        projectDir: tmpDir,
        projectId: "project-id",
        dependencyPinningCacheKey: snapshot.cacheKey,
        dependencyPinningDependencies: snapshot.dependencies,
      });
      await _pendingResolutions();
      assertEquals(posts, 0);
    } finally {
      _setDependencyResolutionPosterForTest();
    }
  });

  it("does not write back latest when package.json is unreadable", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    await Deno.remove(`${tmpDir}/package.json`);
    await Deno.mkdir(`${tmpDir}/package.json`);
    const snapshot = await getDependencyPinningSnapshot(tmpDir);
    let posts = 0;
    _setDependencyResolutionPosterForTest(() => {
      posts++;
      return Promise.resolve();
    });

    try {
      rewriteSSRImportsCompat(`import value from "undeclared";`, {
        projectDir: tmpDir,
        projectId: "project-id",
        dependencyPinningCacheKey: snapshot.cacheKey,
        dependencyPinningDependencies: snapshot.dependencies,
      });
      await _pendingResolutions();
      assertEquals(snapshot.cacheKey, "on:unknown");
      assertEquals(snapshot.dependencies, undefined);
      assertEquals(posts, 0);
    } finally {
      _setDependencyResolutionPosterForTest();
    }
  });

  it("does not treat invalid dependency section shapes as verified absence", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    await Deno.writeTextFile(
      `${tmpDir}/package.json`,
      JSON.stringify({ dependencies: ["lodash@4.17.21"] }),
    );
    const snapshot = await getDependencyPinningSnapshot(tmpDir);
    let posts = 0;
    _setDependencyResolutionPosterForTest(() => {
      posts++;
      return Promise.resolve();
    });

    try {
      rewriteSSRImportsCompat(`import value from "undeclared";`, {
        projectDir: tmpDir,
        projectId: "project-id",
        dependencyPinningCacheKey: snapshot.cacheKey,
        dependencyPinningDependencies: snapshot.dependencies,
      });
      await _pendingResolutions();
      assertEquals(snapshot.cacheKey, "on:unknown");
      assertEquals(snapshot.dependencies, undefined);
      assertEquals(posts, 0);
    } finally {
      _setDependencyResolutionPosterForTest();
    }
  });
});

describe("ensureProjectDependenciesLoaded: pin cache warm-up independent of react config", () => {
  let tmpDir: string;
  let originalFetch: typeof globalThis.fetch;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    tmpDir = await Deno.makeTempDir({ prefix: "vf-pin-cache-" });
    await Deno.writeTextFile(
      `${tmpDir}/package.json`,
      JSON.stringify({ dependencies: { lodash: "4.17.20" } }),
    );
    originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    clearReactVersionCache();
    _clearNpmVersionCache();
    // Mock fetch so cold-cache scheduleNpmVersionResolution calls never make
    // real network requests.
    originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response(null, { status: 503 }));
  });

  afterEach(async () => {
    // Drain any in-flight background fetches before the sanitizer runs.
    await _pendingResolutions();
    globalThis.fetch = originalFetch;
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
    clearReactVersionCache();
    _clearNpmVersionCache();
    await Deno.remove(tmpDir, { recursive: true });
  });

  it("warms the dep cache from a real package.json (config null: baseline path)", async () => {
    await ensureProjectDependenciesLoaded(tmpDir);
    assertEquals(getProjectDependenciesSync(tmpDir)?.["lodash"], "4.17.20");
  });

  it("warms the dep cache when config.react.version is set (was broken before fix)", async () => {
    // Before this fix: resolveProjectReactVersion early-returned at step 1
    // (config.react.version) without ever calling readProjectDependencyVersions,
    // leaving getProjectDependenciesSync cold for the entire request.
    await resolveProjectReactVersion({
      projectDir: tmpDir,
      config: { react: { version: "19.2.4" } },
    });
    // Verify the cache is still cold after resolveProjectReactVersion alone.
    assertEquals(getProjectDependenciesSync(tmpDir), undefined);

    // ensureProjectDependenciesLoaded warms it independently.
    await ensureProjectDependenciesLoaded(tmpDir);
    assertEquals(getProjectDependenciesSync(tmpDir)?.["lodash"], "4.17.20");
  });

  it("emits a pinned esm.sh URL from rewriteSSRImportsCompat (config null path)", async () => {
    await ensureProjectDependenciesLoaded(tmpDir);
    const result = rewriteSSRImportsCompat(`import x from "lodash";`, {
      projectDir: tmpDir,
    });
    assertEquals(
      result.includes("lodash@4.17.20"),
      true,
      `Expected pinned URL; got: ${result}`,
    );
  });

  it("emits a pinned URL even when config.react.version bypassed resolveProjectReactVersion (regression guard)", async () => {
    // Simulate what a handler does when config.react.version is set: it calls
    // resolveProjectReactVersion, which early-returns without warming the cache.
    await resolveProjectReactVersion({
      projectDir: tmpDir,
      config: { react: { version: "19.2.4" } },
    });

    // The fix: ensureProjectDependenciesLoaded is called explicitly at the entry
    // point, independent of how reactVersion was obtained.
    await ensureProjectDependenciesLoaded(tmpDir);

    const result = rewriteSSRImportsCompat(`import x from "lodash";`, {
      projectDir: tmpDir,
    });
    assertEquals(
      result.includes("lodash@4.17.20"),
      true,
      `Expected pinned URL; got: ${result}`,
    );
  });
});

describe("createDependencyPinningSource project identity", () => {
  it("should carry the project id onto the source", () => {
    const source = createDependencyPinningSource({
      projectDir: "/project",
      projectId: "project-abc",
    });
    assertEquals(source.projectId, "project-abc");
  });

  it("should carry the project id even without an adapter filesystem", () => {
    // The pre-existing cacheNamespace path only runs for adapter-backed reads;
    // the cohort gate needs identity on every source, local ones included.
    const source = createDependencyPinningSource({
      projectDir: "/project",
      projectId: "project-abc",
      isLocalProject: true,
    });
    assertEquals(source.fs, undefined);
    assertEquals(source.projectId, "project-abc");
  });

  it("keeps the host-filesystem fast path for a local project that carries an adapter", () => {
    const adapter = {
      fs: {
        readFile: () => Promise.resolve("{}"),
        stat: () =>
          Promise.resolve({
            size: 2,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: new Date(1),
          }),
      },
    } as unknown as Parameters<typeof createDependencyPinningSource>[0]["adapter"];

    const local = createDependencyPinningSource({
      projectDir: "/project",
      projectId: "project-abc",
      adapter,
      isLocalProject: true,
    });
    assertEquals(
      local.fs,
      undefined,
      "a local project keeps the host-filesystem fast path even when an adapter is present",
    );
    assertEquals(
      local.cacheNamespace,
      undefined,
      "a local project keeps its unnamespaced cache identity",
    );

    const proxied = createDependencyPinningSource({
      projectDir: "/project",
      projectId: "project-abc",
      adapter,
      isLocalProject: false,
    });
    assertEquals(
      proxied.fs,
      adapter?.fs,
      "a non-local project reads package.json through the adapter",
    );
  });

  it("should leave the project id undefined when none is supplied", () => {
    const source = createDependencyPinningSource({ projectDir: "/project" });
    assertEquals(source.projectId, undefined);
  });
});

describe("getDependencyPinningSnapshot cohort gating", () => {
  const PERCENT_ENV = "VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT";
  const PROJECTS_ENV = "VERYFRONT_DEPENDENCY_PINNING_PROJECTS";

  function restoreEnv(name: string, original: string | undefined): void {
    if (original === undefined) deleteEnv(name);
    else setEnv(name, original);
  }

  let originalFlag: string | undefined;
  let originalPercent: string | undefined;
  let originalProjects: string | undefined;

  beforeEach(() => {
    originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    originalPercent = getHostEnv(PERCENT_ENV);
    originalProjects = getHostEnv(PROJECTS_ENV);
  });

  afterEach(() => {
    // Restore absence as absence. The cohort reader distinguishes an unset
    // variable from an empty one, and the test preload only supplies its
    // default when the variable is undefined, so restoring "" here would
    // leak a different cohort state into every later test file.
    restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
    restoreEnv(PERCENT_ENV, originalPercent);
    restoreEnv(PROJECTS_ENV, originalProjects);
  });

  it("should stay off when the flag is on but the rollout percent is absent", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    setEnv(PERCENT_ENV, "");
    setEnv(PROJECTS_ENV, "");
    const snapshot = await getDependencyPinningSnapshot({
      projectDir: null,
      projectId: "project-abc",
    });
    assertEquals(snapshot.cacheKey, "off");
  });

  it("should enable an explicitly allowlisted project", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    setEnv(PERCENT_ENV, "0");
    setEnv(PROJECTS_ENV, "project-abc");
    // No package.json path, so an in-cohort project reports no-project rather
    // than "off": which is what proves the cohort admitted it.
    const snapshot = await getDependencyPinningSnapshot({
      projectDir: null,
      projectId: "project-abc",
    });
    assertEquals(snapshot.cacheKey, "on:no-project");
  });

  it("should keep a non-allowlisted project off at zero percent", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    setEnv(PERCENT_ENV, "0");
    setEnv(PROJECTS_ENV, "project-abc");
    const snapshot = await getDependencyPinningSnapshot({
      projectDir: null,
      projectId: "project-other",
    });
    assertEquals(snapshot.cacheKey, "off");
  });

  it("should apply a full rollout even to a source without project identity", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    setEnv(PERCENT_ENV, "100");
    setEnv(PROJECTS_ENV, "");
    const snapshot = await getDependencyPinningSnapshot({ projectDir: null });
    assertEquals(snapshot.cacheKey, "on:no-project");
  });

  it("should stay off when the flag itself is off regardless of percent", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
    setEnv(PERCENT_ENV, "100");
    const snapshot = await getDependencyPinningSnapshot({
      projectDir: null,
      projectId: "project-abc",
    });
    assertEquals(snapshot.cacheKey, "off");
  });
});
