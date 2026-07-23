import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { basename, join } from "veryfront/platform/path";
import {
  buildSuggestedSlug,
  collectKnowledgeSources,
  createKnowledgeIngestResult,
  deriveKnowledgeRemotePath,
  ensureUniqueSlugs,
  formatKnowledgeUploadSource,
  ingestResolvedSources,
  isLikelyLocalPath,
  normalizeKnowledgeInputPath,
  normalizeProjectUploadPath,
  resolveKnowledgeDownloadOutputDir,
  runKnowledgeParser,
  runKnowledgeParsers,
  stripChatUploadPrefix,
} from "./command.ts";
import {
  createDownloadUploadsStub,
  createKnowledgeCommandArgs,
  createLocalSource,
  createMockClient,
  createParserSuccess,
  createUploadSource,
} from "./command.test-helpers.ts";
import type { Logger } from "#veryfront/utils";

type LoggedEvent = {
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
};

function createMemoryEventLogger(events: LoggedEvent[]): Logger {
  const logger: Logger = {
    info: (message, metadata) => events.push({ level: "info", message, metadata }),
    warn: (message, metadata) => events.push({ level: "warn", message, metadata }),
    error: (message, metadata) => events.push({ level: "error", message, metadata }),
    debug: (message, metadata) => events.push({ level: "debug", message, metadata }),
    time: async (_label, fn) => fn(),
    child: () => logger,
    component: () => logger,
  };
  return logger;
}

describe("normalizeKnowledgeInputPath", () => {
  it("normalizes safe upload paths", () => {
    assertEquals(
      normalizeKnowledgeInputPath("uploads/contracts/q1.pdf"),
      "uploads/contracts/q1.pdf",
    );
  });

  it("rejects traversal", () => {
    assertThrows(() => normalizeKnowledgeInputPath("../secret.txt"));
  });
});

describe("normalizeProjectUploadPath", () => {
  it("preserves the uploads/ prefix for upload-store API calls", () => {
    assertEquals(
      normalizeProjectUploadPath("uploads/contracts/q1.pdf"),
      "uploads/contracts/q1.pdf",
    );
    assertEquals(normalizeProjectUploadPath("uploads/"), "uploads");
  });
});

describe("formatKnowledgeUploadSource", () => {
  it("re-adds the uploads/ prefix for user-facing output", () => {
    assertEquals(formatKnowledgeUploadSource("contracts/q1.pdf"), "uploads/contracts/q1.pdf");
    assertEquals(
      formatKnowledgeUploadSource("uploads/contracts/q1.pdf"),
      "uploads/contracts/q1.pdf",
    );
  });
});

describe("isLikelyLocalPath", () => {
  it("detects workspace and relative local paths", () => {
    assertEquals(isLikelyLocalPath("/workspace/uploads/q1.pdf"), true);
    assertEquals(isLikelyLocalPath("./docs/q1.pdf"), true);
    assertEquals(isLikelyLocalPath("uploads/q1.pdf"), false);
  });
});

describe("deriveKnowledgeRemotePath", () => {
  it("maps generated markdown into the knowledge folder", () => {
    assertEquals(
      deriveKnowledgeRemotePath(
        "/workspace/knowledge/q1-report.md",
        "/workspace/knowledge",
        "knowledge",
      ),
      "knowledge/q1-report.md",
    );
  });
});

describe("resolveKnowledgeDownloadOutputDir", () => {
  it("keeps staged uploads inside the ingest output root", () => {
    const outputDir = join("/tmp", "veryfront-knowledge-run");

    assertEquals(resolveKnowledgeDownloadOutputDir(outputDir), join(outputDir, ".uploads"));
  });
});

describe("createKnowledgeIngestResult", () => {
  it("builds a compact result summary", () => {
    const result = createKnowledgeIngestResult({
      source: "uploads/contracts/q1.pdf",
      localSourcePath: "/workspace/uploads/q1.pdf",
      outputPath: "/workspace/knowledge/q1.md",
      remotePath: "knowledge/q1.md",
      parser: {
        slug: "q1",
        warnings: [],
        stats: { pages: 4 },
        source_type: "pdf",
        summary: "Extracted 4 page(s).",
      },
    });

    assertEquals(result.remotePath, "knowledge/q1.md");
    assertEquals(result.slug, "q1");
    assertEquals(result.stats.pages, 4);
  });
});

