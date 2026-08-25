import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { ensureDefaultParserContracts } from "#veryfront/extensions/parser/defaults.ts";
import type { EntityInfo } from "#veryfront/types";
import { DEFAULT_REACT_VERSION } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import { bundleComponentForClient, handleComponentPage } from "./component-handling.ts";

const PIN_KEY_A = "on:z7bg3qnfgtcb";
const PIN_KEY_B = "on:3w5e11264sgsf";

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("rendering/component-handling", () => {
  it("shares one client bundle transform for concurrent cold misses", async () => {
    let transformCalls = 0;
    const transform = Promise.withResolvers<string>();

    const first = bundleComponentForClient(
      "export default function Page() { return null; }",
      "/project/app/page.tsx",
      "/project",
      {} as RuntimeAdapter,
      undefined,
      "project-1",
      "19.1.0",
      {
        transformToESM: () => {
          transformCalls++;
          return transform.promise;
        },
      },
    );
    const second = bundleComponentForClient(
      "export default function Page() { return null; }",
      "/project/app/page.tsx",
      "/project",
      {} as RuntimeAdapter,
      undefined,
      "project-1",
      "19.1.0",
      {
        transformToESM: () => {
          transformCalls++;
          return transform.promise;
        },
      },
    );

    await waitFor(() => transformCalls > 0);
    assertEquals(transformCalls, 1);

    transform.resolve("export default function Page() { return null; }");

    assertEquals(await Promise.all([first, second]), [
      "export default function Page() { return null; }",
      "export default function Page() { return null; }",
    ]);
    assertEquals(transformCalls, 1);
  });

  it("retries after a failed client bundle transform", async () => {
    let transformCalls = 0;
    const failedTransform = Promise.withResolvers<string>();
    const deps = {
      transformToESM: () => {
        transformCalls++;
        return transformCalls === 1
          ? failedTransform.promise
          : Promise.resolve("export default function Page() { return null; }");
      },
    };

    const first = bundleComponentForClient(
      "export default function Page() { return null; }",
      "/project/app/retry.tsx",
      "/project",
      {} as RuntimeAdapter,
      undefined,
      "project-1",
      "19.1.0",
      deps,
    );
    await waitFor(() => transformCalls > 0);
    const rejected = assertRejects(
      () => first,
      Error,
      "Component transformation failed",
    );
    failedTransform.reject(new Error("boom"));
    await rejected;

    assertEquals(
      await bundleComponentForClient(
        "export default function Page() { return null; }",
        "/project/app/retry.tsx",
        "/project",
        {} as RuntimeAdapter,
        undefined,
        "project-1",
        "19.1.0",
        deps,
      ),
      "export default function Page() { return null; }",
    );
    assertEquals(transformCalls, 2);
  });

  it("caches client bundle transforms separately by module server URL and React version", async () => {
    const source = "export default function Page() { return null; }";
    const filePath = "/project/app/transform-identity.tsx";
    const projectDir = "/project";
    const projectId = "project-transform-identity";
    const transformed: string[] = [];

    const deps = {
      transformToESM: (
        _source: string,
        _filePath: string,
        _projectDir: string,
        _adapter: RuntimeAdapter,
        options: { moduleServerUrl?: string; reactVersion?: string },
      ) => {
        const result = `${options.moduleServerUrl}:${options.reactVersion}`;
        transformed.push(result);
        return Promise.resolve(result);
      },
    };

    const bundle = (moduleServerUrl: string, reactVersion: string) =>
      bundleComponentForClient(
        source,
        filePath,
        projectDir,
        {} as RuntimeAdapter,
        moduleServerUrl,
        projectId,
        reactVersion,
        deps,
      );

    assertEquals(
      await bundle("https://modules-a.example.test", "19.1.0"),
      "https://modules-a.example.test:19.1.0",
    );
    assertEquals(
      await bundle("https://modules-b.example.test", "19.1.0"),
      "https://modules-b.example.test:19.1.0",
    );
    assertEquals(
      await bundle("https://modules-a.example.test", "19.2.0"),
      "https://modules-a.example.test:19.2.0",
    );
    assertEquals(transformed, [
      "https://modules-a.example.test:19.1.0",
      "https://modules-b.example.test:19.1.0",
      "https://modules-a.example.test:19.2.0",
    ]);
  });

  it("caches client bundle transforms by the configured server external package set", async () => {
    let transformCalls = 0;
    const deps = {
      transformToESM: (
        _source: string,
        _filePath: string,
        _projectDir: string,
        _adapter: RuntimeAdapter,
        options: { serverExternalPackages?: readonly string[] },
      ) => {
        transformCalls++;
        return Promise.resolve(options.serverExternalPackages?.join(",") ?? "baseline");
      },
    };
    const bundle = (serverExternalPackages?: readonly string[]) =>
      bundleComponentForClient(
        "export default function Page() { return null; }",
        "/project/app/server-external-identity.tsx",
        "/project",
        {} as RuntimeAdapter,
        "https://modules.example.test",
        "project-server-external-identity",
        "19.1.0",
        deps,
        undefined,
        "off",
        undefined,
        undefined,
        serverExternalPackages,
      );

    assertEquals(await bundle(), "baseline");
    assertEquals(await bundle(["knex"]), "knex");
    assertEquals(await bundle(["knex", "@prisma/client"]), "knex,@prisma/client");
    assertEquals(await bundle(["@prisma/client", "knex"]), "knex,@prisma/client");
    assertEquals(transformCalls, 3);
  });

  it("keeps mainline off identity and isolates enabled snapshots and origins", async () => {
    const transformed: string[] = [];
    const deps = {
      transformToESM: (
        _source: string,
        _filePath: string,
        _projectDir: string,
        _adapter: RuntimeAdapter,
        options: {
          moduleServerOrigin?: string;
          dependencyPinningCacheKey?: string;
        },
      ) => {
        const result = `${options.dependencyPinningCacheKey}:${options.moduleServerOrigin}`;
        transformed.push(result);
        return Promise.resolve(result);
      },
    };
    const bundle = (dependencyPinningCacheKey: string, moduleServerOrigin: string) =>
      bundleComponentForClient(
        "export default function Page() { return null; }",
        "/project/app/pin-identity.tsx",
        "/project",
        {} as RuntimeAdapter,
        "https://modules.example.test",
        "project-pin-identity",
        "19.1.0",
        deps,
        moduleServerOrigin,
        dependencyPinningCacheKey,
      );

    const flagOffA = await bundle("off", "https://app-a.example");
    const flagOffB = await bundle("off", "https://app-b.example");
    const snapshotA = await bundle(PIN_KEY_A, "https://app-a.example");
    const snapshotAOtherOrigin = await bundle(
      PIN_KEY_A,
      "https://app-b.example",
    );
    const snapshotB = await bundle(PIN_KEY_B, "https://app-a.example");

    assertEquals(flagOffB, flagOffA);
    assertEquals(snapshotA, `${PIN_KEY_A}:https://app-a.example`);
    assertEquals(
      snapshotAOtherOrigin,
      `${PIN_KEY_A}:https://app-b.example`,
    );
    assertEquals(snapshotB, `${PIN_KEY_B}:https://app-a.example`);
    assertEquals(transformed, [
      "off:https://app-a.example",
      `${PIN_KEY_A}:https://app-a.example`,
      `${PIN_KEY_A}:https://app-b.example`,
      `${PIN_KEY_B}:https://app-a.example`,
    ]);
  });

  it("uses the default React version for missing completed-cache identity", async () => {
    const source = "export default function Page() { return null; }";
    const filePath = "/project/app/default-react-identity.tsx";
    const projectDir = "/project";
    const projectId = "project-default-react-identity";
    let transformCalls = 0;

    const deps = {
      transformToESM: () => {
        transformCalls++;
        return Promise.resolve("default-react-bundle");
      },
    };

    const bundle = (reactVersion?: string) =>
      bundleComponentForClient(
        source,
        filePath,
        projectDir,
        {} as RuntimeAdapter,
        "https://modules-a.example.test",
        projectId,
        reactVersion,
        deps,
      );

    assertEquals(await bundle(undefined), "default-react-bundle");
    assertEquals(await bundle(DEFAULT_REACT_VERSION), "default-react-bundle");
    assertEquals(transformCalls, 1);
  });

  it("does not share in-flight client bundle transforms across module server URL and React version", async () => {
    const source = "export default function Page() { return null; }";
    const filePath = "/project/app/transform-flight-identity.tsx";
    const projectDir = "/project";
    const projectId = "project-transform-flight-identity";
    const transforms = new Map<
      string,
      ReturnType<typeof Promise.withResolvers<string>>
    >();

    const deps = {
      transformToESM: (
        _source: string,
        _filePath: string,
        _projectDir: string,
        _adapter: RuntimeAdapter,
        options: { moduleServerUrl?: string; reactVersion?: string },
      ) => {
        const key = `${options.moduleServerUrl}:${options.reactVersion}`;
        const transform = Promise.withResolvers<string>();
        transforms.set(key, transform);
        return transform.promise;
      },
    };

    const bundle = (moduleServerUrl: string, reactVersion: string) =>
      bundleComponentForClient(
        source,
        filePath,
        projectDir,
        {} as RuntimeAdapter,
        moduleServerUrl,
        projectId,
        reactVersion,
        deps,
      );

    const baseline = bundle("https://modules-a.example.test", "19.1.0");
    const moduleServerChanged = bundle("https://modules-b.example.test", "19.1.0");
    const reactChanged = bundle("https://modules-a.example.test", "19.2.0");

    await waitFor(() => transforms.size === 3);
    transforms.get("https://modules-a.example.test:19.1.0")?.resolve("bundle-a");
    transforms.get("https://modules-b.example.test:19.1.0")?.resolve("bundle-b");
    transforms.get("https://modules-a.example.test:19.2.0")?.resolve("bundle-c");

    assertEquals(await Promise.all([baseline, moduleServerChanged, reactChanged]), [
      "bundle-a",
      "bundle-b",
      "bundle-c",
    ]);
  });

  it("does not let a stale transform overwrite its replacement cache entry", async () => {
    using time = new FakeTime();
    const staleTransform = Promise.withResolvers<string>();
    const transformStarted = Promise.withResolvers<void>();
    let transformCalls = 0;
    const source = "export default function Page() { return null; }";
    const args = [
      source,
      "/project/app/stale.tsx",
      "/project",
      {} as RuntimeAdapter,
      undefined,
      "project-1",
      "19.1.0",
    ] as const;

    const stale = bundleComponentForClient(...args, {
      transformToESM: () => {
        transformCalls++;
        transformStarted.resolve(undefined);
        return staleTransform.promise;
      },
    });
    await transformStarted.promise;

    await time.tickAsync(5 * 60_000);
    const replacement = await bundleComponentForClient(...args, {
      transformToESM: () => {
        transformCalls++;
        return Promise.resolve("replacement-code");
      },
    });
    assertEquals(replacement, "replacement-code");

    staleTransform.resolve("stale-code");
    assertEquals(await stale, "stale-code");
    assertEquals(
      await bundleComponentForClient(...args, {
        transformToESM: () => {
          transformCalls++;
          return Promise.resolve("unexpected-code");
        },
      }),
      "replacement-code",
    );
    assertEquals(transformCalls, 2);
  });
});

