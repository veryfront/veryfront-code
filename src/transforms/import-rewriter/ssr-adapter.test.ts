import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import {
  _clearNpmVersionCache,
  _pendingResolutions,
  _setDependencyResolutionPosterForTest,
} from "#veryfront/transforms/esm/npm-registry-client.ts";
import {
  type DependencyPinningSource,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { rewriteSSRImportsCompat, rewriteSSRImportsCompatAsync } from "./ssr-adapter.ts";
import type { DependencyResolutionObservation } from "./dependency-resolution.ts";

describe("ssr-adapter — server external packages", () => {
  it("keeps configured server external imports for the runtime", () => {
    const code = [
      `import knex from "knex";`,
      `import prisma from "@prisma/client/runtime/library";`,
      `import zod from "zod";`,
    ].join("\n");

    const result = rewriteSSRImportsCompat(code, {
      serverExternalPackages: ["knex", "@prisma/client"],
    });

    assertEquals(result.includes(`from "knex"`), true);
    assertEquals(result.includes(`from "@prisma/client/runtime/library"`), true);
    assertEquals(result.includes(`from "https://esm.sh/zod?external=react&target=es2022"`), true);
  });

  it("keeps configured special packages external for the runtime", () => {
    const code = [
      `import React from "react";`,
      `import client from "react-dom/client";`,
      `import framework from "veryfront";`,
      `import similarName from "veryfrontend";`,
    ].join("\n");

    assertEquals(
      rewriteSSRImportsCompat(code, {
        serverExternalPackages: ["react", "react-dom", "veryfront", "veryfrontend"],
      }),
      code,
    );
  });

  it("normalizes configured canonical esm.sh imports for the runtime", () => {
    const code = [
      `import knex from "https://esm.sh/knex@3.1.0";`,
      `import prisma from "https://esm.sh/@prisma/client@6.0.0/runtime/library?target=es2022";`,
      `import versioned from "https://esm.sh/v135/knex@3.1.0/";`,
      `import encoded from "https://esm.sh/%40prisma%2Fclient@6.0.0/runtime/library";`,
    ].join("\n");

    const result = rewriteSSRImportsCompat(code, {
      serverExternalPackages: ["knex", "@prisma/client"],
    });

    assertEquals(result.includes(`from "knex"`), true);
    assertEquals(result.includes(`from "@prisma/client/runtime/library"`), true);
    assertEquals(result.includes("esm.sh"), false);
  });

  it("drops esm.sh build artifact paths from configured runtime imports", async () => {
    const code = [
      `import knex from "https://esm.sh/v135/knex@3.1.0/es2022/knex.mjs";`,
      `const prisma = import("https://esm.sh/stable/@prisma/client@6.0.0/es2022/client.mjs");`,
      `import currentKnex from "https://esm.sh/knex@3.1.0/es2022/knex.mjs";`,
    ].join("\n");
    const expected = [
      `import knex from "knex";`,
      `const prisma = import("@prisma/client");`,
      `import currentKnex from "knex";`,
    ].join("\n");
    const options = { serverExternalPackages: ["knex", "@prisma/client"] };

    assertEquals(rewriteSSRImportsCompat(code, options), expected);
    assertEquals(await rewriteSSRImportsCompatAsync(code, options), expected);
  });

  it("preserves prefixed and target-named configured package subpaths", async () => {
    const code = [
      `import query from "https://esm.sh/v135/knex@3.1.0/query";`,
      `const plugin = import("https://esm.sh/v135/knex@3.1.0/node/plugins/index.mjs");`,
    ].join("\n");
    const expected = [
      `import query from "knex/query";`,
      `const plugin = import("knex/node/plugins/index.mjs");`,
    ].join("\n");
    const options = { serverExternalPackages: ["knex"] };

    assertEquals(rewriteSSRImportsCompat(code, options), expected);
    assertEquals(await rewriteSSRImportsCompatAsync(code, options), expected);
  });

  it("normalizes configured versioned bare imports to installed runtime packages", async () => {
    const code = [
      `import knex from "knex@3.1.0";`,
      `import "@prisma/client@6.0.0/runtime/library";`,
      `const query = import("knex@3.1.0/query");`,
    ].join("\n");
    const expected = [
      `import knex from "knex";`,
      `import "@prisma/client/runtime/library";`,
      `const query = import("knex/query");`,
    ].join("\n");
    const options = { serverExternalPackages: ["knex", "@prisma/client"] };

    assertEquals(rewriteSSRImportsCompat(code, options), expected);
    assertEquals(await rewriteSSRImportsCompatAsync(code, options), expected);
  });

  it("normalizes configured esm.sh side-effect and dynamic imports", async () => {
    const code = [
      `import "https://esm.sh/knex@3.1.0";`,
      `const query = import("https://esm.sh/knex@3.1.0/query?target=es2022");`,
    ].join("\n");
    const expected = [`import "knex";`, `const query = import("knex/query");`].join("\n");
    const options = { serverExternalPackages: ["knex"] };

    assertEquals(rewriteSSRImportsCompat(code, options), expected);
    assertEquals(await rewriteSSRImportsCompatAsync(code, options), expected);
  });

  it("normalizes configured esm.sh build artifacts", async () => {
    const code = [
      `import knex from "https://esm.sh/v135/knex@3.1.0/es2022/knex.mjs";`,
      `import external from "https://esm.sh/*knex@3.1.0/es2022/knex.mjs";`,
      `const server = import("https://esm.sh/stable/react-dom@18.3.1/es2022/server.mjs");`,
    ].join("\n");
    const expected = [
      `import knex from "knex";`,
      `import external from "knex";`,
      `const server = import("react-dom/server");`,
    ].join("\n");
    const options = { serverExternalPackages: ["knex", "react-dom"] };

    assertEquals(rewriteSSRImportsCompat(code, options), expected);
    assertEquals(await rewriteSSRImportsCompatAsync(code, options), expected);
  });

  it("does not rewrite import text in comments or literals", () => {
    const url = "https://esm.sh/knex@3.1.0";
    const code = [
      `// import("${url}")`,
      `const source = 'import("${url}")';`,
      `const pattern = /import\\("${url.replaceAll("/", "\\/")} "\\)/;`,
      `const template = \`import("${url}")\`;`,
      `/* import "${url}" */`,
    ].join("\n");

    assertEquals(
      rewriteSSRImportsCompat(code, { serverExternalPackages: ["knex"] }),
      code,
    );
  });

  it("reports the registered bundle error when configured imports exceed the scan limit", () => {
    const code = Array.from(
      { length: 501 },
      (_, index) => `import value${index} from "https://esm.sh/knex@3.1.0/query${index}";`,
    ).join("\n");

    const error = assertThrows(
      () => rewriteSSRImportsCompat(code, { serverExternalPackages: ["knex"] }),
      VeryfrontError,
    );
    assert(error instanceof VeryfrontError);
    assertEquals(error.slug, "bundle-error");
  });

  it("partitions default child module URLs by the canonical external package set", () => {
    const code = `import Child from "@/components/Child";`;
    const knex = rewriteSSRImportsCompat(code, { serverExternalPackages: ["knex"] });
    const prisma = rewriteSSRImportsCompat(code, {
      serverExternalPackages: ["@prisma/client"],
    });
    const ordered = rewriteSSRImportsCompat(code, {
      serverExternalPackages: ["knex", "@prisma/client"],
    });
    const reordered = rewriteSSRImportsCompat(code, {
      serverExternalPackages: ["@prisma/client", "knex"],
    });
    const knexSuperset = rewriteSSRImportsCompat(code, {
      serverExternalPackages: ["knex", "zod"],
    });

    assertEquals(
      knex === prisma,
      false,
      "different external package sets must not share a cache buster",
    );
    assertEquals(
      ordered,
      reordered,
      "the external package set order must not change the cache buster",
    );
    assertEquals(
      knex === knexSuperset,
      false,
      "a superset of external packages must not reuse the subset's cache buster",
    );
  });

  it("partitions resolved child module URLs by the canonical external package set", async () => {
    const code = `import Child from "@/components/Child";`;
    const rewrite = (serverExternalPackages: readonly string[]) =>
      rewriteSSRImportsCompatAsync(code, {
        serverExternalPackages,
        resolveCacheBuster: () => "child-source-hash",
      });

    const knex = await rewrite(["knex"]);
    const prisma = await rewrite(["@prisma/client"]);
    const ordered = await rewrite(["knex", "@prisma/client"]);
    const reordered = await rewrite(["@prisma/client", "knex"]);
    const knexSuperset = await rewrite(["knex", "zod"]);

    assertEquals(
      knex === prisma,
      false,
      "different external package sets must not share a cache buster",
    );
    assertEquals(
      ordered,
      reordered,
      "the external package set order must not change the cache buster",
    );
    assertEquals(
      knex === knexSuperset,
      false,
      "a superset of external packages must not reuse the subset's cache buster",
    );
  });
});

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

  it("schedules special-package imports from a proven writeback source", async () => {
    const requests: Array<{ projectId: string; specifiers: string[] }> = [];
    _setDependencyResolutionPosterForTest((projectId, specifiers) => {
      requests.push({ projectId, specifiers });
      return Promise.resolve();
    });

    const content = JSON.stringify({
      dependencies: { react: "^19.0.0", "react-dom": "next" },
    });
    const source: DependencyPinningSource = {
      projectDir: "/project",
      cacheNamespace: "ssr-adapter-special",
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

    rewriteSSRImportsCompat(
      [
        `import React from "react";`,
        `import "react-dom/client";`,
        `const loadHead = () => import("veryfront/head");`,
      ].join("\n"),
      {
        projectDir: "/project",
        projectId: "project-ref-authorized",
        dependencyPinningSource: source,
        dependencyPinningCacheKey: snapshot.cacheKey,
        dependencyPinningDependencies: snapshot.dependencies,
      },
    );
    await _pendingResolutions();

    const scheduled = requests.flatMap((request) => request.specifiers);
    assertEquals(
      scheduled.includes("react@^19.0.0"),
      true,
      "react must be scheduled from an authorized SSR render",
    );
    assertEquals(
      scheduled.includes("react-dom@next"),
      true,
      "react-dom must be scheduled from an authorized SSR render",
    );
  });
});

