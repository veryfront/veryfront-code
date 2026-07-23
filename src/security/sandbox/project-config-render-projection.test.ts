import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ProjectConfigModule } from "./project-config-module.ts";
import { evaluateProjectConfigProjectionIsolated } from "./project-config-worker-client.ts";
import {
  createRenderProjectConfigProjection,
  parseRenderProjectConfigProjection,
} from "./project-config-worker-runtime.ts";

function configModule(moduleCode: string): ProjectConfigModule {
  return {
    sourcePath: "veryfront.config.js",
    sourceHash: "1".repeat(64),
    moduleCode,
  };
}

describe("security/sandbox/project-config render projection", () => {
  it("copies and freezes only the fields consumed by rendering", () => {
    const componentDirectories = ["ui/components", "ui/widgets"];
    const developmentComponents = ["components/Button.tsx"];
    const queryParams = ["page", "sort"];
    const projection = createRenderProjectConfigProjection({
      title: "Excluded title",
      router: "app",
      directories: {
        app: "ui/app",
        pages: "ui/pages",
        components: componentDirectories,
        ai: "excluded-ai",
      },
      layout: false,
      app: "ui/app-wrapper.tsx",
      experimental: { esmLayouts: false, rsc: true },
      react: { version: "^19.2.4" },
      client: {
        moduleResolution: "cdn",
        cdn: {
          provider: "jsdelivr",
          versions: { react: "19.2.4", veryfront: "0.4.0" },
        },
      },
      cache: {
        bundleManifest: {
          ttl: 60_000,
          redisUrl: "<REDACTED>",
          keyPrefix: "excluded",
        },
        queryParams: { policy: "include-list", params: queryParams },
        render: { redisUrl: "<REDACTED>" },
      },
      dev: {
        port: 4_321,
        hmr: true,
        components: developmentComponents,
        moduleServerUrl: "https://modules.example.test",
        host: "excluded.example.test",
      },
      tailwind: {
        stylesheet: "styles/global.css",
        plugins: ["forms"],
      },
    });

    assertEquals(projection, {
      router: "app",
      directories: {
        app: "ui/app",
        pages: "ui/pages",
        components: ["ui/components", "ui/widgets"],
      },
      layout: false,
      app: "ui/app-wrapper.tsx",
      experimental: { esmLayouts: false },
      react: { version: "^19.2.4" },
      client: {
        moduleResolution: "cdn",
        cdn: {
          provider: "jsdelivr",
          versions: { react: "19.2.4", veryfront: "0.4.0" },
        },
      },
      cache: {
        bundleManifest: { ttl: 60_000 },
        queryParams: { policy: "include-list", params: ["page", "sort"] },
      },
      dev: { port: 4_321, hmr: true, components: ["components/Button.tsx"] },
      tailwind: { stylesheet: "styles/global.css" },
    });
    assertNotStrictEquals(projection.directories?.components, componentDirectories);
    assertNotStrictEquals(projection.cache?.queryParams?.params, queryParams);
    assertNotStrictEquals(projection.dev?.components, developmentComponents);
    assert(Object.isFrozen(projection));
    assert(Object.isFrozen(projection.directories!));
    assert(Object.isFrozen(projection.directories!.components!));
    assert(Object.isFrozen(projection.client!.cdn!.versions!));
    assert(Object.isFrozen(projection.cache!.queryParams!.params!));
    assert(Object.isFrozen(projection.dev!.components!));
    assertEquals(
      Object.hasOwn(projection.dev as Record<string, unknown>, "moduleServerUrl"),
      false,
    );
  });

  it("reconstructs canonical plain data without retaining input aliases", () => {
    const input = {
      directories: { components: ["components"] },
      cache: { queryParams: { params: ["page"] } },
      dev: { components: ["components/Card.tsx"] },
    };
    const projection = parseRenderProjectConfigProjection(input);

    assertNotStrictEquals(projection, input);
    assertNotStrictEquals(projection.directories, input.directories);
    assertNotStrictEquals(projection.directories?.components, input.directories.components);
    input.directories.components[0] = "mutated";
    assertEquals(projection.directories?.components, ["components"]);
    assert(Object.isFrozen(projection));
    assert(Object.isFrozen(projection.cache));
    assert(Object.isFrozen(projection.cache?.queryParams));
  });

  it("rejects unknown, executable, aliased, and non-canonical shapes", () => {
    let accessorCalls = 0;
    const accessorProjection: Record<string, unknown> = {};
    Object.defineProperty(accessorProjection, "router", {
      enumerable: true,
      get() {
        accessorCalls++;
        return "app";
      },
    });

    const symbolProjection = { router: "app" };
    Object.defineProperty(symbolProjection, Symbol("hidden"), {
      enumerable: false,
      value: "hidden",
    });

    const sparseComponents = Array<string>(1);
    const extraKeyComponents = ["components/Button.tsx"] as string[] & { extra?: string };
    extraKeyComponents.extra = "hidden";
    const cyclicProjection: Record<string, unknown> = {};
    cyclicProjection.directories = cyclicProjection;

    const malformed: unknown[] = [
      { unknown: true },
      { router: undefined },
      { directories: {} },
      { directories: Object.create(null) },
      { directories: { app: "../outside" } },
      { layout: "/absolute/layout.tsx" },
      { router: "auto" },
      { experimental: { esmLayouts: "yes" } },
      { react: { version: "workspace:*" } },
      { client: { moduleResolution: "fallback" } },
      { client: { cdn: { provider: "unknown" } } },
      { client: { cdn: { versions: {} } } },
      { cache: { bundleManifest: { ttl: 0 } } },
      { cache: { bundleManifest: { ttl: 365 * 24 * 60 * 60 * 1_000 + 1 } } },
      { cache: { queryParams: { policy: "some" } } },
      { dev: { port: 0 } },
      { dev: { port: 65_536 } },
      { dev: { components: sparseComponents } },
      { dev: { components: extraKeyComponents } },
      accessorProjection,
      symbolProjection,
      cyclicProjection,
    ];

    for (const value of malformed) {
      assertThrows(() => parseRenderProjectConfigProjection(value), Error);
    }
    assertEquals(accessorCalls, 0);
  });

  it("enforces the one MiB encoded projection limit", () => {
    const components = Array.from(
      { length: 300 },
      (_, index) => `components/${index}-${"a".repeat(3_900)}`,
    );
    assertThrows(
      () => parseRenderProjectConfigProjection({ dev: { components } }),
      RangeError,
      "encoded byte limit",
    );
  });

  it("supports render projection through the disposable config Worker", async () => {
    const projection = await evaluateProjectConfigProjectionIsolated({
      requestId: crypto.randomUUID(),
      sourceDigest: "2".repeat(64),
      projectionKind: "render",
      configModule: configModule(`
        export default {
          router: "pages",
          directories: { pages: "site/pages", components: ["site/components"] },
          layout: "site/layout.tsx",
          experimental: { esmLayouts: true },
          react: { version: "19.2.4" },
          client: {
            moduleResolution: "self-hosted",
            cdn: { provider: "unpkg", versions: "auto" },
          },
          cache: {
            bundleManifest: { ttl: 5000 },
            queryParams: { policy: "exclude-list", params: ["preview"] },
          },
          dev: {
            port: 4321,
            hmr: false,
            components: ["components/Preview.tsx"],
            moduleServerUrl: "https://excluded.example.test",
          },
          tailwind: { stylesheet: "styles/app.css" },
        };
      `),
    });

    assertEquals(projection.router, "pages");
    assertEquals(projection.client?.moduleResolution, "self-hosted");
    assertEquals(projection.client?.cdn?.versions, "auto");
    assertEquals(projection.dev, {
      port: 4_321,
      hmr: false,
      components: ["components/Preview.tsx"],
    });
    assert(Object.isFrozen(projection));
    assert(Object.isFrozen(projection.dev));
    assert(Object.isFrozen(projection.dev?.components));
    assertEquals(
      Object.hasOwn(projection.dev as Record<string, unknown>, "moduleServerUrl"),
      false,
    );
  });
});
