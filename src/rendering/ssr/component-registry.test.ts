import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { DEFAULT_MAX_FILE_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { VirtualModuleSystem } from "../virtual-module-system.ts";
import { ComponentRegistry } from "./component-registry.ts";

function createRegistry(projectDir = "/project") {
  const adapter = createMockAdapter();
  const virtualModules = new VirtualModuleSystem(
    "/_veryfront/modules",
    adapter,
    { importMap: { imports: {}, scopes: {} } },
  );
  const registry = new ComponentRegistry({
    adapter,
    contentSourceId: "test-source",
    projectDir,
    virtualModules,
  });
  return { adapter, registry, virtualModules };
}

describe("rendering/ssr/component-registry", () => {
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("requires a valid project root and rejects discovery outside it", async () => {
    const adapter = createMockAdapter();
    assertThrows(
      () =>
        new ComponentRegistry({
          adapter,
          contentSourceId: "test-source",
          projectDir: "",
        }),
      TypeError,
      "project directory",
    );

    const { registry } = createRegistry();
    await assertRejects(
      () => registry.loadFromDirectory("/outside/components", true),
      TypeError,
      "outside",
    );
  });

  it("treats only a missing root directory as an empty registry", async () => {
    const { registry } = createRegistry();
    await registry.loadFromDirectory("/project/components", true);
    assertEquals(registry.getAll(), {});

    const adapter = createMockAdapter();
    adapter.fs.readDir = async function* () {
      yield* [];
      throw new Error("upstream unavailable");
    };
    const virtualModules = new VirtualModuleSystem(
      "/_veryfront/modules",
      adapter,
      { importMap: { imports: {}, scopes: {} } },
    );
    const failingRegistry = new ComponentRegistry({
      adapter,
      contentSourceId: "test-source",
      projectDir: "/project",
      virtualModules,
    });
    await assertRejects(
      () => failingRegistry.loadFromDirectory("/project/components", true),
      Error,
      "upstream unavailable",
    );
  });

  it("discovers nested components deterministically and skips non-runtime files", async () => {
    const { adapter, registry, virtualModules } = createRegistry();
    adapter.fs.files.set(
      "/project/components/Button.tsx",
      "export default function Button() { return null; }",
    );
    adapter.fs.files.set(
      "/project/components/nested/Card.tsx",
      "export default function Card() { return null; }",
    );
    adapter.fs.files.set(
      "/project/components/nested/index.ts",
      "export { default } from './Card.tsx';",
    );
    adapter.fs.files.set(
      "/project/components/Button.test.tsx",
      "throw new Error('test files must not load');",
    );
    adapter.fs.files.set(
      "/project/components/.hidden/Secret.tsx",
      "throw new Error('hidden files must not load');",
    );

    await registry.loadFromDirectory("/project/components", true);

    assertEquals(virtualModules.getModule("component:Button"), undefined);
    assertEquals(virtualModules.getModule("component:Card"), undefined);
    assertEquals(virtualModules.getModule("component:index"), undefined);
    assertEquals(virtualModules.getModule("component:Button.test"), undefined);
    assertEquals(virtualModules.getModule("component:Secret"), undefined);
    assertEquals(registry.get("Button"), null);

    await registry.initializeComponents();
    assertEquals(typeof registry.get("Button"), "function");
    assertEquals(typeof registry.get("Card"), "function");
    assert(virtualModules.getModule("component:Button"));
    assert(virtualModules.getModule("component:Card"));
  });

  it("rejects duplicate basenames without retaining a partial virtual registry", async () => {
    const { adapter, registry, virtualModules } = createRegistry();
    adapter.fs.files.set(
      "/project/components/a/Button.tsx",
      "export default function ButtonA() { return null; }",
    );
    adapter.fs.files.set(
      "/project/components/b/Button.tsx",
      "export default function ButtonB() { return null; }",
    );

    await assertRejects(
      () => registry.loadFromDirectory("/project/components", true),
      Error,
      "Duplicate component name",
    );
    assertEquals(virtualModules.getModule("component:Button"), undefined);
  });

  it("propagates listed-source failures instead of publishing a partial scan", async () => {
    const { adapter, registry, virtualModules } = createRegistry();
    adapter.fs.readDir = async function* (path: string) {
      if (path === "/project/components") {
        yield {
          name: "Gone.tsx",
          isFile: true,
          isDirectory: false,
          isSymlink: false,
        };
      }
    };
    adapter.fs.stat = () =>
      Promise.resolve({
        size: 10,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        mtime: null,
      });
    adapter.fs.readFile = () => Promise.reject(new Error("source disappeared"));

    await assertRejects(
      () => registry.loadFromDirectory("/project/components", true),
      Error,
      "source disappeared",
    );
    assertEquals(virtualModules.getModule("component:Gone"), undefined);
  });

  it("rejects oversized sources before transforming them", async () => {
    const { adapter, registry, virtualModules } = createRegistry();
    adapter.fs.files.set(
      "/project/components/Huge.tsx",
      "x".repeat(DEFAULT_MAX_FILE_SIZE_BYTES + 1),
    );

    await assertRejects(
      () => registry.loadFromDirectory("/project/components", true),
      RangeError,
      "source byte limit",
    );
    assertEquals(virtualModules.getModule("component:Huge"), undefined);
  });

  it("does not retain earlier modules when a later transform fails", async () => {
    const { adapter, registry, virtualModules } = createRegistry();
    adapter.fs.files.set(
      "/project/components/Good.ts",
      "export const good = true;",
    );
    adapter.fs.files.set(
      "/project/components/Broken.ts",
      "export const broken = ;",
    );

    await assertRejects(
      () => registry.loadFromDirectory("/project/components", false),
    );
    assertEquals(virtualModules.getModule("component:Good"), undefined);
    assertEquals(virtualModules.getModule("component:Broken"), undefined);
  });

  it("fails deferred initialization without installing an error fallback", async () => {
    const { adapter, registry } = createRegistry();
    adapter.fs.files.set(
      "/project/components/NotAComponent.ts",
      "export const value = 1;",
    );

    await registry.loadFromDirectory("/project/components", true);
    await assertRejects(
      () => registry.initializeComponents(),
      Error,
      "NotAComponent",
    );

    assertEquals(registry.get("NotAComponent"), null);
    assertEquals(registry.hasFailed("NotAComponent"), true);
    assertEquals(
      registry.getVirtualModuleSystem().getModule("component:NotAComponent"),
      undefined,
    );
  });

  it("bounds entries returned by one directory", async () => {
    const { adapter, registry } = createRegistry();
    adapter.fs.readDir = async function* () {
      for (let index = 0; index < 10_001; index += 1) {
        yield {
          name: `asset-${index}.txt`,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
        };
      }
    };

    await assertRejects(
      () => registry.loadFromDirectory("/project/components", true),
      RangeError,
      "directory entry limit",
    );
  });
});
