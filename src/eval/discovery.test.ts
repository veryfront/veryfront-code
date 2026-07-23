import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { DiscoveryResult } from "#veryfront/discovery/types.ts";
import { evalHandler } from "#veryfront/discovery/handlers/eval-handler.ts";
import {
  datasets,
  deriveEvalId,
  discoverEvals,
  evalAgent,
  evalTool,
  findEvalById,
  metrics,
} from "veryfront/eval";

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

describe("eval/discovery", () => {
  it("derives stable eval ids from eval file paths", () => {
    assertEquals(deriveEvalId("evals/deep-research.eval.ts", "evals"), "eval:deep-research");
    assertEquals(deriveEvalId("evals/rag/retrieval.ts", "evals"), "eval:rag/retrieval");
  });

  it("discovers eval files with source metadata for Studio editing", async () => {
    const adapter = createRuntimeAdapter({
      "/project/evals/deep-research.eval.ts": "",
    });

    const result = await discoverEvals({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
      moduleLoader: async () => ({
        default: evalAgent({
          id: "eval:deep-research",
          name: "Deep research eval",
          target: "agent:researcher",
          dataset: datasets.inline([{ id: "q1", input: "capital", reference: "Paris" }]),
          metrics: [metrics.answer.contains({ text: "Paris" }).gate()],
        }),
      }),
    });

    assertEquals(result.errors, []);
    assertEquals(
      result.evals.map((item) => ({
        id: item.id,
        name: item.name,
        filePath: item.filePath,
        exportName: item.exportName,
        target: item.definition.target,
      })),
      [
        {
          id: "eval:deep-research",
          name: "Deep research eval",
          filePath: "evals/deep-research.eval.ts",
          exportName: "default",
          target: "agent:researcher",
        },
      ],
    );
    assertEquals(result.evals[0]?.definition.source, {
      filePath: "evals/deep-research.eval.ts",
      exportName: "default",
    });
  });

  it("finds an eval by id even when another eval file fails to load", async () => {
    const adapter = createRuntimeAdapter({
      "/project/evals/broken.eval.ts": "",
      "/project/evals/deep-research.eval.ts": "",
    });

    const evalItem = await findEvalById("eval:deep-research", {
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
      moduleLoader: async (filePath) => {
        if (filePath.endsWith("broken.eval.ts")) {
          throw new Error("missing import");
        }
        return {
          deepResearch: evalAgent({
            target: "agent:researcher",
            dataset: datasets.inline([{ id: "q1", input: "capital" }]),
          }),
        };
      },
    });

    assertEquals(evalItem?.id, "eval:deep-research");
    assertEquals(evalItem?.exportName, "deepResearch");
  });

  it("registers eval definitions in the generic discovery handler", () => {
    const definition = evalAgent({
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "capital" }]),
    });
    const filePath = "/project/evals/deep-research.eval.ts";
    const dir = "/project/evals";
    const result = {
      evals: new Map(),
    } as DiscoveryResult;

    const id = evalHandler.getId(definition, filePath, dir);
    evalHandler.getResultMap(result).set(id, evalHandler.register(id, definition, filePath, dir));

    assertEquals(result.evals.has("eval:deep-research"), true);
    assertEquals(result.evals.get("eval:deep-research")?.target, "agent:researcher");
    assertEquals(result.evals.get("eval:deep-research")?.source, {
      filePath,
      exportName: "default",
    });
  });

  it("discovers tool eval definitions", async () => {
    const adapter = createRuntimeAdapter({
      "/project/evals/order-tool.eval.ts": "",
    });

    const result = await discoverEvals({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
      moduleLoader: async () => ({
        default: evalTool({
          id: "eval:order-tool",
          name: "Order tool eval",
          target: "tool:lookup_order",
          dataset: datasets.inline([{ id: "q1", input: { orderId: "A1049" } }]),
          metrics: [metrics.agent.calledTool("lookup_order").gate()],
        }),
      }),
    });

    assertEquals(result.errors, []);
    assertEquals(result.evals[0]?.definition.targetKind, "tool");
    assertEquals(result.evals[0]?.definition.target, "tool:lookup_order");
  });

  it("reports duplicate explicit eval ids instead of returning an ambiguous definition", async () => {
    const adapter = createRuntimeAdapter({
      "/project/evals/first.eval.ts": "",
      "/project/evals/second.eval.ts": "",
    });
    const result = await discoverEvals({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
      moduleLoader: async () => ({
        default: evalAgent({
          id: "eval:duplicate",
          target: "agent:researcher",
          dataset: datasets.inline([{ id: "q1", input: "capital" }]),
        }),
      }),
    });

    assertEquals(result.evals.length, 1);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0]?.error, 'Duplicate eval id "eval:duplicate"');
  });
});