describe("collectKnowledgeSources", () => {
  it("returns a single local file source", async () => {
    const tempDir = await Deno.makeTempDir();
    const localPath = `${tempDir}/q1.pdf`;
    await Deno.writeTextFile(localPath, "stub");

    try {
      const collection = await collectKnowledgeSources(
        {
          sources: [localPath],
          path: undefined,
          all: false,
          recursive: false,
        },
        {
          client: createMockClient(),
          projectSlug: "my-project",
          downloadUploads: async () => {
            throw new Error("should not download local files");
          },
        },
      );

      assertEquals(collection, {
        sources: [{ kind: "local", input: localPath, localPath }],
        skipped: [],
      });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("downloads upload-path sources into the workspace", async () => {
    const calls: string[] = [];
    const collection = await collectKnowledgeSources(
      {
        sources: ["uploads/contracts/q1.pdf"],
        path: undefined,
        all: false,
        recursive: false,
      },
      {
        client: createMockClient(),
        projectSlug: "my-project",
        downloadUploads: async (uploadPaths) => {
          calls.push(...uploadPaths);
          return [{
            uploadPath: "uploads/contracts/q1.pdf",
            localPath: "/workspace/uploads/contracts/q1.pdf",
          }];
        },
      },
    );

    assertEquals(calls, ["uploads/contracts/q1.pdf"]);
    assertEquals(collection, {
      sources: [
        {
          kind: "upload",
          input: "uploads/contracts/q1.pdf",
          uploadPath: "uploads/contracts/q1.pdf",
          localPath: "/workspace/uploads/contracts/q1.pdf",
        },
      ],
      skipped: [],
    });
  });

  it("treats uploads/ paths as remote upload references", async () => {
    const shadowDir = join("uploads", `veryfront-knowledge-shadow-${crypto.randomUUID()}`);
    const shadowPath = join(shadowDir, "q1.pdf");
    const remotePath = shadowPath.replaceAll("\\", "/");
    const downloadedPath = `/workspace/${remotePath}`;
    const hadUploadsDir = await Deno.stat("uploads").then((stat) => stat.isDirectory).catch(() =>
      false
    );
    const calls: string[] = [];

    try {
      await Deno.mkdir(shadowDir, { recursive: true });
      await Deno.writeTextFile(shadowPath, "local shadow");

      const collection = await collectKnowledgeSources(
        {
          sources: [remotePath],
          path: undefined,
          all: false,
          recursive: false,
        },
        {
          client: createMockClient(),
          projectSlug: "my-project",
          downloadUploads: async (uploadPaths) => {
            calls.push(...uploadPaths);
            return [{
              uploadPath: remotePath,
              localPath: downloadedPath,
            }];
          },
        },
      );

      assertEquals(calls, [remotePath]);
      assertEquals(collection.sources[0]?.kind, "upload");
      assertEquals(
        collection.sources[0]?.localPath,
        downloadedPath,
      );
      assertEquals(collection.skipped, []);
    } finally {
      await Deno.remove(shadowPath).catch(() => undefined);
      await Deno.remove(shadowDir).catch(() => undefined);
      if (!hadUploadsDir) {
        await Deno.remove("uploads").catch(() => undefined);
      }
    }
  });

  it("lists and downloads prefixed uploads when using --path --all", async () => {
    const listCalls: Array<{ path: string; params?: Record<string, string> }> = [];
    const downloadCalls: string[][] = [];
    const client = createMockClient({
      get: (path, params) => {
        listCalls.push({ path, params });
        return Promise.resolve({
          data: [{ path: "uploads/a.pdf" }, { path: "uploads/b.pdf" }],
          page_info: { next: null },
        });
      },
    });

    const collection = await collectKnowledgeSources(
      {
        sources: [],
        path: "uploads/",
        all: true,
        recursive: true,
      },
      {
        client,
        projectSlug: "my-project",
        downloadUploads: createDownloadUploadsStub(downloadCalls),
      },
    );

    assertEquals(listCalls.length, 1);
    assertEquals(listCalls[0]?.params?.path, "uploads");
    assertEquals(downloadCalls, [["uploads/a.pdf", "uploads/b.pdf"]]);
    assertEquals(collection.sources.length, 2);
    assert(collection.sources.every((source) => source.kind === "upload"));
    assertEquals(collection.skipped, []);
  });

  it("retries folder-like upload prefixes with a trailing slash", async () => {
    const listCalls: Array<{ path: string; params?: Record<string, string> }> = [];
    const downloadCalls: string[][] = [];
    const client = createMockClient({
      get: (_path, params) => {
        listCalls.push({ path: _path, params });
        if (params?.path === "uploads/contracts") {
          return Promise.resolve({
            data: [{ type: "folder", path: "uploads/contracts/" }],
            page_info: { next: null },
          });
        }
        return Promise.resolve({
          data: [{ type: "file", path: "uploads/contracts/q1.pdf" }],
          page_info: { next: null },
        });
      },
    });

    const collection = await collectKnowledgeSources(
      {
        sources: [],
        path: "uploads/contracts",
        all: true,
        recursive: false,
      },
      {
        client,
        projectSlug: "my-project",
        downloadUploads: async (uploadPaths) => {
          downloadCalls.push(uploadPaths);
          return uploadPaths.map((uploadPath) => ({
            uploadPath,
            localPath: `/workspace/${uploadPath}`,
          }));
        },
      },
    );

    assertEquals(listCalls.length, 2);
    assertEquals(listCalls[0]?.params?.path, "uploads/contracts");
    assertEquals(listCalls[1]?.params?.path, "uploads/contracts/");
    assertEquals(listCalls[1]?.params?.recursive, "false");
    assertEquals(downloadCalls, [["uploads/contracts/q1.pdf"]]);
    assertEquals(collection.sources.length, 1);
    assertEquals(collection.sources[0]?.kind, "upload");
    assertEquals(collection.skipped, []);
  });

  it("resolves multiple explicit sources in input order", async () => {
    const downloadCalls: string[][] = [];
    const collection = await collectKnowledgeSources(
      {
        sources: [
          "uploads/contracts/a.pdf",
          "uploads/contracts/b.pdf",
          "uploads/contracts/c.pdf",
        ],
        path: undefined,
        all: false,
        recursive: false,
      },
      {
        client: createMockClient(),
        projectSlug: "my-project",
        downloadUploads: async (uploadPaths) => {
          downloadCalls.push(uploadPaths);
          return uploadPaths.map((uploadPath) => ({
            uploadPath,
            localPath: `/workspace/${uploadPath}`,
          }));
        },
      },
    );

    assertEquals(downloadCalls, [[
      "uploads/contracts/a.pdf",
      "uploads/contracts/b.pdf",
      "uploads/contracts/c.pdf",
    ]]);
    assertEquals(
      collection.sources.map((source) =>
        source.kind === "upload" ? source.uploadPath : source.localPath
      ),
      ["uploads/contracts/a.pdf", "uploads/contracts/b.pdf", "uploads/contracts/c.pdf"],
    );
    assertEquals(collection.skipped, []);
  });

  it("batches explicit upload downloads while preserving mixed-source order", async () => {
    const tempDir = await Deno.makeTempDir();
    const localPath = `${tempDir}/notes.txt`;
    await Deno.writeTextFile(localPath, "stub");

    try {
      const downloadCalls: string[][] = [];
      const collection = await collectKnowledgeSources(
        {
          sources: ["uploads/contracts/a.pdf", localPath, "uploads/contracts/b.pdf"],
          path: undefined,
          all: false,
          recursive: false,
        },
        {
          client: createMockClient(),
          projectSlug: "my-project",
          downloadUploads: async (uploadPaths) => {
            downloadCalls.push(uploadPaths);
            return [
              {
                uploadPath: "uploads/contracts/b.pdf",
                localPath: "/workspace/uploads/contracts/b.pdf",
              },
              {
                uploadPath: "uploads/contracts/a.pdf",
                localPath: "/workspace/uploads/contracts/a.pdf",
              },
            ];
          },
        },
      );

      assertEquals(downloadCalls, [["uploads/contracts/a.pdf", "uploads/contracts/b.pdf"]]);
      assertEquals(collection, {
        sources: [
          {
            kind: "upload",
            input: "uploads/contracts/a.pdf",
            uploadPath: "uploads/contracts/a.pdf",
            localPath: "/workspace/uploads/contracts/a.pdf",
          },
          {
            kind: "local",
            input: localPath,
            localPath,
          },
          {
            kind: "upload",
            input: "uploads/contracts/b.pdf",
            uploadPath: "uploads/contracts/b.pdf",
            localPath: "/workspace/uploads/contracts/b.pdf",
          },
        ],
        skipped: [],
      });
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("skips hidden, ignored, and unsupported upload sources while keeping ingestable files", async () => {
    const downloadCalls: string[][] = [];
    const collection = await collectKnowledgeSources(
      {
        sources: [
          "uploads/contracts/spec.pdf",
          "uploads/.env",
          "uploads/node_modules/react/index.js",
          "uploads/tools/run_benchmark.py",
          "uploads/assets/archive.zip",
        ],
        path: undefined,
        all: false,
        recursive: false,
      },
      {
        client: createMockClient(),
        projectSlug: "my-project",
        downloadUploads: async (uploadPaths) => {
          downloadCalls.push(uploadPaths);
          return uploadPaths.map((uploadPath) => ({
            uploadPath,
            localPath: `/workspace/${uploadPath}`,
          }));
        },
      },
    );

    assertEquals(downloadCalls, [["uploads/contracts/spec.pdf", "uploads/tools/run_benchmark.py"]]);
    assertEquals(
      collection.sources.map((source) =>
        source.kind === "upload" ? source.uploadPath : source.localPath
      ),
      ["uploads/contracts/spec.pdf", "uploads/tools/run_benchmark.py"],
    );
    assertEquals(collection.skipped, [
      {
        source: "uploads/.env",
        localSourcePath: null,
        reason: "hidden_path",
        message: "Hidden file or directory skipped: .env",
      },
      {
        source: "uploads/node_modules/react/index.js",
        localSourcePath: null,
        reason: "ignored_directory",
        message: "Ignored directory skipped: node_modules",
      },
      {
        source: "uploads/assets/archive.zip",
        localSourcePath: null,
        reason: "unsupported_file_type",
        message: "Unsupported file type: .zip",
      },
    ]);
  });

  it("rejects directory-style upload references in explicit source mode", async () => {
    await assertRejects(
      () =>
        collectKnowledgeSources(
          {
            sources: ["uploads/"],
            path: undefined,
            all: false,
            recursive: false,
          },
          {
            client: createMockClient(),
            projectSlug: "my-project",
            downloadUploads: async () => {
              throw new Error("should not download directory-like upload references");
            },
          },
        ),
      Error,
      "Directory upload references require --path <prefix> --all: uploads/",
    );
  });

  it("skips hidden paths and ignored directories when walking local folders but keeps text/code files", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "veryfront-knowledge-local-walk-" });
    const docsDir = join(tempDir, "docs");

    try {
      await Deno.mkdir(join(docsDir, "node_modules", "react"), { recursive: true });
      await Deno.mkdir(join(docsDir, ".cache"), { recursive: true });
      await Deno.writeTextFile(join(docsDir, "guide.md"), "# Guide");
      await Deno.writeTextFile(join(docsDir, "run_benchmark.py"), "print('ok')");
      await Deno.writeTextFile(join(docsDir, ".env"), "SECRET=1");
      await Deno.writeTextFile(join(docsDir, ".cache", "state.json"), "{}");
      await Deno.writeTextFile(join(docsDir, "node_modules", "react", "index.js"), "export {}");

      const collection = await collectKnowledgeSources(
        {
          sources: [docsDir],
          path: undefined,
          all: false,
          recursive: true,
        },
        {
          client: createMockClient(),
          projectSlug: "my-project",
          downloadUploads: async () => {
            throw new Error("should not download local files");
          },
        },
      );

      assertEquals(
        collection.sources.map((source) => source.localPath).sort(),
        [join(docsDir, "guide.md"), join(docsDir, "run_benchmark.py")].sort(),
      );
      assertEquals(collection.skipped, [
        {
          source: join(docsDir, ".cache"),
          localSourcePath: null,
          reason: "hidden_path",
          message: "Hidden file or directory skipped: .cache",
        },
        {
          source: join(docsDir, ".env"),
          localSourcePath: join(docsDir, ".env"),
          reason: "hidden_path",
          message: "Hidden file or directory skipped: .env",
        },
        {
          source: join(docsDir, "node_modules"),
          localSourcePath: null,
          reason: "ignored_directory",
          message: "Ignored directory skipped: node_modules",
        },
      ]);
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("skips unsupported files when listing uploads by prefix instead of failing", async () => {
    const client = createMockClient({
      get: () =>
        Promise.resolve({
          data: [
            { type: "file", path: "uploads/docs/guide.md" },
            { type: "file", path: "uploads/docs/.env" },
            { type: "file", path: "uploads/docs/node_modules/react/index.js" },
            { type: "file", path: "uploads/docs/archive.zip" },
            { type: "file", path: "uploads/docs/run_benchmark.py" },
          ],
          page_info: { next: null },
        }),
    });
    const downloadCalls: string[][] = [];

    const collection = await collectKnowledgeSources(
      {
        sources: [],
        path: "uploads/docs",
        all: true,
        recursive: true,
      },
      {
        client,
        projectSlug: "my-project",
        downloadUploads: async (uploadPaths) => {
          downloadCalls.push(uploadPaths);
          return uploadPaths.map((uploadPath) => ({
            uploadPath,
            localPath: `/workspace/${uploadPath}`,
          }));
        },
      },
    );

    assertEquals(downloadCalls, [["uploads/docs/guide.md", "uploads/docs/run_benchmark.py"]]);
    assertEquals(
      collection.sources.map((source) =>
        source.kind === "upload" ? source.uploadPath : source.localPath
      ),
      ["uploads/docs/guide.md", "uploads/docs/run_benchmark.py"],
    );
    assertEquals(collection.skipped.length, 3);
  });
});

describe("ingestResolvedSources", () => {
  it("runs the parser and uploads knowledge markdown", async () => {
    const results = await ingestResolvedSources(
      [createUploadSource("uploads/contracts/q1.pdf")],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async () => createParserSuccess(),
        uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
      },
    );

    assertEquals(results, {
      ingested: [{
        source: "uploads/contracts/q1.pdf",
        localSourcePath: "/workspace/uploads/contracts/q1.pdf",
        outputPath: "/workspace/knowledge/contracts-q1.md",
        remotePath: "knowledge/contracts-q1.md",
        slug: "contracts-q1",
        sourceType: "pdf",
        summary: "Extracted 4 page(s).",
        stats: { pages: 4 },
        warnings: [],
      }],
      failed: [],
    });
  });

  it("logs real page and slide extraction progress emitted by the parser", async () => {
    const events: LoggedEvent[] = [];

    await ingestResolvedSources(
      [
        createUploadSource("uploads/manuals/bosch.pdf"),
        createUploadSource("uploads/decks/roadmap.pptx"),
      ],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async (input, deps) => {
          if (input.filePath.endsWith(".pdf")) {
            deps?.onProgress?.({ unit: "page", current: 1, total: 2, characters: 100 });
            deps?.onProgress?.({ unit: "page", current: 2, total: 2, characters: 120 });
            return createParserSuccess({
              source_path: input.filePath,
              source_filename: "bosch.pdf",
              source_type: "pdf",
              slug: input.slug ?? "bosch",
              sandbox_output_path: "/workspace/knowledge/manuals-bosch.md",
              suggested_project_path: "knowledge/manuals-bosch.md",
              summary: "Extracted PDF text with Kreuzberg.",
              stats: { engine: "kreuzberg", characters: 220 },
            });
          }

          deps?.onProgress?.({ unit: "slide", current: 1, total: 1, characters: 80 });
          return createParserSuccess({
            source_path: input.filePath,
            source_filename: "roadmap.pptx",
            source_type: "pptx",
            slug: input.slug ?? "roadmap",
            sandbox_output_path: "/workspace/knowledge/decks-roadmap.md",
            suggested_project_path: "knowledge/decks-roadmap.md",
            summary: "Extracted PPTX text with Kreuzberg.",
            stats: { engine: "kreuzberg", characters: 80 },
          });
        },
        uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
        eventLogger: createMemoryEventLogger(events),
      },
    );

    const progressEvents = events
      .filter((event) => event.message === "Knowledge source extraction progress")
      .map((event) => event.metadata);

    assertEquals(progressEvents, [
      {
        phase: "pdf_page_completed",
        progress_unit: "page",
        progress_current: 1,
        progress_total: 2,
        page_current: 1,
        page_total: 2,
        characters: 100,
        source_name: "bosch.pdf",
      },
      {
        phase: "pdf_page_completed",
        progress_unit: "page",
        progress_current: 2,
        progress_total: 2,
        page_current: 2,
        page_total: 2,
        characters: 120,
        source_name: "bosch.pdf",
      },
      {
        phase: "ppt_slide_completed",
        progress_unit: "slide",
        progress_current: 1,
        progress_total: 1,
        slide_current: 1,
        slide_total: 1,
        characters: 80,
        source_name: "roadmap.pptx",
      },
    ]);
  });

  it("does not request extraction progress when no event logger can report it", async () => {
    let hasProgressCallback = true;

    await ingestResolvedSources(
      [createUploadSource("uploads/manuals/bosch.pdf")],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async (_input, deps) => {
          hasProgressCallback = typeof deps?.onProgress === "function";
          return createParserSuccess();
        },
        uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
      },
    );

    assertEquals(hasProgressCallback, false);
  });

  it("uses basename-only slugs for absolute local paths outside /workspace", async () => {
    let parserSlug: string | undefined;

    await ingestResolvedSources(
      [createLocalSource("/var/folders/random/report.pdf")],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async (input) => {
          parserSlug = input.slug;
          return {
            success: true,
            source_path: "/var/folders/random/report.pdf",
            source_filename: "report.pdf",
            source_type: "pdf",
            slug: input.slug ?? "report",
            sandbox_output_path: "/workspace/knowledge/report.md",
            suggested_project_path: "knowledge/report.md",
            description: "Parsed from report.pdf",
            title: "Report",
            summary: "Extracted 1 page(s).",
            stats: { pages: 1 },
            warnings: [],
          };
        },
        uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
      },
    );

    assertEquals(parserSlug, "report");
  });

  it("uses each local file path as the source reference for walked directories", async () => {
    const results = await ingestResolvedSources(
      [createLocalSource("/workspace/contracts", "/workspace/contracts/run_benchmark.py")],
      createKnowledgeCommandArgs({ sources: ["/workspace/contracts"], recursive: true }),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async () =>
          createParserSuccess({
            source_path: "/workspace/contracts/run_benchmark.py",
            source_filename: "run_benchmark.py",
            source_type: "txt",
            slug: "contracts-run-benchmark",
            sandbox_output_path: "/workspace/knowledge/run-benchmark.md",
            suggested_project_path: "knowledge/run-benchmark.md",
            description: "Parsed from run_benchmark.py",
            title: "Run Benchmark",
            summary: "Parsed as text.",
            stats: { lines: 1 },
          }),
        uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
      },
    );

    assertEquals(results.ingested, [{
      source: "/workspace/contracts/run_benchmark.py",
      localSourcePath: "/workspace/contracts/run_benchmark.py",
      outputPath: "/workspace/knowledge/run-benchmark.md",
      remotePath: "knowledge/run-benchmark.md",
      slug: "contracts-run-benchmark",
      sourceType: "txt",
      summary: "Parsed as text.",
      stats: { lines: 1 },
      warnings: [],
    }]);
  });

  it("records parser failures and continues processing later sources", async () => {
    const calls: string[] = [];

    const results = await ingestResolvedSources(
      [
        {
          kind: "local",
          input: "/workspace/contracts/broken.pdf",
          localPath: "/workspace/contracts/broken.pdf",
        },
        {
          kind: "local",
          input: "/workspace/contracts/run_benchmark.py",
          localPath: "/workspace/contracts/run_benchmark.py",
        },
      ],
      {
        sources: ["/workspace/contracts"],
        path: undefined,
        all: false,
        recursive: false,
        outputDir: "/workspace/knowledge",
        knowledgePath: "knowledge",
        description: undefined,
        slug: undefined,
        json: true,
        quiet: false,
        projectDir: undefined,
        projectSlug: undefined,
      },
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async (input) => {
          calls.push(input.filePath);
          if (input.filePath.endsWith("broken.pdf")) {
            throw new Error("knowledge ingest parser failed: boom");
          }
          return {
            success: true,
            source_path: input.filePath,
            source_filename: "run_benchmark.py",
            source_type: "txt",
            slug: input.slug ?? "run-benchmark",
            sandbox_output_path: "/workspace/knowledge/run-benchmark.md",
            suggested_project_path: "knowledge/run-benchmark.md",
            description: "Parsed from run_benchmark.py",
            title: "Run Benchmark",
            summary: "Parsed as text.",
            stats: { lines: 1 },
            warnings: [],
          };
        },
        uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
      },
    );

    assertEquals(calls, [
      "/workspace/contracts/broken.pdf",
      "/workspace/contracts/run_benchmark.py",
    ]);
    assertEquals(results.ingested, [{
      source: "/workspace/contracts/run_benchmark.py",
      localSourcePath: "/workspace/contracts/run_benchmark.py",
      outputPath: "/workspace/knowledge/run-benchmark.md",
      remotePath: "knowledge/run-benchmark.md",
      slug: "contracts-run-benchmark",
      sourceType: "txt",
      summary: "Parsed as text.",
      stats: { lines: 1 },
      warnings: [],
    }]);
    assertEquals(results.failed, [{
      source: "/workspace/contracts/broken.pdf",
      localSourcePath: "/workspace/contracts/broken.pdf",
      reason: "parser_error",
      message: "knowledge ingest parser failed: boom",
    }]);
  });

  it("classifies raw parser failures as parser errors", async () => {
    const results = await ingestResolvedSources(
      [
        {
          kind: "local",
          input: "/workspace/contracts/broken.pdf",
          localPath: "/workspace/contracts/broken.pdf",
        },
      ],
      {
        sources: ["/workspace/contracts/broken.pdf"],
        path: undefined,
        all: false,
        recursive: false,
        outputDir: "/workspace/knowledge",
        knowledgePath: "knowledge",
        description: undefined,
        slug: undefined,
        json: true,
        quiet: false,
        projectDir: undefined,
        projectSlug: undefined,
      },
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async () => {
          throw new Error("Unsupported file type: .bin");
        },
        uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
      },
    );

    assertEquals(results.failed, [{
      source: "/workspace/contracts/broken.pdf",
      localSourcePath: "/workspace/contracts/broken.pdf",
      reason: "parser_error",
      message: "Unsupported file type: .bin",
    }]);
  });

  it("rejects a custom slug when more than one resolved source would be written", async () => {
    await assertRejects(
      () =>
        ingestResolvedSources(
          [
            {
              kind: "local",
              input: "./contracts/a.pdf",
              localPath: "/workspace/contracts/a.pdf",
            },
            {
              kind: "local",
              input: "./contracts/b.pdf",
              localPath: "/workspace/contracts/b.pdf",
            },
          ],
          {
            sources: ["./contracts"],
            path: undefined,
            all: false,
            recursive: false,
            outputDir: "/workspace/knowledge",
            knowledgePath: "knowledge",
            description: undefined,
            slug: "contracts-batch",
            json: true,
            quiet: false,
            projectDir: undefined,
            projectSlug: undefined,
          },
          {
            client: createMockClient(),
            projectSlug: "my-project",
            outputDir: "/workspace/knowledge",
            runParser: async () => {
              throw new Error("runParser should not be called");
            },
            uploadKnowledgeFile: async () => {
              throw new Error("uploadKnowledgeFile should not be called");
            },
          },
        ),
      Error,
      "--slug can only be used with a single explicit source.",
    );
  });
});

