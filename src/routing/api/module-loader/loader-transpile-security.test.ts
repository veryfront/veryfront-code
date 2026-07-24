import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertMatch, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { nodeAdapter } from "#veryfront/platform/adapters/runtime/node/adapter.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { loadHandlerModule, resolveAdapterReadPath } from "./loader.ts";
import type { AppRouteHandler } from "./types.ts";

function createVirtualFileSystem(
  readFile: FileSystemAdapter["readFile"] = nodeAdapter.fs.readFile.bind(nodeAdapter.fs),
): FileSystemAdapter {
  return {
    readFile,
    readFileBytes: nodeAdapter.fs.readFileBytes.bind(nodeAdapter.fs),
    writeFile: nodeAdapter.fs.writeFile.bind(nodeAdapter.fs),
    rename: nodeAdapter.fs.rename.bind(nodeAdapter.fs),
    exists: nodeAdapter.fs.exists.bind(nodeAdapter.fs),
    readDir: nodeAdapter.fs.readDir.bind(nodeAdapter.fs),
    stat: nodeAdapter.fs.stat.bind(nodeAdapter.fs),
    mkdir: nodeAdapter.fs.mkdir.bind(nodeAdapter.fs),
    remove: nodeAdapter.fs.remove.bind(nodeAdapter.fs),
    makeTempDir: nodeAdapter.fs.makeTempDir.bind(nodeAdapter.fs),
    watch: nodeAdapter.fs.watch.bind(nodeAdapter.fs),
  };
}