describe("ssr-adapter — side-effect and dynamic import rewriting", () => {
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
  };
  const expected = [
    `import AliasChild from "/_vf_modules/components/AliasChild.js?ssr=true&project=demo&branch=main&v=source-a";`,
    `import RelativeChild from "./RelativeChild.js?ssr=true&project=demo&branch=main&v=source-a";`,
    `import "/_vf_modules/components/AliasSideEffect.js?ssr=true&project=demo&branch=main&v=source-a";`,
    `import "./RelativeSideEffect.js?ssr=true&project=demo&branch=main&v=source-a";`,
    `const AliasDynamic = import("/_vf_modules/components/AliasDynamic.js?ssr=true&project=demo&branch=main&v=source-a");`,
    `const RelativeDynamic = import("./RelativeDynamic.js?ssr=true&project=demo&branch=main&v=source-a");`,
  ].join("\n");

  it("rewrites all alias and relative import forms synchronously", () => {
    assertEquals(rewriteSSRImportsCompat(code, options), expected);
  });

  it("rewrites all alias and relative import forms asynchronously", async () => {
    assertEquals(await rewriteSSRImportsCompatAsync(code, options), expected);
  });
});

describe("ssr-adapter — individual import form coverage", () => {
  const opts = { projectSlug: "p", branch: "b", cacheBuster: "v1" };

  it('rewrites alias side-effect import: import "@/x.js"', () => {
    const result = rewriteSSRImportsCompat(`import "@/x.js";`, opts);
    assertEquals(result, `import "/_vf_modules/x.js?ssr=true&project=p&branch=b&v=v1";`);
  });

  it('rewrites alias dynamic import: import("@/x.js")', () => {
    const result = rewriteSSRImportsCompat(`const m = import("@/x.js");`, opts);
    assertEquals(result, `const m = import("/_vf_modules/x.js?ssr=true&project=p&branch=b&v=v1");`);
  });

  it('rewrites relative side-effect import: import "./y.js"', () => {
    const result = rewriteSSRImportsCompat(`import "./y.js";`, opts);
    assertEquals(result, `import "./y.js?ssr=true&project=p&branch=b&v=v1";`);
  });

  it('rewrites relative dynamic import: import("../z.js")', () => {
    const result = rewriteSSRImportsCompat(`const m = import("../z.js");`, opts);
    assertEquals(result, `const m = import("../z.js?ssr=true&project=p&branch=b&v=v1");`);
  });

  it("rewrites alias side-effect import asynchronously", async () => {
    const result = await rewriteSSRImportsCompatAsync(`import "@/x.js";`, opts);
    assertEquals(result, `import "/_vf_modules/x.js?ssr=true&project=p&branch=b&v=v1";`);
  });

  it("rewrites relative dynamic import asynchronously", async () => {
    const result = await rewriteSSRImportsCompatAsync(`const m = import("../z.js");`, opts);
    assertEquals(result, `const m = import("../z.js?ssr=true&project=p&branch=b&v=v1");`);
  });
});

