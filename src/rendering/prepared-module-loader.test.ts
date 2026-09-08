import "#veryfront/schemas/_test-setup.ts";
import {
  IMPORT_RESOLUTION_ERROR,
  INVALID_ARGUMENT,
  MODULE_NOT_FOUND,
  VeryfrontError,
} from "#veryfront/errors";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join, resolve } from "#veryfront/compat/path";
import { getRuntimeModuleLoader } from "#veryfront/platform/adapters/module-loader.ts";
import type { RuntimeAdapter, RuntimeModuleReference } from "#veryfront/platform/adapters/base.ts";
import { resolveRenderGenerationIdentity } from "./render-generation-binding.ts";
import {
  createPreparedRenderModuleLoader,
  type PreparedRenderModuleLoaderOptions,
} from "./prepared-module-loader.ts";

const projectDir = resolve("/prepared-project");
const binding = () => ({
  projectId: "project",
  environmentId: "preview",
  sourceSnapshotId: "source-one",
  configurationId: "configuration-one",
  dependencySnapshotId: "dependencies-one",
  artifactId: "artifacts-one",
  frameworkId: "framework-one",
  runtimeId: "runtime-one",
  executionPolicyId: "policy-one",
});
const options = (): PreparedRenderModuleLoaderOptions => ({
  binding: binding(),
  projectDir,
  maxEntries: 8,
  sources: {},
  packages: {},
});

