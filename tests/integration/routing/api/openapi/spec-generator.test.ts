import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { stop } from "#veryfront/extensions/bundler/index.ts";
import { generateOpenAPISpec } from "#veryfront/routing/api/openapi/spec-generator.ts";
import { ApiRouteMatcher } from "#veryfront/routing/api/api-route-matcher.ts";
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

describe("routing/api/openapi generateOpenAPISpec()", () => {
  afterAll(async () => {
    await stop();
  });

  it("builds paths, operations, tags and servers from discovered API routes", async () => {
    const projectDir = await makeTempDir();

    const usersModule = join(projectDir, "users-by-id.ts");
    await fs.writeTextFile(
      usersModule,
      [
        'const METADATA = Symbol.for("veryfront.openapi.metadata");',
        'export const GET = () => new Response("ok");',
        "(GET as unknown as Record<symbol, unknown>)[METADATA] = {",
        '  summary: "Fetch one user",',
        '  tags: ["users"],',
        "};",
        'export default () => new Response("fallback");',
      ].join("\n"),
    );

    const publicModule = join(projectDir, "public-page.ts");
    await fs.writeTextFile(publicModule, 'export const GET = () => new Response("ok");');

    const brokenModule = join(projectDir, "broken-route.ts");
    await fs.writeTextFile(brokenModule, 'throw new Error("route module blew up");');

    const router = new ApiRouteMatcher();
    try {
      router.addRoute("/api/users/[id]", usersModule);
      router.addRoute("/public", publicModule);
      router.addRoute("/api/broken", brokenModule);

      const spec = await generateOpenAPISpec(router, projectDir, adapter, undefined, {
        allowHostProjectCodeExecution: true,
        servers: [{ url: "https://api.example.com" }],
      });

      const users = spec.paths["/api/users/{id}"];
      assertExists(users, "an /api route must reach the emitted spec");

      assertEquals(
        users.get?.operationId,
        "getUsersById",
        "the GET operation id is derived from the OpenAPI path",
      );
      assertEquals(
        users.get?.summary,
        "Fetch one user",
        "the handler's OpenAPI metadata supplies the summary",
      );
      assertEquals(
        users.get?.parameters,
        [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        "the dynamic segment becomes a required path parameter",
      );
      assertEquals(
        users.post?.operationId,
        "postUsersById",
        "the default handler fills the methods the module does not export",
      );
      assertEquals(
        users.delete?.summary,
        "DELETE /api/users/{id}",
        "a default-handler operation falls back to a generated summary",
      );

      assertEquals(
        Object.keys(spec.paths),
        ["/api/users/{id}"],
        "non-API routes are filtered out and a throwing route is skipped, not fatal",
      );
      assertEquals(spec.tags, [{ name: "users" }], "handler tags are collected and sorted");
      assertEquals(
        spec.servers,
        [{ url: "https://api.example.com" }],
        "the supplied servers reach the emitted spec",
      );
    } finally {
      router.destroy();
    }
  });
});