describe("ssr-adapter — bare import matcher edge cases", () => {
  const opts = { projectSlug: "p", branch: "b", cacheBuster: "v1" };

  it("rewrites a bare import with no whitespace after from (minified output)", () => {
    const result = rewriteSSRImportsCompat(`import x from"lodash";`, opts);
    assertEquals(
      result,
      `import x from "https://esm.sh/lodash?external=react&target=es2022";`,
    );
  });

  it("keeps mixed-case protocol URLs external", () => {
    const code = `import x from "HTTPS://example.com/mod.js";`;
    assertEquals(rewriteSSRImportsCompat(code, opts), code);
  });
});

// The alias rewrite composes `/_vf_modules/<authored path>`, so a dot segment
// in the authored path survives concatenation and is collapsed only by the SSR
// importer — landing the import on an arbitrary same-origin path that is then
// cached as an executable module. Both the sync regex rewriter and the async
// parser-driven one compose from the same helper and must both refuse it.
describe("ssr-adapter — @/ alias module-transport containment", () => {
  const opts = { projectSlug: "p", branch: "b", cacheBuster: "v1" };
  const escapes = [
    "@/../_veryfront/modules/foo",
    "@/components/../../_veryfront/modules/foo",
    "@/%2e%2e/_veryfront/modules/foo",
    "@/..\\_veryfront/modules/foo",
  ];

  for (const specifier of escapes) {
    it(`refuses ${JSON.stringify(specifier)} synchronously`, () => {
      assertThrows(
        () => rewriteSSRImportsCompat(`import x from "${specifier}";`, opts),
        Error,
        "escapes the /_vf_modules/ module transport",
      );
    });
  }

  it("refuses an escaping alias in the async parser-driven path", async () => {
    let thrown: unknown;
    try {
      await rewriteSSRImportsCompatAsync(
        `import x from "@/../_veryfront/modules/foo";`,
        opts,
      );
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof Error, "expected the async rewrite to reject the escaping alias");
    assert(thrown.message.includes("escapes the /_vf_modules/ module transport"));
  });

  it("still rewrites a contained alias", () => {
    assertEquals(
      rewriteSSRImportsCompat(`import x from "@/components/Card";`, opts),
      `import x from "/_vf_modules/components/Card.js?ssr=true&project=p&branch=b&v=v1";`,
    );
  });
});
