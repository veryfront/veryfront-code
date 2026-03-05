import { assertEquals, assertMatch } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { loadHandlerModule, toCjsDestructureBindings } from "./loader.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { env, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";

const fs = createFileSystem();

const adapter: RuntimeAdapter = {
  id: "node",
  name: "node-stub",
  capabilities: {
    typescript: true,
    jsx: true,
    http2: true,
    websocket: true,
    workers: true,
    fileWatching: true,
    shell: true,
    kvStore: false,
    writableFs: true,
  },
  fs: {
    readFile: fs.readTextFile.bind(fs),
    writeFile: fs.writeTextFile.bind(fs),
    exists: fs.exists.bind(fs),
    async *readDir(path: string) {
      for await (const entry of fs.readDir(path)) {
        yield {
          name: entry.name,
          isFile: entry.isFile,
          isDirectory: entry.isDirectory,
          isSymlink: false,
        };
      }
    },
    stat: fs.stat.bind(fs),
    mkdir: fs.mkdir.bind(fs),
    remove: fs.remove.bind(fs),
    makeTempDir: (prefix: string) => fs.makeTempDir({ prefix }),
    watch() {
      return {
        async *[Symbol.asyncIterator]() {},
        close() {},
      };
    },
  },
  env: {
    get(key: string) {
      return getEnv(key);
    },
    set(key: string, value: string) {
      setEnv(key, value);
    },
    toObject() {
      return env();
    },
  },
  server: {
    upgradeWebSocket() {
      throw new Error("not implemented");
    },
  },
  serve() {
    throw new Error("not implemented");
  },
};

describe("loadHandlerModule", { sanitizeResources: false, sanitizeOps: false }, () => {
  afterAll(async () => {
    const { stop } = await import("esbuild");
    await stop();
  });

  it("loads .ts file with explicit extension", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "handler.ts");

    await fs.writeTextFile(modulePath, `export const GET = () => new Response("ok");`);

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(typeof route?.GET, "function");
  });

  it("resolves relative imports through adapter when file is not local", async () => {
    const realDir = await makeTempDir();
    await fs.mkdir(join(realDir, "lib"), { recursive: true });
    await fs.mkdir(join(realDir, "pages", "api"), { recursive: true });

    await fs.writeTextFile(
      join(realDir, "lib", "helper.ts"),
      `export function greet(): string { return "hello"; }`,
    );

    await fs.writeTextFile(
      join(realDir, "pages", "api", "test.ts"),
      [
        `import { greet } from "../../lib/helper.ts";`,
        `export function GET() { return new Response(greet()); }`,
      ].join("\n"),
    );

    const tempRoot = await makeTempDir();
    const virtualBase = join(tempRoot, `vf-nonexistent-${Date.now()}`);
    const toReal = (path: string): string => path.replace(virtualBase, realDir);

    const virtualAdapter: RuntimeAdapter = {
      ...adapter,
      fs: {
        ...adapter.fs,
        readFile: (path: string) => fs.readTextFile(toReal(path)),
        exists: (path: string) => fs.exists(toReal(path)),
      },
    };

    const route = await loadHandlerModule({
      projectDir: virtualBase,
      modulePath: join(virtualBase, "pages", "api", "test.ts"),
      adapter: virtualAdapter,
      config: undefined,
    });

    assertEquals(typeof route?.GET, "function");
  });

  it("throws on missing file", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "missing");

    let caught = "";
    try {
      await loadHandlerModule({
        projectDir: tmpDir,
        modulePath,
        adapter,
        config: undefined,
      });
    } catch (error) {
      caught = error instanceof Error ? error.message : String(error);
    }

    assertMatch(caught, /Failed to load API handler/i);
  });

  it("loads handler when project has package.json with user dependencies", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "handler.ts");

    // Create a package.json with a user dependency (not actually imported)
    await fs.writeTextFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { "pdf-parse": "^1.1.1" } }),
    );

    await fs.writeTextFile(modulePath, `export const GET = () => new Response("ok");`);

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(typeof route?.GET, "function");
  });

  it("loads handler when project has no package.json", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "handler.ts");

    // No package.json at all — should gracefully handle
    await fs.writeTextFile(modulePath, `export const POST = () => new Response("created");`);

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(typeof route?.POST, "function");
  });

  it("loads handler when package.json has framework-only dependencies", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "handler.ts");

    // Only framework packages — should all be filtered out from user deps
    await fs.writeTextFile(
      join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: {
          ai: "^3.0.0",
          zod: "^3.22.0",
          veryfront: "^0.1.26",
          "react": "^18.0.0",
          "@ai-sdk/openai": "^1.0.0",
        },
      }),
    );

    await fs.writeTextFile(modulePath, `export const GET = () => new Response("ok");`);

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(typeof route?.GET, "function");
  });

  it("handler that uses require('fs') works via createRequire shim", async () => {
    const tmpDir = await makeTempDir();
    const modulePath = join(tmpDir, "handler.ts");

    // Simulate a handler that uses Node's fs module (as CJS packages often do internally)
    await fs.writeTextFile(
      modulePath,
      [
        `import { existsSync } from "node:fs";`,
        `export function GET() {`,
        `  const exists = typeof existsSync === "function";`,
        `  return new Response(String(exists));`,
        `}`,
      ].join("\n"),
    );

    const route = await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });

    assertEquals(typeof route?.GET, "function");
  });

  it("converts aliased named imports to valid CJS destructuring", () => {
    assertEquals(
      toCjsDestructureBindings("{ parse as parsePdf, version }"),
      "{ parse: parsePdf, version }",
    );
    assertEquals(
      toCjsDestructureBindings("{ default as foo, bar as baz }"),
      "{ default: foo, bar: baz }",
    );
    assertEquals(
      toCjsDestructureBindings("{ foo, bar }"),
      "{ foo, bar }",
    );
  });
});