describe("stripChatUploadPrefix", () => {
  it("strips a Studio chat-upload prefix from a filename", () => {
    assertEquals(
      stripChatUploadPrefix(
        "chat-909d3dbc-5a9a-4156-97e4-bcceb5c2ec0d-1773942180291-fv1qg5-agents",
      ),
      "agents",
    );
  });

  it("returns the original string when no prefix is present", () => {
    assertEquals(stripChatUploadPrefix("agents"), "agents");
    assertEquals(stripChatUploadPrefix("my-report"), "my-report");
  });

  it("handles uppercase hex in UUIDs", () => {
    assertEquals(
      stripChatUploadPrefix(
        "chat-909D3DBC-5A9A-4156-97E4-BCCEB5C2EC0D-1773942180291-fv1qg5-report",
      ),
      "report",
    );
  });

  it("preserves filenames that start with chat- but lack the full prefix", () => {
    assertEquals(stripChatUploadPrefix("chat-summary"), "chat-summary");
  });
});

describe("buildSuggestedSlug", () => {
  it("uses the original filename for uploads with a chat prefix", () => {
    const slug = buildSuggestedSlug(
      {
        kind: "upload",
        input: "uploads/chat-909d3dbc-5a9a-4156-97e4-bcceb5c2ec0d-1773942180291-fv1qg5-agents.md",
        uploadPath:
          "uploads/chat-909d3dbc-5a9a-4156-97e4-bcceb5c2ec0d-1773942180291-fv1qg5-agents.md",
        localPath:
          "/workspace/uploads/chat-909d3dbc-5a9a-4156-97e4-bcceb5c2ec0d-1773942180291-fv1qg5-agents.md",
      },
      0,
    );
    assertEquals(slug, "agents");
  });

  it("preserves clean upload filenames without a chat prefix", () => {
    const slug = buildSuggestedSlug(
      {
        kind: "upload",
        input: "uploads/contracts/q1.pdf",
        uploadPath: "uploads/contracts/q1.pdf",
        localPath: "/workspace/uploads/contracts/q1.pdf",
      },
      0,
    );
    assertEquals(slug, "contracts-q1");
  });

  it("strips the chat prefix from nested upload paths", () => {
    const slug = buildSuggestedSlug(
      {
        kind: "upload",
        input:
          "uploads/docs/chat-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-1700000000000-abc12-readme.txt",
        uploadPath:
          "uploads/docs/chat-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-1700000000000-abc12-readme.txt",
        localPath:
          "/workspace/uploads/docs/chat-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-1700000000000-abc12-readme.txt",
      },
      0,
    );
    assertEquals(slug, "docs-readme");
  });

  it("uses basename only for absolute local paths outside /workspace", () => {
    const slug = buildSuggestedSlug(
      {
        kind: "local",
        input: "/var/folders/random/AGENTS.md",
        localPath: "/var/folders/random/AGENTS.md",
      },
      0,
    );
    assertEquals(slug, "agents");
  });
});

