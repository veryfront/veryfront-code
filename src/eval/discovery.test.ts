import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { VeryfrontError } from "#veryfront/errors";
import { resolveEvalById } from "./discovery.ts";
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
    assertEquals(
      deriveEvalId(
        String.raw`C:\repo\evals\rag\retrieval.eval.ts`,
        String.raw`C:\repo\evals`,
      ),
      "eval:rag/retrieval",
    );
  });

  it("fails closed when multiple files declare the same eval id", async () => {
    const adapter = createRuntimeAdapter({
      "/project/evals/alpha.eval.ts": "",
      "/project/evals/beta.eval.ts": "",
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

    assertEquals(result.evals, []);
    assertEquals(result.errors.map((entry) => entry.filePath), [
      "evals/alpha.eval.ts",
      "evals/beta.eval.ts",
    ]);
    assertEquals(result.errors.every((entry) => entry.error.includes("Duplicate eval id")), true);
  });

  it("orders discovered evals and errors by code unit", async () => {
    const adapter = createRuntimeAdapter({
      "/project/evals/alpha.eval.ts": "",
      "/project/evals/Alpha.eval.ts": "",
      "/project/evals/broken-alpha.eval.ts": "",
      "/project/evals/broken-Alpha.eval.ts": "",
    });
    const result = await discoverEvals({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
      moduleLoader: async (filePath) => {
        if (filePath.includes("broken")) {
          throw new Error(`missing import in ${filePath}`);
        }
        return {
          default: evalAgent({
            id: filePath.includes("Alpha") ? "eval:Alpha" : "eval:alpha",
            target: "agent:researcher",
            dataset: datasets.inline([{ id: "q1", input: "capital" }]),
          }),
        };
      },
    });

    assertEquals(
      result.evals.map((item) => item.id),
      ["eval:Alpha", "eval:alpha"],
      "eval discovery result order must use code-unit ordering for eval ids",
    );
    assertEquals(
      result.errors.map((entry) => entry.filePath),
      ["evals/broken-Alpha.eval.ts", "evals/broken-alpha.eval.ts"],
      "eval discovery error order must use code-unit ordering for eval file paths",
    );
  });

  it("resolves the evals directory against the project dir for local filesystems", async () => {
    const adapter = createRuntimeAdapter({
      "/project/evals/local.eval.ts": "",
    });

    const result = await discoverEvals({
      projectDir: "/project",
      adapter,
      moduleLoader: async () => ({
        default: evalAgent({
          id: "eval:local",
          target: "agent:researcher",
          dataset: datasets.inline([{ id: "q1", input: "capital" }]),
        }),
      }),
    });

    assertEquals(result.errors, []);
    assertEquals(
      result.evals[0]?.filePath,
      "/project/evals/local.eval.ts",
      "local discovery joins projectDir with evalsDir",
    );
  });

  it("discovers eval files with source metadata for Studio editing", async () => {
    const adapter = createRuntimeAdapter({
      "/project/evals/deep-research.eval.ts": "",
    });
    let receivedHostExecutionCapability: boolean | undefined;

    const result = await discoverEvals({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
      allowHostProjectCodeExecution: true,
      moduleLoader: async (_filePath, options) => {
        receivedHostExecutionCapability = options.allowHostProjectCodeExecution;
        return {
          default: evalAgent({
            id: "eval:deep-research",
            name: "Deep research eval",
            target: "agent:researcher",
            dataset: datasets.inline([{ id: "q1", input: "capital", reference: "Paris" }]),
            metrics: [metrics.answer.contains({ text: "Paris" }).gate()],
          }),
        };
      },
    });

    assertEquals(result.errors, []);
    assertEquals(receivedHostExecutionCapability, true);
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

  describe("resolveEvalById", () => {
    const evalDefinition = () =>
      evalAgent({
        target: "agent:researcher",
        dataset: datasets.inline([{ id: "q1", input: "capital" }]),
      });

    /** Local filesystem layout: discovered paths are absolute under the project dir. */
    function resolveLocal(
      files: Record<string, string>,
      evalId: string,
      moduleLoader: (filePath: string) => Promise<Record<string, unknown>>,
    ) {
      return resolveEvalById(evalId, {
        projectDir: "/project",
        adapter: createRuntimeAdapter(files),
        moduleLoader,
      });
    }

    async function rejection(promise: Promise<unknown>): Promise<VeryfrontError> {
      try {
        await promise;
      } catch (error) {
        if (error instanceof VeryfrontError) return error;
        throw error;
      }
      throw new Error("expected a rejection");
    }

    it("resolves evals/<name>.eval.ts to eval:<name>", async () => {
      const found = await resolveLocal(
        { "/project/evals/by-hand.eval.ts": "" },
        "eval:by-hand",
        async () => ({ default: evalDefinition() }),
      );

      assertEquals(found.id, "eval:by-hand");
      assertEquals(found.filePath, "/project/evals/by-hand.eval.ts");
    });

    it("resolves every file form discovery accepts", async () => {
      const cases: Array<[string, string]> = [
        ["/project/evals/plain.ts", "eval:plain"],
        ["/project/evals/view.eval.tsx", "eval:view"],
        ["/project/evals/script.eval.js", "eval:script"],
        ["/project/evals/component.jsx", "eval:component"],
        ["/project/evals/rag/retrieval.eval.ts", "eval:rag/retrieval"],
      ];
      for (const [path, evalId] of cases) {
        const found = await resolveLocal(
          { [path]: "" },
          evalId,
          async () => ({ default: evalDefinition() }),
        );
        assertEquals(found.id, evalId, path);
      }
    });

    it("resolves an id the definition declares instead of the path id", async () => {
      const found = await resolveLocal(
        { "/project/evals/by-hand.eval.ts": "" },
        "eval:declared",
        async () => ({
          default: evalAgent({
            id: "eval:declared",
            target: "agent:researcher",
            dataset: datasets.inline([{ id: "q1", input: "capital" }]),
          }),
        }),
      );

      assertEquals(found.id, "eval:declared");
    });

    it("resolves through a remote project filesystem with relative paths", async () => {
      const found = await resolveEvalById("eval:by-hand", {
        projectDir: "/project",
        adapter: createRuntimeAdapter({ "evals/by-hand.eval.ts": "" }),
        config: { fs: { type: "veryfront-api" } } as never,
        moduleLoader: async () => ({ default: evalDefinition() }),
      });

      assertEquals(found.filePath, "evals/by-hand.eval.ts");
    });

    it("names the file and the load error when the eval file does not load", async () => {
      await assertRejects(
        () =>
          resolveLocal(
            { "/project/evals/by-hand.eval.ts": "" },
            "eval:by-hand",
            async () => {
              throw new Error(
                "Failed to read /project/evals/by-hand.eval.ts: answer.contains text must be a non-empty string",
              );
            },
          ),
        VeryfrontError,
        "Eval eval:by-hand failed to load from evals/by-hand.eval.ts: Failed to read evals/by-hand.eval.ts: answer.contains text must be a non-empty string. Fix the file, then run the eval again.",
      );
      const error = await rejection(resolveLocal(
        { "/project/evals/by-hand.eval.ts": "" },
        "eval:by-hand",
        async () => {
          throw new Error("Failed to read /project/evals/by-hand.eval.ts: <CAUSE>");
        },
      ));
      assertEquals(error.slug, "eval-load-failed");
      assertEquals(error.message.includes("/project/"), false, "no absolute path in the message");
      assertEquals(error.context, { evalId: "eval:by-hand", filePath: "evals/by-hand.eval.ts" });
    });

    it("names a load error for a sibling file form", async () => {
      const error = await rejection(resolveLocal(
        { "/project/evals/rag/retrieval.ts": "" },
        "eval:rag/retrieval",
        async () => {
          throw new Error("<CAUSE>");
        },
      ));

      assertEquals(error.slug, "eval-load-failed");
      assertStringIncludes(error.message, "from evals/rag/retrieval.ts: <CAUSE>.");
    });

    it("names every file that declares the same id", async () => {
      await assertRejects(
        () =>
          resolveLocal(
            { "/project/evals/alpha.eval.ts": "", "/project/evals/beta.eval.ts": "" },
            "eval:duplicate",
            async () => ({
              default: evalAgent({
                id: "eval:duplicate",
                target: "agent:researcher",
                dataset: datasets.inline([{ id: "q1", input: "capital" }]),
              }),
            }),
          ),
        VeryfrontError,
        "Eval eval:duplicate is declared by more than one file: evals/alpha.eval.ts, evals/beta.eval.ts. Give each eval a unique id, then run the eval again.",
      );
    });

    it("reports a missing eval with the path it looked for and the fix", async () => {
      const expected =
        "Eval not found: eval:missing. Veryfront looks for it in evals/missing.eval.ts (or a .tsx, .js or .jsx file at that path), exported with evalAgent, evalTool or evalDataset. Ensure the file is in the source this run uses, or use the ID that the evals list shows.";
      await assertRejects(
        () =>
          resolveLocal(
            { "/project/evals/other.eval.ts": "" },
            "eval:missing",
            async () => ({ default: evalDefinition() }),
          ),
        VeryfrontError,
        expected,
      );
      const error = await rejection(resolveLocal(
        {},
        "eval:missing",
        async () => ({ default: evalDefinition() }),
      ));
      assertEquals(error.slug, "eval-not-found");
      assertEquals(error.message, expected, "no evals directory reads the same as a missing file");
    });

    it("does not blame a missing eval on another file that fails to load", async () => {
      const error = await rejection(resolveLocal(
        { "/project/evals/broken.eval.ts": "" },
        "eval:missing",
        async () => {
          throw new Error("<CAUSE>");
        },
      ));

      assertEquals(error.slug, "eval-not-found");
      assertEquals(error.message.includes("<CAUSE>"), false);
    });

    it("names the error when the evals directory cannot be read", async () => {
      const adapter = createRuntimeAdapter({ "/project/evals/by-hand.eval.ts": "" });
      adapter.fs.exists = () => Promise.reject(new Error("Permission denied: /project/evals"));

      const error = await rejection(resolveEvalById("eval:by-hand", {
        projectDir: "/project",
        adapter,
        moduleLoader: async () => ({ default: evalDefinition() }),
      }));

      assertEquals(error.slug, "eval-load-failed");
      assertEquals(
        error.message,
        "Eval eval:by-hand could not be loaded because the evals directory could not be read: Permission denied: evals. Fix the cause, then run the eval again.",
        "a directory failure is not reported as a missing eval",
      );
    });

    it("names the error when the evals directory cannot be listed", async () => {
      const adapter = createRuntimeAdapter({ "/project/evals/by-hand.eval.ts": "" });
      adapter.fs.readDir = () => {
        throw new Error("Permission denied: /project/evals");
      };

      const error = await rejection(resolveEvalById("eval:by-hand", {
        projectDir: "/project",
        adapter,
        moduleLoader: async () => ({ default: evalDefinition() }),
      }));

      assertEquals(error.slug, "eval-load-failed");
      assertEquals(
        error.message,
        "Eval eval:by-hand could not be loaded because the evals directory could not be read: Permission denied: evals. Fix the cause, then run the eval again.",
        "a listing failure is not reported as a missing eval",
      );
    });

    it("removes a native Windows project path from the load error", async () => {
      for (const projectPath of ["C:\\work\\app", "c:/work/app", "file:///C:/work/app"]) {
        const error = await rejection(resolveEvalById("eval:by-hand", {
          projectDir: "C:\\work\\app",
          adapter: createRuntimeAdapter({ "C:/work/app/evals/by-hand.eval.ts": "" }),
          moduleLoader: async () => {
            throw new Error(`Failed to read ${projectPath}\\evals\\by-hand.eval.ts: <CAUSE>`);
          },
        }));
        assertEquals(error.slug, "eval-load-failed");
        assertEquals(error.message.includes("work"), false, `${projectPath} is removed`);
      }
    });

    it("redacts machine paths outside the project from the load error", async () => {
      const error = await rejection(resolveLocal(
        { "/project/evals/by-hand.eval.ts": "" },
        "eval:by-hand",
        async () => {
          throw new Error(
            "boom at file:///tmp/vf-discovery-1/module.mjs:3 via /var/folders/x/y.ts and C:\\Temp\\z.mjs in evals/by-hand.eval.ts",
          );
        },
      ));

      assertEquals(
        error.message,
        "Eval eval:by-hand failed to load from evals/by-hand.eval.ts: boom at <absolute-path> via <absolute-path> and <absolute-path> in evals/by-hand.eval.ts. Fix the file, then run the eval again.",
      );
    });

    it("keeps findEvalById returning null for a file that does not load", async () => {
      const found = await findEvalById("eval:by-hand", {
        projectDir: "/project",
        adapter: createRuntimeAdapter({ "/project/evals/by-hand.eval.ts": "" }),
        moduleLoader: async () => {
          throw new Error("<CAUSE>");
        },
      });

      assertEquals(found, null);
    });
  });
});
