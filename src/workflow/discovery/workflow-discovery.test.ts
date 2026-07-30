import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import {
  createWorkflowRegistry,
  discoverWorkflows,
  findWorkflowById,
} from "./workflow-discovery.ts";

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
        "/project/workflows/ping.ts": [
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

    it("discovers workflow files that import public tool and schema APIs", async () => {
      const adapter = createRuntimeAdapter({
        "/project/workflows/smoke.ts": [
          'import { defineSchema } from "veryfront/schemas";',
          'import { tool } from "veryfront/tool";',
          'import { step, workflow } from "veryfront/workflow";',
          "",
          "const startTool = tool({",
          '  id: "smoke-start",',
          '  description: "Complete the smoke workflow start step.",',
          "  inputSchema: defineSchema((v) => v.object({}).passthrough())(),",
          "  execute: async (input) => ({ ok: true, input }),",
          "});",
          "",
          "export default workflow({",
          '  id: "smoke",',
          '  description: "Smoke workflow",',
          "  steps: [step('start', { tool: startTool })],",
          "});",
        ].join("\n"),
      });

      const result = await discoverWorkflows({
        projectDir: "/project",
        adapter,
        config: { fs: { type: "veryfront-api" } } as never,
      });

      assertEquals(result.errors, []);
      assertEquals(result.workflows.map((workflow) => workflow.id), ["smoke"]);
      assertEquals(result.workflows[0]?.definition.steps.length, 1);
    });

    it("finds workflows by id through the discovery module loader", async () => {
      const adapter = createRuntimeAdapter({
        "/project/workflows/ping.ts": [
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

    it("returns null only after a complete discovery with no matching workflow", async () => {
      const workflow = await findWorkflowById("missing", {
        projectDir: "/project",
        adapter: createRuntimeAdapter({}),
        config: { fs: { type: "veryfront-api" } } as never,
      });

      assertEquals(workflow, null);
    });

    it("fails closed when any workflow module cannot be discovered", async () => {
      const adapter = createRuntimeAdapter({
        "/project/workflows/ping.ts": [
          'import { workflow } from "veryfront/workflow";',
          'export default workflow({ id: "ping", steps: [] });',
        ].join("\n"),
        "/project/workflows/broken.ts": "export default {",
      });

      await assertRejects(
        () =>
          findWorkflowById("ping", {
            projectDir: "/project",
            adapter,
            config: { fs: { type: "veryfront-api" } } as never,
          }),
        Error,
        "Workflow discovery was incomplete",
      );
    });

    it("rejects ambiguous and duplicate workflow identities", async () => {
      const adapter = createRuntimeAdapter({
        "/project/workflows/one.ts": [
          'import { workflow } from "veryfront/workflow";',
          'export default workflow({ id: "duplicate", steps: [] });',
        ].join("\n"),
        "/project/workflows/two.ts": [
          'import { workflow } from "veryfront/workflow";',
          'export default workflow({ id: "duplicate", steps: [] });',
        ].join("\n"),
      });
      const options = {
        projectDir: "/project",
        adapter,
        config: { fs: { type: "veryfront-api" } } as never,
      };

      await assertRejects(
        () => findWorkflowById("duplicate", options),
        Error,
        "ambiguous",
      );

      const discovered = await discoverWorkflows(options);
      assertThrows(
        () => createWorkflowRegistry(discovered.workflows),
        Error,
        'Duplicate workflow ID "duplicate"',
      );
    });

    it("does not discover legacy app/workflows files by default", async () => {
      const adapter = createRuntimeAdapter({
        "/project/app/workflows/legacy-ping.ts": [
          'import { workflow } from "veryfront/workflow";',
          "export default workflow({",
          '  id: "legacy-ping",',
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
      assertEquals(result.workflows, []);
    });
  },
);