describe("ensureUniqueSlugs", () => {
  it("appends a numeric suffix for duplicate slugs", () => {
    const slugs = ensureUniqueSlugs([
      {
        kind: "upload",
        input: "uploads/chat-909d3dbc-5a9a-4156-97e4-bcceb5c2ec0d-1773942180291-fv1qg5-agents.md",
        uploadPath: "chat-909d3dbc-5a9a-4156-97e4-bcceb5c2ec0d-1773942180291-fv1qg5-agents.md",
        localPath:
          "/workspace/uploads/chat-909d3dbc-5a9a-4156-97e4-bcceb5c2ec0d-1773942180291-fv1qg5-agents.md",
      },
      {
        kind: "upload",
        input: "uploads/chat-11111111-2222-3333-4444-555555555555-1700000000000-xyz99-agents.md",
        uploadPath: "chat-11111111-2222-3333-4444-555555555555-1700000000000-xyz99-agents.md",
        localPath:
          "/workspace/uploads/chat-11111111-2222-3333-4444-555555555555-1700000000000-xyz99-agents.md",
      },
    ]);
    assertEquals(slugs, ["agents", "agents-2"]);
  });
});

describe("runKnowledgeParser", () => {
  it("writes knowledge markdown for plain-text documents without spawning python", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "veryfront-knowledge-parser-test-" });
    const filePath = join(tempDir, "q1-report.txt");
    const outputDir = join(tempDir, "knowledge-output");

    try {
      await Deno.writeTextFile(filePath, "Quarterly revenue increased 12% year over year.");

      const result = await runKnowledgeParser({
        filePath,
        outputDir,
        description: "Quarterly performance summary",
        slug: "q1-report",
        sourceReference: "uploads/contracts/q1-report.txt",
      });

      assertEquals(result.slug, "q1-report");
      assertEquals(result.source_type, "txt");
      assertEquals(result.sandbox_output_path, join(outputDir, "q1-report.md"));

      const markdown = await Deno.readTextFile(result.sandbox_output_path);
      assertStringIncludes(markdown, 'source: "uploads/contracts/q1-report.txt"');
      assertStringIncludes(markdown, 'description: "Quarterly performance summary"');
      assertStringIncludes(markdown, "# Q1 Report");
      assertStringIncludes(markdown, "Quarterly revenue increased 12% year over year.");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("delegates PDF extraction to the Kreuzberg document extractor contract", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "veryfront-knowledge-parser-kreuzberg-" });
    const filePath = join(tempDir, "offer.pdf");
    const outputDir = join(tempDir, "knowledge-output");
    const extractorCalls: Array<{
      filePath: string;
      mimeType: string;
      hasProgressCallback: boolean;
    }> = [];

    try {
      await Deno.writeTextFile(filePath, "stub pdf bytes");

      const result = await runKnowledgeParser(
        {
          filePath,
          outputDir,
          description: "Offer PDF",
          slug: "offer-pdf",
          sourceReference: "uploads/offers/offer.pdf",
        },
        {
          extractDocumentText: (input) => {
            extractorCalls.push({
              filePath: input.filePath,
              mimeType: input.mimeType,
              hasProgressCallback: typeof input.onProgress === "function",
            });
            return Promise.resolve("Kreuzberg PDF text");
          },
        },
      );

      assertEquals(result.source_type, "pdf");
      assertEquals(result.slug, "offer-pdf");
      assertEquals(result.stats.engine, "kreuzberg");
      assertStringIncludes(result.summary, "Extracted PDF text with Kreuzberg");
      assertEquals(extractorCalls, [{
        filePath,
        mimeType: "application/pdf",
        hasProgressCallback: false,
      }]);

      const markdown = await Deno.readTextFile(result.sandbox_output_path);
      assertStringIncludes(markdown, 'source: "uploads/offers/offer.pdf"');
      assertStringIncludes(markdown, 'description: "Offer PDF"');
      assertStringIncludes(markdown, "# Offer");
      assertStringIncludes(markdown, "Kreuzberg PDF text");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("preserves markdown returned by rich document extraction without inferring headings", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "veryfront-knowledge-parser-headings-" });
    const filePath = join(tempDir, "manual.pdf");
    const outputDir = join(tempDir, "knowledge-output");

    try {
      await Deno.writeTextFile(filePath, "stub pdf bytes");

      const result = await runKnowledgeParser(
        {
          filePath,
          outputDir,
          slug: "manual",
          sourceReference: "uploads/manuals/manual.pdf",
        },
        {
          extractDocumentText: () =>
            Promise.resolve([
              "## Extracted Markdown Heading",
              "Extractor body text.",
              "1\u2002Sicherheit",
              "1.1\u2002Allgemeine Hinweise",
            ].join("\n")),
        },
      );

      const markdown = await Deno.readTextFile(result.sandbox_output_path);
      assertStringIncludes(markdown, "\n## Extracted Markdown Heading\n");
      assertStringIncludes(markdown, "\nExtractor body text.\n");
      assertStringIncludes(markdown, "\n1\u2002Sicherheit\n");
      assertStringIncludes(markdown, "\n1.1\u2002Allgemeine Hinweise\n");
      assertEquals(markdown.includes("\n## 1\u2002Sicherheit\n"), false);
      assertEquals(markdown.includes("\n### 1.1\u2002Allgemeine Hinweise\n"), false);
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("forwards real extraction progress without changing the single markdown output contract", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "veryfront-knowledge-parser-progress-" });
    const filePath = join(tempDir, "manual.pdf");
    const outputDir = join(tempDir, "knowledge-output");
    const progressEvents: Array<Record<string, unknown>> = [];

    try {
      await Deno.writeTextFile(filePath, "stub pdf bytes");

      const result = await runKnowledgeParser(
        {
          filePath,
          outputDir,
          slug: "manual",
          sourceReference: "uploads/manual.pdf",
        },
        {
          onProgress: (event) => {
            progressEvents.push(event);
          },
          extractDocumentText: (input) => {
            input.onProgress?.({ unit: "page", current: 1, total: 2, characters: 11 });
            input.onProgress?.({ unit: "page", current: 2, total: 2, characters: 13 });
            return Promise.resolve("Page one text\n\nPage two text");
          },
        },
      );

      assertEquals(progressEvents, [
        { unit: "page", current: 1, total: 2, characters: 11 },
        { unit: "page", current: 2, total: 2, characters: 13 },
      ]);
      assertEquals(result.sandbox_output_path, join(outputDir, "manual.md"));

      const outputFiles: string[] = [];
      for await (const entry of Deno.readDir(outputDir)) {
        if (entry.isFile) outputFiles.push(entry.name);
      }
      assertEquals(outputFiles.sort(), ["manual.md"]);

      const markdown = await Deno.readTextFile(result.sandbox_output_path);
      assertStringIncludes(markdown, "# Manual");
      assertStringIncludes(markdown, "Page one text");
      assertStringIncludes(markdown, "Page two text");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });
});

