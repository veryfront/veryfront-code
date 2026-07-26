import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import {
  _clearNpmVersionCache,
  _pendingResolutions,
} from "#veryfront/transforms/esm/npm-registry-client.ts";
import { rewriteSSRImportsCompat } from "../import-rewriter/ssr-adapter.ts";
import {
  clearReactVersionCache,
  DEFAULT_REACT_VERSION,
  ensureProjectDependenciesLoaded,
  getProjectDependenciesSync,
  isValidReactVersion,
  normalizeReactVersion,
  readProjectDependencyVersions,
  resolveProjectReactVersion,
  stripSemverRange,
} from "./package-registry.ts";

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
  });

  describe("isValidReactVersion", () => {
    it("should accept X.Y.Z format", () => {
      assertEquals(isValidReactVersion("19.1.1"), true);
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

    it("should fallback to default for undefined", () => {
      assertEquals(normalizeReactVersion(undefined), DEFAULT_REACT_VERSION);
    });

    it("should fallback to default for invalid format", () => {
      assertEquals(normalizeReactVersion("not-a-version"), DEFAULT_REACT_VERSION);
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

describe("readProjectDependencyVersions — flag-gated dependency materialization", () => {
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

  it("upgrades a flag-off cache entry when the flag is later turned on", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
    await readProjectDependencyVersions(tmpDir);
    assertEquals(getProjectDependenciesSync(tmpDir), undefined);

    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    await readProjectDependencyVersions(tmpDir);
    assertEquals(getProjectDependenciesSync(tmpDir)?.["lodash"], "4.17.21");
  });
});

describe("ensureProjectDependenciesLoaded — pin cache warm-up independent of react config", () => {
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

  it("warms the dep cache from a real package.json (config null — baseline path)", async () => {
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