describe("prepared render module loader", () => {
  it("uses the existing adapter capability and generation identity without eager imports", async () => {
    let imports = 0;
    const module = { default: "prepared page" };
    const loader = await createPreparedRenderModuleLoader({
      ...options(),
      sources: {
        "app/page.tsx": async () => {
          imports++;
          return module;
        },
      },
    });
    assertEquals(loader.identity, await resolveRenderGenerationIdentity(binding()));
    assertEquals(Object.isFrozen(loader), true);
    assertEquals(imports, 0);
    const captured = getRuntimeModuleLoader({ moduleLoader: loader } as unknown as RuntimeAdapter)!;
    assertStrictEquals(
      await captured.importModule({ kind: "source", path: join(projectDir, "app/page.tsx") }),
      module,
    );
    assertEquals(imports, 1);
  });

  it("keeps source and package names separate", async () => {
    const loader = await createPreparedRenderModuleLoader({
      ...options(),
      sources: { react: async () => ({ kind: "source" }) },
      packages: { react: async () => ({ kind: "package" }) },
    });
    assertEquals(await loader.importModule({ kind: "source", path: join(projectDir, "react") }), {
      kind: "source",
    });
    assertEquals(await loader.importModule({ kind: "package", specifier: "react" }), {
      kind: "package",
    });
  });

  it("captures binding, root and callback tables before yielding", async () => {
    const input = {
      ...options(),
      sources: { "app/page.tsx": async () => ({ value: "original" }) },
    };
    const pending = createPreparedRenderModuleLoader(input);
    input.sources["app/page.tsx"] = async () => ({ value: "replaced" });
    input.projectDir = resolve("/other-project");
    Object.assign(input.binding, { artifactId: "mutated" });
    input.binding = { ...binding(), artifactId: "other" };
    const loader = await pending;
    assertEquals(loader.identity, await resolveRenderGenerationIdentity(binding()));
    assertEquals(
      await loader.importModule({ kind: "source", path: join(projectDir, "app/page.tsx") }),
      { value: "original" },
    );
  });

  it("rejects absent imports without invoking another callback", async () => {
    let imports = 0;
    const loader = await createPreparedRenderModuleLoader({
      ...options(),
      packages: {
        react: async () => {
          imports++;
          return {};
        },
      },
    });
    for (
      const reference of [
        { kind: "package", specifier: "missing" },
        { kind: "package", specifier: "toString" },
        { kind: "source", path: join(projectDir, "missing.ts") },
      ] as const
    ) {
      const error = await assertRejects(() => loader.importModule(reference), VeryfrontError);
      assert(error instanceof VeryfrontError);
      assertEquals(error.slug, MODULE_NOT_FOUND.slug);
    }
    assertEquals(imports, 0);
  });

  it("rejects escaped and malformed references", async () => {
    const loader = await createPreparedRenderModuleLoader(options());
    for (
      const reference of [
        { kind: "source", path: join(projectDir, "../other/page.tsx") },
        { kind: "source", path: "../page.tsx" },
        { kind: "source", path: "app//page.tsx" },
        { kind: "source", path: "app/page.tsx\u0000" },
        { kind: "package", specifier: "" },
        { kind: "package", specifier: "x".repeat(4097) },
        { kind: "unknown", path: "app/page.tsx" },
        null,
      ]
    ) {
      const error = await assertRejects(
        () => loader.importModule(reference as RuntimeModuleReference),
        VeryfrontError,
      );
      assert(error instanceof VeryfrontError);
      assertEquals(error.slug, INVALID_ARGUMENT.slug);
    }
  });

  it("bounds the combined table size and rejects noncanonical source names", async () => {
    const invalidOptions: PreparedRenderModuleLoaderOptions[] = [
      { ...options(), maxEntries: 0 },
      { ...options(), maxEntries: 1.5 },
      {
        ...options(),
        maxEntries: 1,
        sources: { page: async () => ({}) },
        packages: { react: async () => ({}) },
      },
      { ...options(), projectDir: "relative" },
      { ...options(), sources: { "../page.tsx": async () => ({}) } },
      { ...options(), sources: { "app//page.tsx": async () => ({}) } },
    ];
    for (const input of invalidOptions) {
      await assertRejects(() => createPreparedRenderModuleLoader(input), VeryfrontError);
    }
    await createPreparedRenderModuleLoader({
      ...options(),
      maxEntries: 1,
      sources: { page: async () => ({}) },
    });
  });

  it("rejects option, table, callback and reference hooks without running them", async () => {
    let hooks = 0;
    const trap = () => {
      hooks++;
      throw new Error("Unexpected hook");
    };
    const sources = Object.defineProperty({}, "page.ts", { enumerable: true, get: trap });
    for (
      const input of [
        new Proxy(options(), { get: trap, getOwnPropertyDescriptor: trap }),
        {
          ...options(),
          get sources() {
            return trap();
          },
        },
        { ...options(), sources },
        { ...options(), sources: new Proxy({}, { ownKeys: trap }) },
        { ...options(), sources: { page: new Proxy(async () => ({}), { apply: trap }) } },
      ]
    ) await assertRejects(() => createPreparedRenderModuleLoader(input), VeryfrontError);
    const loader = await createPreparedRenderModuleLoader(options());
    await assertRejects(
      () =>
        loader.importModule(
          new Proxy({ kind: "package", specifier: "react" }, {
            get: trap,
          }) as RuntimeModuleReference,
        ),
      VeryfrontError,
    );
    assertEquals(hooks, 0);
  });

  it("retains the exact importer result and failure without a second resolver", async () => {
    const failure = new Error("Synthetic import failure");
    let calls = 0;
    const loader = await createPreparedRenderModuleLoader({
      ...options(),
      packages: {
        broken: async () => {
          calls++;
          throw failure;
        },
      },
    });
    assertStrictEquals(
      await assertRejects(() => loader.importModule({ kind: "package", specifier: "broken" })),
      failure,
    );
    assertEquals(calls, 1);
  });

  it("rejects missing options and invalid table entries before any import", async () => {
    const invalidOptions = [
      Object.create(options()),
      { ...options(), sources: null },
      { ...options(), packages: { react: undefined } },
      { ...options(), packages: { "": async () => ({}) } },
      { ...options(), sources: { [Symbol("unexpected")]: async () => ({}) } },
      { ...options(), sources: { "\ud800": async () => ({}) } },
      { ...options(), binding: { ...binding(), artifactId: "" } },
    ];
    for (const input of invalidOptions) {
      await assertRejects(
        () => createPreparedRenderModuleLoader(input as PreparedRenderModuleLoaderOptions),
        VeryfrontError,
      );
    }
  });

  it("rejects a prepared callback that returns no namespace", async () => {
    const loader = await createPreparedRenderModuleLoader({
      ...options(),
      packages: { empty: async () => null as unknown as Record<string, unknown> },
    });
    const error = await assertRejects(
      () => loader.importModule({ kind: "package", specifier: "empty" }),
      VeryfrontError,
    );
    assert(error instanceof VeryfrontError);
    assertEquals(error.slug, IMPORT_RESOLUTION_ERROR.slug);
  });

  it("uses replica-local roots with the same logical binding and separate imported modules", async () => {
    const firstModule = { value: "page" };
    const secondModule = { value: "page" };
    const first = await createPreparedRenderModuleLoader({
      ...options(),
      sources: { page: async () => firstModule },
    });
    const otherRoot = resolve("/other-replica");
    const second = await createPreparedRenderModuleLoader({
      ...options(),
      projectDir: otherRoot,
      sources: { page: async () => secondModule },
    });
    assertEquals(first.identity, second.identity);
    assertStrictEquals(
      await first.importModule({ kind: "source", path: join(projectDir, "page") }),
      firstModule,
    );
    assertStrictEquals(
      await second.importModule({ kind: "source", path: join(otherRoot, "page") }),
      secondModule,
    );
    await assertRejects(
      () => second.importModule({ kind: "source", path: join(projectDir, "page") }),
      VeryfrontError,
    );
  });
});
