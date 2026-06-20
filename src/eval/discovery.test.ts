import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import { discoverAll } from "#veryfront/discovery";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { deriveEvalId, discoverEvals, findEvalById } from "veryfront/eval";

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

describe("eval/discovery", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterEach(() => {
    clearTranspileCache();
  });

  afterAll(async () => {
    await stopEsbuild();
  });

  it("derives stable eval ids from eval file paths", () => {
    assertEquals(deriveEvalId("evals/deep-research.eval.ts", "evals"), "eval:deep-research");
    assertEquals(deriveEvalId("evals/rag/retrieval.ts", "evals"), "eval:rag/retrieval");
  });

  it("discovers eval files with source metadata for Studio editing", async () => {
    const adapter = createRuntimeAdapter({
      "/project/evals/deep-research.eval.ts": [
        'import { datasets, evalAgent, metrics } from "veryfront/eval";',
        "export default evalAgent({",
        '  id: "eval:deep-research",',
        '  name: "Deep research eval",',
        '  target: "agent:researcher",',
        '  dataset: datasets.inline([{ id: "q1", input: "capital", reference: "Paris" }]),',
        "  metrics: [metrics.answer.contains({ text: 'Paris' }).gate()],",
        "});",
      ].join("\n"),
    });

    const result = await discoverEvals({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
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
      "/project/evals/broken.eval.ts": 'import "./missing.ts"; export default {};',
      "/project/evals/deep-research.eval.ts": [
        'import { datasets, evalAgent } from "veryfront/eval";',
        "export const deepResearch = evalAgent({",
        '  target: "agent:researcher",',
        '  dataset: datasets.inline([{ id: "q1", input: "capital" }]),',
        "});",
      ].join("\n"),
    });

    const evalItem = await findEvalById("eval:deep-research", {
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
    });

    assertEquals(evalItem?.id, "eval:deep-research");
    assertEquals(evalItem?.exportName, "deepResearch");
  });

  it("registers eval definitions in the generic discovery result", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-eval-discovery-" });
    try {
      await Deno.mkdir(`${root}/evals`, { recursive: true });
      await Deno.writeTextFile(
        `${root}/evals/deep-research.eval.ts`,
        [
          'import { datasets, evalAgent } from "veryfront/eval";',
          "export default evalAgent({",
          '  target: "agent:researcher",',
          '  dataset: datasets.inline([{ id: "q1", input: "capital" }]),',
          "});",
        ].join("\n"),
      );

      const result = await discoverAll({
        baseDir: root,
        toolDirs: [],
        agentDirs: [],
        skillDirs: [],
        resourceDirs: [],
        promptDirs: [],
        workflowDirs: [],
        workDirs: [],
        taskDirs: [],
        evalDirs: ["evals"],
      });

      assertEquals(result.evals.has("eval:deep-research"), true);
      assertEquals(result.evals.get("eval:deep-research")?.target, "agent:researcher");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
