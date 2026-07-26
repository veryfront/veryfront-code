import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import {
  _clearNpmVersionCache,
  _pendingResolutions,
  _setDependencyResolutionPosterForTest,
} from "#veryfront/transforms/esm/npm-registry-client.ts";
import { rewriteSSRImportsCompat, rewriteSSRImportsCompatAsync } from "./ssr-adapter.ts";
import type { DependencyResolutionObservation } from "./dependency-resolution.ts";

describe("ssr-adapter — child module snapshot propagation", () => {
  const code = [
    `import AliasChild from "@/components/AliasChild";`,
    `import RelativeChild from "./RelativeChild.js";`,
    `import "@/components/AliasSideEffect";`,
    `import "./RelativeSideEffect.js";`,
    `const AliasDynamic = import("@/components/AliasDynamic");`,
    `const RelativeDynamic = import("./RelativeDynamic.js");`,
  ].join("\n");
  const options = {
    projectSlug: "demo",
    branch: "main",
    cacheBuster: "source-a",
    dependencyPinningCacheKey: "on:snapshot-a",
  };
  const expected = [
    `import AliasChild from "/_vf_modules/components/AliasChild.js?ssr=true&project=demo&branch=main&pins=on%3Asnapshot-a&v=source-a";`,
    `import RelativeChild from "./RelativeChild.js?ssr=true&project=demo&branch=main&pins=on%3Asnapshot-a&v=source-a";`,
    `import "/_vf_modules/components/AliasSideEffect.js?ssr=true&project=demo&branch=main&pins=on%3Asnapshot-a&v=source-a";`,
    `import "./RelativeSideEffect.js?ssr=true&project=demo&branch=main&pins=on%3Asnapshot-a&v=source-a";`,
    `const AliasDynamic = import("/_vf_modules/components/AliasDynamic.js?ssr=true&project=demo&branch=main&pins=on%3Asnapshot-a&v=source-a");`,
    `const RelativeDynamic = import("./RelativeDynamic.js?ssr=true&project=demo&branch=main&pins=on%3Asnapshot-a&v=source-a");`,
  ].join("\n");

  it("keeps nested synchronous imports on the captured snapshot", () => {
    assertEquals(rewriteSSRImportsCompat(code, options), expected);
  });

  it("keeps nested asynchronous imports on the captured snapshot", async () => {
    assertEquals(await rewriteSSRImportsCompatAsync(code, options), expected);
  });

  it("preserves the legacy query shape when the captured snapshot is off", () => {
    const result = rewriteSSRImportsCompat(code, {
      ...options,
      dependencyPinningCacheKey: "off",
    });

    assertEquals(result.includes("&pins="), false);
  });

  it("preserves the legacy default cache buster when pinning is off", () => {
    const withoutPins = rewriteSSRImportsCompat(code, {
      projectSlug: "demo",
      branch: "main",
    });
    const flagOff = rewriteSSRImportsCompat(code, {
      projectSlug: "demo",
      branch: "main",
      dependencyPinningCacheKey: "off",
    });

    assertEquals(flagOff, withoutPins);
  });
});

describe("ssr-adapter — resolveBareImportPin schedules background resolution", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalFlag: string | undefined;

  beforeEach(() => {
    originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    _clearNpmVersionCache();
    // Fast non-OK mock so cold-cache fetches resolve quickly.
    originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response(null, { status: 503 }));
  });

  afterEach(async () => {
    // Drain all in-flight background fetches before the sanitizer runs.
    await _pendingResolutions();
    globalThis.fetch = originalFetch;
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
    _clearNpmVersionCache();
  });

  it("falls back to unversioned URL on the first render when caches are cold", () => {
    const code = `import lodash from "lodash";`;
    const result = rewriteSSRImportsCompat(code, { projectDir: "/project" });
    // Cache is cold on the first call — falls back to the unversioned esm.sh URL.
    assertEquals(result.includes("esm.sh/lodash?"), true);
    assertEquals(result.includes("lodash@"), false);
  });

  it("keeps output stable after the background registry fetch resolves", async () => {
    // Override the default 503 mock to return a real version.
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ "dist-tags": { latest: "4.17.21" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const code = `import lodash from "lodash";`;
    const options = {
      projectDir: "/project",
      projectId: "test-project",
      dependencyPinningCacheKey: "on:snapshot-a",
      dependencyPinningDependencies: {},
    };
    // First render — cache is cold; schedules the background registry fetch.
    const before = rewriteSSRImportsCompat(code, options);
    // Wait for the background fetch to settle and warm the cache.
    await _pendingResolutions();
    const after = rewriteSSRImportsCompat(code, options);
    assertEquals(after, before);
    assertEquals(after.includes("lodash@4.17.21"), false);
  });

  it("reports exact raw and absent declarations through the SSR callback", () => {
    const observations: DependencyResolutionObservation[] = [];

    rewriteSSRImportsCompat(
      [
        `import rangeValue from "range-package";`,
        `import absentValue from "absent-package";`,
      ].join("\n"),
      {
        projectDir: "/project",
        projectId: "project-ref",
        dependencyPinningCacheKey: "on:snapshot-observations",
        dependencyPinningDependencies: {
          "range-package": "^1.2.3",
        },
        onDependencyResolutionObserved: (observation) => {
          observations.push(observation);
        },
      },
    );

    assertEquals(observations, [
      { packageName: "range-package", declaration: "^1.2.3" },
      { packageName: "absent-package", declaration: null },
    ]);
  });

  it("does not schedule special-package imports without a proven writeback source", async () => {
    const requests: Array<{ projectId: string; specifiers: string[] }> = [];
    _setDependencyResolutionPosterForTest((projectId, specifiers) => {
      requests.push({ projectId, specifiers });
      return Promise.resolve();
    });

    rewriteSSRImportsCompat(
      [
        `import React from "react";`,
        `import "react-dom/client";`,
        `const loadHead = () => import("veryfront/head");`,
      ].join("\n"),
      {
        projectDir: "/project",
        projectId: "project-ref",
        dependencyPinningCacheKey: "on:snapshot-special",
        dependencyPinningDependencies: {
          react: "^19.0.0",
          "react-dom": "next",
        },
      },
    );
    await _pendingResolutions();

    assertEquals(requests, []);
  });
});
