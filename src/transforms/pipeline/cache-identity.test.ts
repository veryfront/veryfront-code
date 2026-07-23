import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  computePipelineConfigIdentity,
  fingerprintPipelineImportMap,
  getCustomPluginCacheIdentity,
  snapshotImportMap,
} from "./cache-identity.ts";
import { type TransformPlugin, TransformStage } from "./types.ts";

const transform = (ctx: { code: string }): string => ctx.code;

function identityInput(
  overrides: Partial<Parameters<typeof computePipelineConfigIdentity>[0]> = {},
) {
  return {
    reactVersion: "19.1.0",
    jsxImportSource: "react",
    studioEmbed: false,
    dev: false,
    ssr: true,
    projectDir: "/project",
    importMapFingerprint: "a".repeat(64),
    customPlugins: [],
    ...overrides,
  };
}

describe("transform pipeline cache identity", () => {
  it("snapshots import maps without invoking getters", () => {
    let getterCalls = 0;
    const imports = Object.create(null) as Record<string, string>;
    Object.defineProperty(imports, "danger", {
      enumerable: true,
      get() {
        getterCalls++;
        return "/project/danger.ts";
      },
    });

    assertThrows(
      () => snapshotImportMap({ imports }),
      TypeError,
      "accessor properties",
    );
    assertEquals(getterCalls, 0);
  });

  it("uses an immutable import-map snapshot", () => {
    const raw = { imports: { local: "/project/v1.ts" } };
    const snapshot = snapshotImportMap(raw);
    raw.imports.local = "/project/v2.ts";

    assertEquals(snapshot.imports?.local, "/project/v1.ts");
    assertEquals(Object.isFrozen(snapshot), true);
    assertEquals(Object.isFrozen(snapshot.imports), true);
  });

  it("fingerprints import maps independent of insertion order", async () => {
    const first = snapshotImportMap({ imports: { a: "/a.ts", b: "/b.ts" } });
    const reordered = snapshotImportMap({ imports: { b: "/b.ts", a: "/a.ts" } });
    const changed = snapshotImportMap({ imports: { a: "/a.ts", b: "/v2.ts" } });

    assertEquals(
      await fingerprintPipelineImportMap(first),
      await fingerprintPipelineImportMap(reordered),
    );
    assertNotEquals(
      await fingerprintPipelineImportMap(first),
      await fingerprintPipelineImportMap(changed),
    );
  });

  it("disables persistent caching for unidentified custom plugins", () => {
    const plugin: TransformPlugin = {
      name: "custom",
      stage: TransformStage.FINALIZE,
      transform,
    };

    assertEquals(getCustomPluginCacheIdentity([plugin]).cacheable, false);
    plugin.cacheIdentity = "custom@1";
    assertEquals(getCustomPluginCacheIdentity([plugin]).cacheable, true);
  });

  it("rejects accessor-backed plugin identities without invoking them", () => {
    let getterCalls = 0;
    const plugin = {
      name: "custom",
      stage: TransformStage.FINALIZE,
      transform,
    } as TransformPlugin;
    Object.defineProperty(plugin, "cacheIdentity", {
      enumerable: true,
      get() {
        getterCalls++;
        return "custom@1";
      },
    });

    assertThrows(
      () => getCustomPluginCacheIdentity([plugin]),
      TypeError,
      "accessor properties",
    );
    assertEquals(getterCalls, 0);
  });

  it("rejects control characters in plugin names used for logs and spans", () => {
    const plugin: TransformPlugin = {
      name: "custom\nforged-stage",
      stage: TransformStage.FINALIZE,
      cacheIdentity: "custom@1",
      transform,
    };

    assertThrows(() => getCustomPluginCacheIdentity([plugin]), TypeError, "invalid name");
  });

  it("rejects oversized base identity fields before hashing", async () => {
    await assertRejects(
      () =>
        computePipelineConfigIdentity(
          identityInput({ reactVersion: "x".repeat(64 * 1024 + 1) }),
        ),
      TypeError,
      "React version is too large",
    );
  });

  it("changes when any output-affecting endpoint or plugin identity changes", async () => {
    const baseline = await computePipelineConfigIdentity(identityInput());
    const moduleServer = await computePipelineConfigIdentity(
      identityInput({ moduleServerUrl: "https://modules.example/v1" }),
    );
    const api = await computePipelineConfigIdentity(
      identityInput({ apiBaseUrl: "https://api.example/v1" }),
    );
    const plugins = await computePipelineConfigIdentity(
      identityInput({ customPlugins: [[0, "custom", TransformStage.FINALIZE, "custom@1"]] }),
    );

    assertNotEquals(moduleServer, baseline);
    assertNotEquals(api, baseline);
    assertNotEquals(plugins, baseline);
  });
});