describe("routing/api/module-loader transpile path security", () => {
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("rejects an in-project TypeScript symlink whose transpiled source escapes the project", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vf-transpile-boundary-"));
    const projectDir = join(rootDir, "project");
    const outsideDir = join(rootDir, "outside");
    const modulePath = join(projectDir, "handler.ts");
    const outsidePath = join(outsideDir, "outside.ts");
    const virtualRoot = join(rootDir, "virtual");
    const virtualProjectDir = join(virtualRoot, "project");
    const virtualModulePath = join(virtualProjectDir, "handler.ts");

    await mkdir(projectDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(
      outsidePath,
      `export function GET() { return new Response("OUTSIDE_EXECUTED"); }`,
      "utf8",
    );
    await symlink(outsidePath, modulePath);

    const toPhysicalPath = (path: string): string => {
      if (path === virtualProjectDir) return projectDir;
      if (path === virtualModulePath) return modulePath;
      return path;
    };
    let readCount = 0;
    const transpileAdapter: RuntimeAdapter = {
      ...nodeAdapter,
      fs: {
        ...createVirtualFileSystem(),
        readFile: async (path) => {
          readCount++;
          return await nodeAdapter.fs.readFile(toPhysicalPath(path));
        },
        lstat: (path) => nodeAdapter.fs.lstat!(toPhysicalPath(path)),
        realPath: (path) => nodeAdapter.fs.realPath!(toPhysicalPath(path)),
      },
    };

    try {
      await assertRejects(
        () =>
          loadHandlerModule({
            projectDir: virtualProjectDir,
            modulePath: virtualModulePath,
            adapter: transpileAdapter,
            config: undefined,
          }),
        Error,
        "escapes project directory",
      );
      assertEquals(readCount, 0);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("canonicalizes a contained TypeScript symlink without rejecting it", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "vf-transpile-contained-"));
    const targetPath = join(projectDir, "actual-handler.ts");
    const modulePath = join(projectDir, "handler.ts");
    await writeFile(
      targetPath,
      `export function GET() { return new Response("contained"); }`,
      "utf8",
    );
    await symlink(targetPath, modulePath);

    try {
      assertEquals(
        await resolveAdapterReadPath(nodeAdapter, modulePath, projectDir),
        await realpath(targetPath),
      );
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("preserves lexical reads for virtual adapters that cannot represent symlinks", async () => {
    const virtualAdapter: RuntimeAdapter = {
      ...nodeAdapter,
      id: "memory",
      fs: createVirtualFileSystem(),
    };
    const projectDir = "/virtual/project";
    const modulePath = "/virtual/project/handler.ts";

    assertEquals(
      await resolveAdapterReadPath(virtualAdapter, modulePath, projectDir),
      modulePath,
    );
  });

  it("propagates adapter read failures instead of misreporting them as missing files", async () => {
    let readCount = 0;
    const denied = Object.assign(new Error("adapter denied read"), { code: "EACCES" });
    const virtualAdapter: RuntimeAdapter = {
      ...nodeAdapter,
      id: "memory",
      fs: createVirtualFileSystem(
        async () => {
          readCount++;
          throw denied;
        },
      ),
    };

    const error = await assertRejects(
      () =>
        loadHandlerModule({
          projectDir: "/virtual/project",
          modulePath: "/virtual/project/handler.ts",
          adapter: virtualAdapter,
          config: undefined,
        }),
      Error,
    ) as Error;

    assertMatch(error.message, /adapter denied read/);
    assertEquals(readCount, 1);
  });

  it("loads handler paths containing URL-reserved characters", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vf-direct-url-"));
    const projectDir = join(rootDir, "project with spaces");
    const modulePath = join(projectDir, "handler # percent %.js");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      modulePath,
      `export function GET() { return new Response("encoded-path"); }`,
      "utf8",
    );

    try {
      const route = await loadHandlerModule({
        projectDir,
        modulePath,
        adapter: nodeAdapter,
        config: undefined,
      });
      assertEquals(typeof route?.GET, "function");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("allows packages installed in an ancestor node_modules search directory", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vf-hoisted-dependency-"));
    const projectDir = join(rootDir, "apps", "project");
    const modulePath = join(projectDir, "handler.ts");
    const packageDir = join(rootDir, "node_modules", "trusted-package");

    await mkdir(projectDir, { recursive: true });
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "trusted-package", type: "module", main: "./index.js" }),
      "utf8",
    );
    await writeFile(
      join(packageDir, "index.js"),
      `export const value = "hoisted-package";`,
      "utf8",
    );
    await writeFile(
      modulePath,
      [
        `import { value } from "trusted-package";`,
        `export function GET() { return new Response(value); }`,
      ].join("\n"),
      "utf8",
    );

    try {
      const route = await loadHandlerModule({
        projectDir,
        modulePath,
        adapter: nodeAdapter,
        config: undefined,
      });
      const handler = route?.GET as AppRouteHandler | undefined;
      const response = await handler?.(
        new Request("http://localhost"),
        { params: {} },
      );
      assertEquals(await response?.text(), "hoisted-package");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects a node_modules package symlink that resolves outside the package search tree", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vf-symlinked-dependency-"));
    const projectDir = join(rootDir, "project");
    const modulePath = join(projectDir, "handler.ts");
    const packageDir = join(rootDir, "node_modules", "untrusted-package");
    const outsideDir = join(rootDir, "outside");
    const markerName = `vf-module-loader-symlinked-package-${crypto.randomUUID()}`;
    const marker = Symbol.for(markerName);

    await mkdir(projectDir, { recursive: true });
    await mkdir(join(rootDir, "node_modules"), { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(
      join(outsideDir, "package.json"),
      JSON.stringify({ name: "untrusted-package", type: "module", main: "./index.js" }),
      "utf8",
    );
    await writeFile(
      join(outsideDir, "index.js"),
      [
        `Reflect.set(globalThis, Symbol.for(${JSON.stringify(markerName)}), true);`,
        `export const value = "OUTSIDE_EXECUTED";`,
      ].join("\n"),
      "utf8",
    );
    await symlink(outsideDir, packageDir);
    await writeFile(
      modulePath,
      [
        `import { value } from "untrusted-package";`,
        `export function GET() { return new Response(value); }`,
      ].join("\n"),
      "utf8",
    );

    try {
      await assertRejects(
        () =>
          loadHandlerModule({
            projectDir,
            modulePath,
            adapter: nodeAdapter,
            config: undefined,
          }),
        Error,
      );
      assertEquals(
        Reflect.get(globalThis, marker),
        undefined,
        "the rejected package must not execute",
      );
    } finally {
      Reflect.deleteProperty(globalThis, marker);
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  for (const extension of [".ts", ".js"]) {
    it(`rejects an in-project ${extension} handler that imports a local dependency outside the project`, async () => {
      const rootDir = await mkdtemp(join(tmpdir(), "vf-direct-dependency-boundary-"));
      const projectDir = join(rootDir, "project");
      const outsideDir = join(rootDir, "outside");
      const modulePath = join(projectDir, `handler${extension}`);
      const outsidePath = join(outsideDir, `outside${extension}`);
      const markerName = `vf-module-loader-outside-${crypto.randomUUID()}`;
      const marker = Symbol.for(markerName);

      await mkdir(projectDir, { recursive: true });
      await mkdir(outsideDir, { recursive: true });
      await writeFile(
        outsidePath,
        [
          `Reflect.set(globalThis, Symbol.for(${JSON.stringify(markerName)}), true);`,
          `export const value = "OUTSIDE_EXECUTED";`,
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        modulePath,
        [
          `import { value } from ${JSON.stringify(outsidePath)};`,
          `export function GET() { return new Response(value); }`,
        ].join("\n"),
        "utf8",
      );

      try {
        await assertRejects(
          () =>
            loadHandlerModule({
              projectDir,
              modulePath,
              adapter: nodeAdapter,
              config: undefined,
            }),
          Error,
        );
        assertEquals(
          Reflect.get(globalThis, marker),
          undefined,
          "the rejected dependency must not execute",
        );
      } finally {
        Reflect.deleteProperty(globalThis, marker);
        await rm(rootDir, { recursive: true, force: true });
      }
    });

    it(`rejects an in-project ${extension} handler with a computed local import`, async () => {
      const rootDir = await mkdtemp(join(tmpdir(), "vf-computed-import-boundary-"));
      const projectDir = join(rootDir, "project");
      const outsideDir = join(rootDir, "outside");
      const modulePath = join(projectDir, `handler${extension}`);
      const outsidePath = join(outsideDir, `outside${extension}`);
      const markerName = `vf-module-loader-computed-outside-${crypto.randomUUID()}`;
      const marker = Symbol.for(markerName);

      await mkdir(projectDir, { recursive: true });
      await mkdir(outsideDir, { recursive: true });
      await writeFile(
        outsidePath,
        [
          `Reflect.set(globalThis, Symbol.for(${JSON.stringify(markerName)}), true);`,
          `export const value = "OUTSIDE_EXECUTED";`,
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        modulePath,
        [
          `const dependency = ${JSON.stringify(outsidePath)};`,
          `const { value } = await import(dependency);`,
          `export function GET() { return new Response(value); }`,
        ].join("\n"),
        "utf8",
      );

      try {
        await assertRejects(
          () =>
            loadHandlerModule({
              projectDir,
              modulePath,
              adapter: nodeAdapter,
              config: undefined,
            }),
          Error,
          "non-literal dynamic import",
        );
        assertEquals(
          Reflect.get(globalThis, marker),
          undefined,
          "the rejected dependency must not execute",
        );
      } finally {
        Reflect.deleteProperty(globalThis, marker);
        await rm(rootDir, { recursive: true, force: true });
      }
    });

    it(`does not treat an arbitrary ${extension} path as trusted merely because it contains node_modules`, async () => {
      const rootDir = await mkdtemp(join(tmpdir(), "vf-node-modules-boundary-"));
      const projectDir = join(rootDir, "project");
      const outsideDir = join(rootDir, "outside", "node_modules", "untrusted");
      const modulePath = join(projectDir, `handler${extension}`);
      const outsidePath = join(outsideDir, `outside${extension}`);
      const markerName = `vf-module-loader-node-modules-${crypto.randomUUID()}`;
      const marker = Symbol.for(markerName);

      await mkdir(projectDir, { recursive: true });
      await mkdir(outsideDir, { recursive: true });
      await writeFile(
        outsidePath,
        [
          `Reflect.set(globalThis, Symbol.for(${JSON.stringify(markerName)}), true);`,
          `export const value = "OUTSIDE_EXECUTED";`,
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        modulePath,
        [
          `import { value } from ${JSON.stringify(outsidePath)};`,
          `export function GET() { return new Response(value); }`,
        ].join("\n"),
        "utf8",
      );

      try {
        await assertRejects(
          () =>
            loadHandlerModule({
              projectDir,
              modulePath,
              adapter: nodeAdapter,
              config: undefined,
            }),
          Error,
        );
        assertEquals(
          Reflect.get(globalThis, marker),
          undefined,
          "the rejected dependency must not execute",
        );
      } finally {
        Reflect.deleteProperty(globalThis, marker);
        await rm(rootDir, { recursive: true, force: true });
      }
    });
  }
});