describe("runKnowledgeParsers", () => {
  it("uses Kreuzberg for multiple supported rich documents", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "veryfront-knowledge-parser-batch-" });
    const fileA = join(tempDir, "offer.pdf");
    const fileB = join(tempDir, "notes.docx");
    const fileC = join(tempDir, "slides.pptx");
    const outputDir = join(tempDir, "knowledge-output");
    const extractorCalls: Array<{
      filePath: string;
      mimeType: string;
      hasProgressCallback: boolean;
    }> = [];

    try {
      await Deno.writeTextFile(fileA, "stub pdf bytes");
      await Deno.writeTextFile(fileB, "stub docx bytes");
      await Deno.writeTextFile(fileC, "stub pptx bytes");

      const results = await runKnowledgeParsers(
        {
          files: [
            {
              filePath: fileA,
              description: "Batch docs",
              slug: "offer-pdf",
              sourceReference: "uploads/offers/offer.pdf",
            },
            {
              filePath: fileB,
              description: "Batch docs",
              slug: "notes-docx",
              sourceReference: "uploads/offers/notes.docx",
            },
            {
              filePath: fileC,
              description: "Batch docs",
              slug: "slides-pptx",
              sourceReference: "uploads/offers/slides.pptx",
            },
          ],
          outputDir,
        },
        {
          extractDocumentText: (input) => {
            extractorCalls.push({
              filePath: input.filePath,
              mimeType: input.mimeType,
              hasProgressCallback: typeof input.onProgress === "function",
            });
            return Promise.resolve(`Extracted ${basename(input.filePath)}`);
          },
        },
      );

      assertEquals(results.length, 3);
      assertEquals(results.map((result) => result.source_type), ["pdf", "docx", "pptx"]);
      assert(results.every((result) => result.stats.engine === "kreuzberg"));
      assertEquals(extractorCalls, [
        { filePath: fileA, mimeType: "application/pdf", hasProgressCallback: false },
        {
          filePath: fileB,
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          hasProgressCallback: false,
        },
        {
          filePath: fileC,
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          hasProgressCallback: false,
        },
      ]);

      const firstMarkdown = await Deno.readTextFile(results[0]!.sandbox_output_path);
      const secondMarkdown = await Deno.readTextFile(results[1]!.sandbox_output_path);
      const thirdMarkdown = await Deno.readTextFile(results[2]!.sandbox_output_path);
      assertStringIncludes(firstMarkdown, "Extracted offer.pdf");
      assertStringIncludes(secondMarkdown, "Extracted notes.docx");
      assertStringIncludes(thirdMarkdown, "Extracted slides.pptx");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });
});
