import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import {
  createWorkflowRegistry,
  type DiscoveredWorkflow,
  discoverWorkflows as discoverWorkflowsRaw,
  findWorkflowById as findWorkflowByIdRaw,
} from "./workflow-discovery.ts";

const discoverWorkflows: typeof discoverWorkflowsRaw = (options) =>
  discoverWorkflowsRaw({ ...options, allowHostProjectCodeExecution: true });
const findWorkflowById: typeof findWorkflowByIdRaw = (workflowId, options) =>
  findWorkflowByIdRaw(workflowId, {
    ...options,
    allowHostProjectCodeExecution: true,
  });

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

    it("returns an empty result when the workflow directory is absent", async () => {
      const result = await discoverWorkflows({
        projectDir: "/project",
        adapter: createRuntimeAdapter({}),
        config: { fs: { type: "veryfront-api" } } as never,
      });

      assertEquals(result, { workflows: [], errors: [] });
    });

    it("keeps valid sibling exports after rejecting malformed definitions", async () => {
      const adapter = createRuntimeAdapter({
        "/project/workflows/mixed.ts": [
          "const accessor = Object.defineProperty({ steps: [] }, 'id', {",
          "  enumerable: true,",
          "  get() { throw new Error('workflow id accessor executed'); },",
          "});",
          "export { accessor };",
          "export const malformed = { id: 'malformed', steps: null };",
          "export const valid = { id: 'valid', steps: [] };",
        ].join("\n"),
      });

      const result = await discoverWorkflows({
        projectDir: "/project",
        adapter,
        config: { fs: { type: "veryfront-api" } } as never,
      });

      assertEquals(result.workflows.map((workflow) => workflow.id), ["valid"]);
      assertEquals(Object.isFrozen(result.workflows[0]?.definition), true);
      assertEquals(result.errors.length, 2);
      assertEquals(
        result.errors.some((entry) => entry.error.includes("accessor executed")),
        false,
      );
    });

    it("rejects duplicate workflow IDs deterministically", async () => {
      const adapter = createRuntimeAdapter({
        "/project/workflows/z.ts": "export default { id: 'duplicate', steps: [] };",
        "/project/workflows/a.ts": "export default { id: 'duplicate', steps: [] };",
      });

      const result = await discoverWorkflows({
        projectDir: "/project",
        adapter,
        config: { fs: { type: "veryfront-api" } } as never,
      });

      assertEquals(result.workflows, []);
      assertEquals(result.errors.map((entry) => entry.filePath), [
        "workflows/a.ts",
        "workflows/z.ts",
      ]);
      assertEquals(
        result.errors.every((entry) => entry.error.includes('Duplicate workflow id "duplicate"')),
        true,
      );
      assertEquals(
        await findWorkflowById("duplicate", {
          projectDir: "/project",
          adapter,
          config: { fs: { type: "veryfront-api" } } as never,
        }),
        null,
      );
    });

    it("sorts discovered workflows independently of adapter enumeration order", async () => {
      const adapter = createRuntimeAdapter({
        "/project/workflows/z.ts": "export default { id: 'zeta', steps: [] };",
        "/project/workflows/a.ts": "export default { id: 'alpha', steps: [] };",
      });

      const result = await discoverWorkflows({
        projectDir: "/project",
        adapter,
        config: { fs: { type: "veryfront-api" } } as never,
      });

      assertEquals(result.workflows.map((workflow) => workflow.id), ["alpha", "zeta"]);
    });

    it("rejects workflow roots that escape the project", async () => {
      const adapter = createRuntimeAdapter({});
      let existsCalls = 0;
      adapter.fs.exists = () => {
        existsCalls++;
        return Promise.resolve(false);
      };

      const result = await discoverWorkflows({
        projectDir: "/project",
        workflowsDir: "../outside",
        adapter,
      });

      assertEquals(result.workflows, []);
      assertEquals(result.errors.length, 1);
      assertStringIncludes(result.errors[0]!.error, "stay within the project");
      assertEquals(existsCalls, 0);
    });

    it("requires explicit authority before executing project workflow code", async () => {
      const result = await discoverWorkflowsRaw({
        projectDir: "/project",
        adapter: createRuntimeAdapter({
          "/project/workflows/ping.ts": "export default { id: 'ping', steps: [] };",
        }),
        config: { fs: { type: "veryfront-api" } } as never,
      });

      assertEquals(result.workflows, []);
      assertEquals(result.errors.length, 1);
    });

    it("creates a registry without silently overwriting duplicate IDs", () => {
      const definition = { id: "duplicate", steps: [] };
      const workflows: DiscoveredWorkflow[] = [
        { id: "duplicate", filePath: "workflows/a.ts", exportName: "default", definition },
        { id: "duplicate", filePath: "workflows/b.ts", exportName: "default", definition },
      ];

      assertThrows(
        () => createWorkflowRegistry(workflows),
        VeryfrontError,
        'Duplicate workflow id "duplicate"',
      );
    });

    it("snapshots each registry id before checking and inserting it", () => {
      let idReads = 0;
      const shifting = Object.defineProperty(
        {
          filePath: "workflows/a.ts",
          exportName: "default",
          definition: { id: "duplicate", steps: [] },
        },
        "id",
        {
          enumerable: true,
          get() {
            idReads++;
            return idReads === 1 ? "duplicate" : idReads === 2 ? "other" : "duplicate";
          },
        },
      ) as unknown as DiscoveredWorkflow;
      const duplicate: DiscoveredWorkflow = {
        id: "duplicate",
        filePath: "workflows/b.ts",
        exportName: "default",
        definition: { id: "duplicate", steps: [] },
      };

      assertThrows(
        () => createWorkflowRegistry([shifting, duplicate]),
        VeryfrontError,
        'Duplicate workflow id "duplicate"',
      );
      assertEquals(idReads, 1);
    });
  },
);
