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
  it("isolates logical SSR references while preserving the default file-backed identity", async () => {
    const base = await computePipelineConfigIdentity(identityInput());
    assertEquals(await computePipelineConfigIdentity(identityInput({ ssrImports: "files" })), base);
    assertNotEquals(
      await computePipelineConfigIdentity(identityInput({ ssrImports: "references" })),
      base,
    );
  });

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

  it("rejects import maps that exceed the entry budget", () => {
    const imports = Object.create(null) as Record<string, string>;
    for (let index = 0; index <= 20_000; index++) {
      imports[`package-${index}`] = `/package-${index}.ts`;
    }

    assertThrows(
      () => snapshotImportMap({ imports }),
      TypeError,
      "too many entries",
    );
  });

  it("rejects import-map strings that exceed the per-field byte budget", () => {
    assertThrows(
      () =>
        snapshotImportMap({
          imports: { package: "x".repeat(64 * 1024 + 1) },
        }),
      TypeError,
      "too large",
    );
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

  it("preserves nonempty import-map identity after array iterator poisoning", async () => {
    const originalArrayIterator = Array.prototype[Symbol.iterator];
    let snapshot: ReturnType<typeof snapshotImportMap> | undefined;
    try {
      Reflect.set(
        Array.prototype,
        Symbol.iterator,
        () => ({ next: () => ({ done: true, value: undefined }) }),
      );
      snapshot = snapshotImportMap({
        imports: { package: "https://example.com/package.ts" },
        scopes: {
          "https://example.com/": {
            scoped: "https://example.com/scoped.ts",
          },
        },
      });
    } finally {
      Reflect.set(Array.prototype, Symbol.iterator, originalArrayIterator);
    }

    assertEquals(snapshot?.imports?.package, "https://example.com/package.ts");
    assertEquals(
      snapshot?.scopes?.["https://example.com/"]?.scoped,
      "https://example.com/scoped.ts",
    );
    assertNotEquals(
      await fingerprintPipelineImportMap(snapshot),
      await fingerprintPipelineImportMap(snapshotImportMap({})),
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

  it("accepts class-style plugins with methods on the prototype", () => {
    class ClassPlugin implements TransformPlugin {
      name = "class-plugin";
      stage = TransformStage.FINALIZE;
      cacheIdentity = "class-plugin@1";

      transform(ctx: { code: string }): string {
        return ctx.code;
      }
    }

    const result = getCustomPluginCacheIdentity([new ClassPlugin()]);
    assertEquals(result.cacheable, true);
    if (!result.cacheable) {
      throw new Error("Expected a cacheable plugin identity");
    }
    assertEquals(result.identity, [[
      0,
      "class-plugin",
      TransformStage.FINALIZE,
      "class-plugin@1",
    ]]);
  });

  it("rejects accessor-backed prototype plugin fields without invoking them", () => {
    let getterCalls = 0;
    const plugin = Object.create({
      name: "custom",
      stage: TransformStage.FINALIZE,
      cacheIdentity: "custom@1",
      get transform() {
        getterCalls++;
        return transform;
      },
    }) as TransformPlugin;

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

  it("accepts fractional custom plugin stages between enum anchors", () => {
    const plugin: TransformPlugin = {
      name: "custom",
      stage: TransformStage.RESOLVE_ALIASES + 0.5,
      cacheIdentity: "custom@1",
      transform,
    };

    const result = getCustomPluginCacheIdentity([plugin]);
    assertEquals(result.cacheable, true);
    if (result.cacheable) {
      assertEquals(result.identity, [[
        0,
        "custom",
        TransformStage.RESOLVE_ALIASES + 0.5,
        "custom@1",
      ]]);
    }
  });

  it("rejects non-finite and unreasonably large custom plugin stages", () => {
    for (const stage of [NaN, Infinity, -Infinity, 1_000_001, -1_000_001]) {
      const plugin = {
        name: "custom",
        stage,
        cacheIdentity: "custom@1",
        transform,
      } as TransformPlugin;

      assertThrows(() => getCustomPluginCacheIdentity([plugin]), TypeError, "invalid stage");
    }
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
    const vendor = await computePipelineConfigIdentity(
      identityInput({ vendorBundleHash: "vendor-2" }),
    );

    assertNotEquals(moduleServer, baseline);
    assertNotEquals(api, baseline);
    assertNotEquals(plugins, baseline);
    assertNotEquals(
      vendor,
      baseline,
      "vendor bundle hash must partition the transform cache",
    );
  });

  it("keeps distinct fractional stages distinct in precomputed identities", async () => {
    const early = await computePipelineConfigIdentity(
      identityInput({
        customPlugins: [[0, "custom", TransformStage.COMPILE + 0.5, "custom@1"]],
      }),
    );
    const late = await computePipelineConfigIdentity(
      identityInput({
        customPlugins: [[0, "custom", TransformStage.COMPILE + 0.7, "custom@1"]],
      }),
    );

    assertNotEquals(early, late);
  });

  it("changes identity when moduleServerOrigin changes", async () => {
    const baseline = await computePipelineConfigIdentity(
      identityInput({ moduleServerOrigin: "https://app.example.test" }),
    );
    const changed = await computePipelineConfigIdentity(
      identityInput({ moduleServerOrigin: "https://preview.example.test" }),
    );

    assertNotEquals(changed, baseline);
  });

  it("changes identity when dependencyPinningCacheKey changes", async () => {
    const baseline = await computePipelineConfigIdentity(
      identityInput({ dependencyPinningCacheKey: "on:first" }),
    );
    const changed = await computePipelineConfigIdentity(
      identityInput({ dependencyPinningCacheKey: "on:second" }),
    );

    assertNotEquals(changed, baseline);
  });

  it("partitions transforms by the configured server external package set", async () => {
    const baseline = await computePipelineConfigIdentity(identityInput());
    const knex = await computePipelineConfigIdentity(
      identityInput({ serverExternalPackages: ["knex"] }),
    );
    const prismaAndKnex = await computePipelineConfigIdentity(
      identityInput({ serverExternalPackages: ["@prisma/client", "knex"] }),
    );
    const reordered = await computePipelineConfigIdentity(
      identityInput({ serverExternalPackages: ["knex", "@prisma/client"] }),
    );

    assertNotEquals(knex, baseline);
    assertNotEquals(prismaAndKnex, knex);
    assertEquals(reordered, prismaAndKnex);
  });

  it("keeps ill-formed Unicode distinct from replacement characters", async () => {
    const loneSurrogate = await computePipelineConfigIdentity(
      identityInput({ projectDir: "\ud800" }),
    );
    const replacementCharacter = await computePipelineConfigIdentity(
      identityInput({ projectDir: "\ufffd" }),
    );

    assertNotEquals(loneSurrogate, replacementCharacter);
  });

  it("does not consult inherited toJSON hooks while hashing", async () => {
    const customPlugins = [[0, "custom", TransformStage.FINALIZE, "custom@1"]] as const;
    const baseline = await computePipelineConfigIdentity(identityInput({ customPlugins }));
    const importMapSnapshot = snapshotImportMap({
      imports: { react: "https://esm.sh/react@19.1.0" },
      scopes: { "/scope/": { dep: "https://example.com/dep.ts" } },
    });
    const fingerprintBaseline = await fingerprintPipelineImportMap(importMapSnapshot);
    const distinctSnapshot = snapshotImportMap({
      imports: { react: "https://esm.sh/react@18.3.1" },
    });
    const distinctFingerprintBaseline = await fingerprintPipelineImportMap(distinctSnapshot);
    const arrayToJson = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
    const objectToJson = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    const stringToJson = Object.getOwnPropertyDescriptor(String.prototype, "toJSON");
    let hookCalls = 0;

    try {
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        value() {
          hookCalls++;
          return ["poisoned-array"];
        },
        writable: true,
      });
      Object.defineProperty(Object.prototype, "toJSON", {
        configurable: true,
        value() {
          hookCalls++;
          return { poisoned: true };
        },
        writable: true,
      });
      Object.defineProperty(String.prototype, "toJSON", {
        configurable: true,
        value() {
          hookCalls++;
          return "poisoned-string";
        },
        writable: true,
      });

      assertEquals(
        await computePipelineConfigIdentity(identityInput({ customPlugins })),
        baseline,
      );
      // Poisoned toJSON hooks must neither move nor collapse import-map
      // fingerprints: distinct maps stay distinct under poisoning.
      assertEquals(
        await fingerprintPipelineImportMap(importMapSnapshot),
        fingerprintBaseline,
      );
      assertEquals(
        await fingerprintPipelineImportMap(distinctSnapshot),
        distinctFingerprintBaseline,
      );
      assertNotEquals(
        await fingerprintPipelineImportMap(importMapSnapshot),
        await fingerprintPipelineImportMap(distinctSnapshot),
      );
    } finally {
      if (arrayToJson) {
        Object.defineProperty(Array.prototype, "toJSON", arrayToJson);
      } else {
        Reflect.deleteProperty(Array.prototype, "toJSON");
      }
      if (objectToJson) {
        Object.defineProperty(Object.prototype, "toJSON", objectToJson);
      } else {
        Reflect.deleteProperty(Object.prototype, "toJSON");
      }
      if (stringToJson) {
        Object.defineProperty(String.prototype, "toJSON", stringToJson);
      } else {
        Reflect.deleteProperty(String.prototype, "toJSON");
      }
    }

    assertEquals(hookCalls, 0);
  });

  it("uses captured primordials for import-map and plugin identities", async () => {
    const original = {
      arrayIsArray: Array.isArray,
      arrayMap: Array.prototype.map,
      arrayPush: Array.prototype.push,
      arraySort: Array.prototype.sort,
      jsonStringify: JSON.stringify,
      mathAbs: Math.abs,
      numberIsFinite: Number.isFinite,
      objectCreate: Object.create,
      objectEntries: Object.entries,
      objectFreeze: Object.freeze,
      objectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
      objectGetPrototypeOf: Object.getPrototypeOf,
      reflectOwnKeys: Reflect.ownKeys,
      regexpTest: RegExp.prototype.test,
      rangeError: RangeError,
      stringTrim: String.prototype.trim,
      textEncoderEncode: TextEncoder.prototype.encode,
      typeError: TypeError,
      uint8ArrayByteLength: Object.getOwnPropertyDescriptor(
        Uint8Array.prototype,
        "byteLength",
      ),
      uint8ArrayLength: Object.getOwnPropertyDescriptor(
        Uint8Array.prototype,
        "length",
      ),
    };
    const rawImportMap = {
      imports: { package: "https://example.com/package.ts" },
      scopes: {
        "https://example.com/": {
          scoped: "https://example.com/scoped.ts",
        },
      },
    };
    const plugin: TransformPlugin = {
      name: "custom",
      stage: TransformStage.FINALIZE,
      cacheIdentity: "custom@1",
      transform,
    };

    let snapshot: ReturnType<typeof snapshotImportMap> | undefined;
    let fingerprintPromise: Promise<string> | undefined;
    let pluginIdentity: ReturnType<typeof getCustomPluginCacheIdentity> | undefined;
    let pipelineIdentityPromise: Promise<string> | undefined;
    let invalidMapError: unknown;
    let oversizedPluginListError: unknown;
    try {
      Reflect.set(Array, "isArray", () => false);
      Reflect.set(Array.prototype, "map", () => {
        throw new Error("poisoned Array.prototype.map");
      });
      Reflect.set(Array.prototype, "push", () => 0);
      Reflect.set(Array.prototype, "sort", () => {
        throw new Error("poisoned Array.prototype.sort");
      });
      Reflect.set(JSON, "stringify", () => {
        throw new Error("poisoned JSON.stringify");
      });
      Reflect.set(Math, "abs", () => Number.POSITIVE_INFINITY);
      Reflect.set(Number, "isFinite", () => false);
      Reflect.set(Object, "create", () => {
        throw new Error("poisoned Object.create");
      });
      Reflect.set(Object, "entries", () => {
        throw new Error("poisoned Object.entries");
      });
      Reflect.set(Object, "freeze", <T>(value: T): T => value);
      Reflect.set(Object, "getOwnPropertyDescriptor", () => {
        throw new Error("poisoned Object.getOwnPropertyDescriptor");
      });
      Reflect.set(Object, "getPrototypeOf", () => null);
      Reflect.set(Reflect, "ownKeys", () => []);
      Reflect.set(RegExp.prototype, "test", () => true);
      Reflect.set(
        globalThis,
        "RangeError",
        class PoisonedRangeError extends Error {},
      );
      Reflect.set(String.prototype, "trim", () => "poisoned");
      Reflect.set(TextEncoder.prototype, "encode", () => {
        throw new Error("poisoned TextEncoder.encode");
      });
      Reflect.set(
        globalThis,
        "TypeError",
        class PoisonedTypeError extends Error {},
      );
      Object.defineProperty(Uint8Array.prototype, "byteLength", {
        configurable: true,
        get: () => 0,
      });
      Object.defineProperty(Uint8Array.prototype, "length", {
        configurable: true,
        get: () => 0,
      });

      snapshot = snapshotImportMap(rawImportMap);
      fingerprintPromise = fingerprintPipelineImportMap(snapshot);
      pipelineIdentityPromise = computePipelineConfigIdentity(identityInput());
      pluginIdentity = getCustomPluginCacheIdentity([plugin]);
      try {
        snapshotImportMap(null);
      } catch (error) {
        invalidMapError = error;
      }
      try {
        getCustomPluginCacheIdentity(
          new Array(1_001) as TransformPlugin[],
        );
      } catch (error) {
        oversizedPluginListError = error;
      }
    } finally {
      Reflect.set(Array, "isArray", original.arrayIsArray);
      Reflect.set(Array.prototype, "map", original.arrayMap);
      Reflect.set(Array.prototype, "push", original.arrayPush);
      Reflect.set(Array.prototype, "sort", original.arraySort);
      Reflect.set(JSON, "stringify", original.jsonStringify);
      Reflect.set(Math, "abs", original.mathAbs);
      Reflect.set(Number, "isFinite", original.numberIsFinite);
      Reflect.set(Object, "create", original.objectCreate);
      Reflect.set(Object, "entries", original.objectEntries);
      Reflect.set(Object, "freeze", original.objectFreeze);
      Reflect.set(
        Object,
        "getOwnPropertyDescriptor",
        original.objectGetOwnPropertyDescriptor,
      );
      Reflect.set(Object, "getPrototypeOf", original.objectGetPrototypeOf);
      Reflect.set(Reflect, "ownKeys", original.reflectOwnKeys);
      Reflect.set(RegExp.prototype, "test", original.regexpTest);
      Reflect.set(globalThis, "RangeError", original.rangeError);
      Reflect.set(String.prototype, "trim", original.stringTrim);
      Reflect.set(TextEncoder.prototype, "encode", original.textEncoderEncode);
      Reflect.set(globalThis, "TypeError", original.typeError);
      if (original.uint8ArrayByteLength) {
        Object.defineProperty(
          Uint8Array.prototype,
          "byteLength",
          original.uint8ArrayByteLength,
        );
      } else {
        Reflect.deleteProperty(Uint8Array.prototype, "byteLength");
      }
      if (original.uint8ArrayLength) {
        Object.defineProperty(
          Uint8Array.prototype,
          "length",
          original.uint8ArrayLength,
        );
      } else {
        Reflect.deleteProperty(Uint8Array.prototype, "length");
      }
    }

    const [fingerprint, pipelineIdentity] = await Promise.all([
      fingerprintPromise,
      pipelineIdentityPromise,
    ]);
    assertEquals(snapshot?.imports?.package, "https://example.com/package.ts");
    assertEquals(Object.isFrozen(snapshot), true);
    assertEquals(Object.isFrozen(snapshot?.imports), true);
    assertEquals(typeof fingerprint, "string");
    assertEquals(fingerprint?.length, 64);
    assertEquals(pluginIdentity?.cacheable, true);
    if (!pluginIdentity?.cacheable) {
      throw new Error("Expected a cacheable plugin identity");
    }
    assertEquals(pluginIdentity.identity.length, 1);
    assertEquals(typeof pipelineIdentity, "string");
    assertEquals(pipelineIdentity?.length, 64);
    assertEquals(invalidMapError instanceof original.typeError, true);
    assertEquals(
      oversizedPluginListError instanceof original.rangeError,
      true,
    );
  });
});