describe("rendering/component-handling client hydration compile mode", () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  const HYDRATION_SOURCE = [
    "function unusedHelper() { return 2; }",
    "export default function Page() { return null; }",
  ].join("\n");

  function pageEntity(path: string): EntityInfo {
    return {
      entity: {
        id: path,
        path,
        slug: "compile-mode",
        type: "page",
        content: HYDRATION_SOURCE,
        frontmatter: {},
        kind: "tsx",
      },
    };
  }

  async function renderClientModule(mode: "development" | "production"): Promise<string> {
    const path = `/compile-mode-project/app/${mode}.tsx`;
    const adapter = createMockAdapter();
    adapter.fs.files.set(path, HYDRATION_SOURCE);

    const result = await handleComponentPage(
      pageEntity(path),
      "compile-mode",
      "/compile-mode-project",
      undefined,
      adapter as unknown as RuntimeAdapter,
      {
        projectId: "compile-mode-project",
        contentSourceId: "release-compile-mode",
        mode,
      },
    );

    const clientModuleCode = result.pageBundle.clientModuleCode;
    assert(clientModuleCode !== undefined, "Expected a client hydration bundle");
    return clientModuleCode;
  }

  it("emits a production hydration bundle without an inline sourcemap", async () => {
    const code = await renderClientModule("production");

    assertEquals(code.includes("sourceMappingURL=data:"), false);
    assertEquals(code.includes("unusedHelper"), false);
    assertEquals(code.includes("__name"), false);
  });

  it("keeps the development hydration bundle debuggable", async () => {
    const code = await renderClientModule("development");

    assertEquals(code.includes("sourceMappingURL=data:"), true);
    assertEquals(code.includes("unusedHelper"), true);
    assertEquals(code.includes("__name"), true);
  });

  it("keeps the hydration cache entries of the two compile modes apart", async () => {
    const transformed: boolean[] = [];
    const deps = {
      transformToESM: (
        _source: string,
        _filePath: string,
        _projectDir: string,
        _adapter: RuntimeAdapter,
        options: { dev: boolean },
      ) => {
        transformed.push(options.dev);
        return Promise.resolve(options.dev ? "dev-bundle" : "production-bundle");
      },
    };
    const bundle = (dev: boolean) =>
      bundleComponentForClient(
        "export default function Page() { return null; }",
        "/compile-mode-project/app/cache-identity.tsx",
        "/compile-mode-project",
        {} as RuntimeAdapter,
        "https://modules.example.test",
        "project-compile-mode-identity",
        "19.1.0",
        deps,
        undefined,
        "off",
        undefined,
        undefined,
        undefined,
        dev,
      );

    assertEquals(await bundle(false), "production-bundle");
    assertEquals(await bundle(true), "dev-bundle");
    assertEquals(await bundle(false), "production-bundle");
    assertEquals(transformed, [false, true]);
  });

  it("passes the request environment, not the compile mode, to the SSR loader", async () => {
    // A hosted preview render is compile mode "production" with environment
    // "preview": the Studio Navigator node positions must follow `environment`,
    // so they cannot be derived from `mode`.
    // Node-position injection is provided by the first-party parser extension.
    await ensureDefaultParserContracts();

    const source = "export default function Page() { return <div>hi</div>; }";
    const renderPageRoot = async (environment: "preview" | "production") => {
      const path = `/compile-mode-project/app/env-${environment}.tsx`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(path, source);

      const result = await handleComponentPage(
        {
          entity: {
            id: path,
            path,
            slug: "compile-mode",
            type: "page",
            content: source,
            frontmatter: {},
            kind: "tsx",
          },
        } as EntityInfo,
        "compile-mode",
        "/compile-mode-project",
        undefined,
        adapter as unknown as RuntimeAdapter,
        {
          projectId: "compile-mode-project",
          contentSourceId: `release-env-${environment}`,
          mode: "production",
          environment,
        },
      );

      const Page = result.pageElement.type as (
        props: Record<string, unknown>,
      ) => { props: Record<string, unknown> };
      return Page({}).props;
    };

    const preview = await renderPageRoot("preview");
    assertEquals(
      preview["data-node-file"],
      "app/env-preview.tsx",
      "environment 'preview' must reach the SSR loader so Studio Navigator node positions are injected",
    );
    assertEquals(
      preview["data-node-line"],
      "1",
      "the injected node position must name the source line",
    );

    const production = await renderPageRoot("production");
    assertEquals(
      production["data-node-file"],
      undefined,
      "environment 'production' must not inject Studio Navigator node positions",
    );
  });
});
