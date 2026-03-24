import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { stop as stopEsbuild } from "esbuild";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import { discoverWorkflows, findWorkflowById } from "./workflow-discovery.ts";

function createMockAdapter(files: Record<string, string>): FileSystemAdapter {
  const normalize = (path: string): string => path.replace(/^\/project\/?/, "").replace(/^\/+/, "");
  const normalizedFiles = Object.fromEntries(
    Object.entries(files).map(([path, content]) => [normalize(path), content]),
  );

  return {
    async readFile(path: string): Promise<string> {
      const content = normalizedFiles[normalize(path)];
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    },
    async exists(path: string): Promise<boolean> {
      const normalizedPath = normalize(path);
      return (
        normalizedPath in normalizedFiles ||
        Object.keys(normalizedFiles).some((key) => key.startsWith(`${normalizedPath}/`))
      );
    },
    async *readDir(path: string) {
      const normalizedPath = normalize(path);
      const prefix = normalizedPath.endsWith("/") ? normalizedPath : `${normalizedPath}/`;
      const seen = new Set<string>();

      for (const key of Object.keys(normalizedFiles)) {
        if (!key.startsWith(prefix)) continue;

        const rest = key.slice(prefix.length);
        if (!rest) continue;

        const name = rest.split("/")[0]!;
        if (seen.has(name)) continue;

        seen.add(name);
        const isFile = !rest.includes("/");
        yield { name, isFile, isDirectory: !isFile, isSymlink: false };
      }
    },
    async stat(path: string) {
      const normalizedPath = normalize(path);
      const isFile = normalizedPath in normalizedFiles;
      return {
        size: isFile ? normalizedFiles[normalizedPath]!.length : 0,
        isFile,
        isDirectory: !isFile,
        isSymlink: false,
        mtime: new Date(),
      };
    },
    async writeFile() {},
    async mkdir() {},
    async remove() {},
    async makeTempDir() {
      return "/tmp/mock";
    },
    watch() {
      return null as never;
    },
  } satisfies FileSystemAdapter;
}

function createRuntimeAdapter(files: Record<string, string>): RuntimeAdapter {
  return {
    id: "memory",
    name: "Memory",
    capabilities: {
      typescript: true,
      jsx: true,
      http2: false,
      websocket: false,
      workers: false,
      fileWatching: false,
      shell: false,
      kvStore: false,
      writableFs: true,
    },
    fs: createMockAdapter(files),
    env: {
      get: () => undefined,
      set: () => {},
      toObject: () => ({}),
    },
    server: {} as RuntimeAdapter["server"],
    async serve() {
      return {
        addr: { hostname: "127.0.0.1", port: 0 },
        async stop() {},
      };
    },
  };
}

// Discovery uses the shared esbuild service under the hood, which outlives
// individual test cases until stopEsbuild() runs in afterAll.
describe(
  "workflow/discovery/workflow-discovery",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterEach(() => {
      clearTranspileCache();
    });

    afterAll(async () => {
      await stopEsbuild();
    });

    it("discovers workflow DSL exports through the discovery module loader", async () => {
      const adapter = createRuntimeAdapter({
        "/project/app/workflows/ping.ts": [
          'import { workflow } from "veryfront/workflow";',
          "export default workflow({",
          '  id: "ping",',
          '  description: "Ping workflow",',
          "  steps: [],",
          "});",
        ].join("\n"),
      });

      const result = await discoverWorkflows({
        projectDir: "/project",
        adapter,
        config: { fs: { type: "veryfront-api" } } as never,
      });

      assertEquals(result.errors, []);
      assertEquals(result.workflows.map((workflow) => workflow.id), ["ping"]);
      assertEquals(result.workflows[0]?.exportName, "default");
    });

    it("finds workflows by id through the discovery module loader", async () => {
      const adapter = createRuntimeAdapter({
        "/project/app/workflows/ping.ts": [
          'import { workflow } from "veryfront/workflow";',
          "export const pingWorkflow = workflow({",
          '  id: "ping",',
          "  steps: [],",
          "});",
        ].join("\n"),
      });

      const workflow = await findWorkflowById("ping", {
        projectDir: "/project",
        adapter,
        config: { fs: { type: "veryfront-api" } } as never,
      });

      assertEquals(workflow?.id, "ping");
      assertEquals(workflow?.exportName, "pingWorkflow");
    });
  },
);
