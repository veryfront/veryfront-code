import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _clearNpmVersionCache,
  _pendingResolutions,
  _setDependencyResolutionPosterForTest,
} from "#veryfront/transforms/esm/npm-registry-client.ts";
import {
  clearReactVersionCache,
  type DependencyPinningSource,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../../release-assets/constants.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";
import { ReactStrategy } from "./react-strategy.ts";

function makeCtx(overrides: Partial<RewriteContext> = {}): RewriteContext {
  return {
    filePath: "/project/pages/index.tsx",
    projectDir: "/project",
    projectId: "test",
    target: "browser",
    dev: false,
    reactVersion: "19.1.1",
    ...overrides,
  };
}

function makeInfo(specifier: string): ImportSpecifierInfo {
  return {
    specifier,
    isDynamic: false,
    start: 0,
    end: 0,
    statementStart: 0,
    statementEnd: 0,
    raw: {} as ImportSpecifierInfo["raw"],
  };
}

let authorizedSourceSequence = 0;

async function makeAuthorizedContext(
  dependencies: Readonly<Record<string, string>>,
): Promise<RewriteContext> {
  const content = JSON.stringify({ dependencies });
  const source: DependencyPinningSource = {
    projectDir: "/project",
    cacheNamespace: `react-strategy-${++authorizedSourceSequence}`,
    dependencyWritebackTarget: { kind: "main" },
    fs: {
      readFile: () => Promise.resolve(content),
      stat: () =>
        Promise.resolve({
          size: content.length,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: new Date(1_000),
        }),
    },
  };
  const snapshot = await getDependencyPinningSnapshot(source);
  return makeCtx({
    dependencyPinningSource: source,
    dependencyPinningCacheKey: snapshot.cacheKey,
    dependencyPinningDependencies: snapshot.dependencies,
  });
}

describe("ReactStrategy", () => {
  const strategy = new ReactStrategy();

  describe("matches", () => {
    it("should match 'react'", () => {
      assertEquals(strategy.matches("react", makeCtx()), true);
    });

    it("should match 'react-dom'", () => {
      assertEquals(strategy.matches("react-dom", makeCtx()), true);
    });

    it("should match 'react/jsx-runtime'", () => {
      assertEquals(strategy.matches("react/jsx-runtime", makeCtx()), true);
    });

    it("should match 'react-dom/client'", () => {
      assertEquals(strategy.matches("react-dom/client", makeCtx()), true);
    });

    it("should not match lodash", () => {
      assertEquals(strategy.matches("lodash", makeCtx()), false);
    });
  });

  describe("rewrite", () => {
    it("should rewrite react to esm.sh URL", () => {
      const result = strategy.rewrite(makeInfo("react"), makeCtx());
      assertEquals(result.specifier?.includes("esm.sh/react@19.1.1") ?? false, true);
    });

    it("should rewrite react-dom to esm.sh URL", () => {
      const result = strategy.rewrite(makeInfo("react-dom"), makeCtx());
      assertEquals(result.specifier?.includes("esm.sh/react-dom@19.1.1") ?? false, true);
    });

    it("should rewrite react/jsx-runtime", () => {
      const result = strategy.rewrite(makeInfo("react/jsx-runtime"), makeCtx());
      assertEquals(
        result.specifier,
        "https://esm.sh/react@19.1.1/jsx-runtime?external=react&target=es2022&deps=csstype@3.2.3",
        "jsx-runtime must resolve to the pinned, react-externalized esm.sh URL",
      );
    });

    it("should handle unknown react/* subpaths via prefix", () => {
      const result = strategy.rewrite(makeInfo("react/some-custom-export"), makeCtx());
      assertEquals(
        result.specifier,
        "https://esm.sh/react@19.1.1&external=react&target=es2022&deps=csstype@3.2.3/some-custom-export",
        "an unknown react/* subpath must be appended to the pinned react prefix URL",
      );
    });

    it("should return null for non-react specifier that somehow matches", () => {
      const result = strategy.rewrite(makeInfo("react-dom/nonexistent-deep-path"), makeCtx());
      assertEquals(result.specifier, null);
    });
  });

  describe("dependency declaration resolution", () => {
    const postedSpecifiers: string[] = [];
    let originalFlag: string | undefined;

    beforeEach(() => {
      originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      _clearNpmVersionCache();
      postedSpecifiers.length = 0;
      _setDependencyResolutionPosterForTest((_projectId, specifiers) => {
        postedSpecifiers.push(...specifiers);
        return Promise.resolve();
      });
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

    it("schedules raw react ranges and react-dom tags from the captured snapshot", async () => {
      const ctx = await makeAuthorizedContext({
        react: "^19.0.0",
        "react-dom": "next",
      });

      strategy.rewrite(makeInfo("react/jsx-runtime"), ctx);
      strategy.rewrite(makeInfo("react-dom/client"), ctx);
      await _pendingResolutions();

      assertEquals(postedSpecifiers, ["react@^19.0.0", "react-dom@next"]);
    });

    it("does not schedule exact react or react-dom pins", async () => {
      const ctx = await makeAuthorizedContext({
        react: "19.1.1",
        "react-dom": "v19.1.1",
      });

      strategy.rewrite(makeInfo("react"), ctx);
      strategy.rewrite(makeInfo("react-dom"), ctx);
      await _pendingResolutions();

      assertEquals(
        postedSpecifiers,
        [],
        "exact react and react-dom pins must not be scheduled for resolution",
      );
    });

    it("does not schedule from off or unknown snapshots", async () => {
      strategy.rewrite(
        makeInfo("react"),
        makeCtx({
          dependencyPinningCacheKey: "off",
          dependencyPinningDependencies: { react: "^19" },
        }),
      );
      strategy.rewrite(
        makeInfo("react-dom"),
        makeCtx({ dependencyPinningCacheKey: "on:unknown" }),
      );
      await _pendingResolutions();

      assertEquals(postedSpecifiers, []);
    });
  });
});
