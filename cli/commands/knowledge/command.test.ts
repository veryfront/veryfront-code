import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";
import {
  buildSuggestedSlug,
  collectKnowledgeSources,
  createKnowledgeIngestResult,
  deriveKnowledgeRemotePath,
  ensureUniqueSlugs,
  executeKnowledgeParserCommand,
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
import { knowledgeIngestPythonSource } from "./parser-source.ts";
import {
  createDownloadUploadsStub,
  createKnowledgeCommandArgs,
  createLocalSource,
  createMockClient,
  createParserSuccess,
  createUploadSource,
} from "./command.test-helpers.ts";

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

  it("treats uploads/ paths as remote even if a local uploads folder exists", async () => {
    const originalCwd = Deno.cwd();
    const tempDir = await Deno.makeTempDir();
    await Deno.mkdir(`${tempDir}/uploads/contracts`, { recursive: true });
    await Deno.writeTextFile(`${tempDir}/uploads/contracts/q1.pdf`, "local shadow copy");

    try {
      Deno.chdir(tempDir);
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
      assertEquals(collection.sources[0]?.kind, "upload");
      assertEquals(collection.skipped, []);
    } finally {
      Deno.chdir(originalCwd);
      await Deno.remove(tempDir, { recursive: true });
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
          throw new Error("python3 is required. Install python3 first.");
        },
        uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
      },
    );

    assertEquals(results.failed, [{
      source: "/workspace/contracts/broken.pdf",
      localSourcePath: "/workspace/contracts/broken.pdf",
      reason: "parser_error",
      message: "python3 is required. Install python3 first.",
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

describe("knowledgeIngestPythonSource", () => {
  it("avoids Python 3.10-only union type syntax", () => {
    assertEquals(knowledgeIngestPythonSource.includes(" | None"), false);
  });

  it("emits plain markdown code fences for JSON output", () => {
    assertEquals(knowledgeIngestPythonSource.includes("\`\`\`json"), false);
    assertEquals(knowledgeIngestPythonSource.includes("CODE_FENCE = chr(96) * 3"), true);
    assertStringIncludes(
      knowledgeIngestPythonSource,
      String.raw`return f"{CODE_FENCE}json\n{rendered}\n{CODE_FENCE}", stats, warnings`,
    );
  });
});

describe("executeKnowledgeParserCommand", () => {
  it("uses the cross-runtime command runner for python execution", async () => {
    const calls: Array<{
      cmd: string;
      args: string[];
      env?: Record<string, string>;
      capture: true;
    }> = [];

    await executeKnowledgeParserCommand(
      {
        scriptPath: "/tmp/ingest.py",
        inputJsonPath: "/tmp/input.json",
        outputJsonPath: "/tmp/output.json",
        env: { PYTHONPATH: "/tmp/python" },
      },
      {
        runCommandFn: async (cmd, options) => {
          calls.push({ cmd, ...options });
          return { success: true, code: 0, stdout: "", stderr: "" };
        },
      },
    );

    assertEquals(calls, [{
      cmd: "python3",
      args: [
        "/tmp/ingest.py",
        "--input-json",
        "/tmp/input.json",
        "--output-json",
        "/tmp/output.json",
      ],
      env: { PYTHONPATH: "/tmp/python" },
      capture: true,
    }]);
  });

  it("maps an empty spawn failure to the existing python3-required error", async () => {
    await assertRejects(
      () =>
        executeKnowledgeParserCommand(
          {
            scriptPath: "/tmp/ingest.py",
            inputJsonPath: "/tmp/input.json",
            outputJsonPath: "/tmp/output.json",
          },
          {
            runCommandFn: async () => ({ success: false, code: 1 }),
          },
        ),
      Error,
      "python3 is required. Install python3 and the supported parser packages, or run the command inside the Veryfront sandbox.",
    );
  });

  it("maps thrown missing-executable errors to the existing python3-required error", async () => {
    await assertRejects(
      () =>
        executeKnowledgeParserCommand(
          {
            scriptPath: "/tmp/ingest.py",
            inputJsonPath: "/tmp/input.json",
            outputJsonPath: "/tmp/output.json",
          },
          {
            runCommandFn: async () => {
              const error = new Error("spawn python3 ENOENT");
              (error as Error & { code?: string }).code = "ENOENT";
              throw error;
            },
          },
        ),
      Error,
      "python3 is required. Install python3 and the supported parser packages, or run the command inside the Veryfront sandbox.",
    );
  });
});

describe("runKnowledgeParser", () => {
  it("executes the embedded parser with python3 for plain-text documents", async () => {
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

  it("prefers docling placeholder markdown for PDF extraction when the binary is available", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "veryfront-knowledge-parser-docling-" });
    const binDir = join(tempDir, "bin");
    const filePath = join(tempDir, "offer.pdf");
    const outputDir = join(tempDir, "knowledge-output");
    const doclingPath = join(binDir, "docling");
    const argsLogPath = join(tempDir, "docling-args.log");
    const originalPath = Deno.env.get("PATH") ?? "";

    try {
      await Deno.mkdir(binDir, { recursive: true });
      await Deno.writeTextFile(filePath, "stub pdf bytes");
      await Deno.writeTextFile(
        doclingPath,
        [
          "#!/bin/sh",
          'printf "%s\\n" "$@" > "$DOCLING_ARGS_LOG"',
          'out_dir=""',
          'prev=""',
          'for arg in "$@"; do',
          '  if [ "$prev" = "--output" ]; then',
          '    out_dir="$arg"',
          "  fi",
          '  prev="$arg"',
          "done",
          'if [ -z "$out_dir" ]; then',
          '  echo "missing output dir" >&2',
          "  exit 64",
          "fi",
          'mkdir -p "$out_dir"',
          "cat <<'EOF' > \"$out_dir/offer.md\"",
          "## Fake PDF",
          "",
          "Parsed by docling",
          "EOF",
        ].join("\n"),
      );
      await Deno.chmod(doclingPath, 0o755);

      const result = await runKnowledgeParser({
        filePath,
        outputDir,
        description: "Offer PDF",
        slug: "offer-pdf",
        sourceReference: "uploads/offers/offer.pdf",
        env: {
          PATH: `${binDir}:${originalPath}`,
          DOCLING_ARGS_LOG: argsLogPath,
        },
      });

      assertEquals(result.source_type, "pdf");
      assertEquals(result.slug, "offer-pdf");
      assertEquals(result.stats.engine, "docling");
      assertStringIncludes(result.summary, "Converted PDF to markdown");

      const argsLog = await Deno.readTextFile(argsLogPath);
      assertStringIncludes(argsLog, filePath);
      assertStringIncludes(argsLog, "--to");
      assertStringIncludes(argsLog, "md");
      assertStringIncludes(argsLog, "--image-export-mode");
      assertStringIncludes(argsLog, "placeholder");
      assertStringIncludes(argsLog, "--output");

      const markdown = await Deno.readTextFile(result.sandbox_output_path);
      assertStringIncludes(markdown, 'source: "uploads/offers/offer.pdf"');
      assertStringIncludes(markdown, 'description: "Offer PDF"');
      assertStringIncludes(markdown, "# Offer");
      assertStringIncludes(markdown, "Parsed by docling");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("falls back to the built-in parser when docling extraction fails", async () => {
    const tempDir = await Deno.makeTempDir({
      prefix: "veryfront-knowledge-parser-docling-fallback-",
    });
    const binDir = join(tempDir, "bin");
    const pythonDir = join(tempDir, "python");
    const filePath = join(tempDir, "fallback.pdf");
    const outputDir = join(tempDir, "knowledge-output");
    const doclingPath = join(binDir, "docling");
    const originalPath = Deno.env.get("PATH") ?? "";

    try {
      await Deno.mkdir(binDir, { recursive: true });
      await Deno.mkdir(pythonDir, { recursive: true });
      await Deno.writeTextFile(filePath, "stub pdf bytes");
      await Deno.writeTextFile(
        doclingPath,
        [
          "#!/bin/sh",
          'echo "docling boom" >&2',
          "exit 2",
        ].join("\n"),
      );
      await Deno.writeTextFile(
        join(pythonDir, "pdfplumber.py"),
        [
          "class _Page:",
          "    def __init__(self, text):",
          "        self._text = text",
          "",
          "    def extract_text(self):",
          "        return self._text",
          "",
          "    def extract_tables(self):",
          "        return []",
          "",
          "class _Pdf:",
          "    def __init__(self, path):",
          '        self.pages = [_Page("Fallback PDF text")]',
          "",
          "    def __enter__(self):",
          "        return self",
          "",
          "    def __exit__(self, exc_type, exc, tb):",
          "        return False",
          "",
          "def open(path):",
          "    return _Pdf(path)",
        ].join("\n"),
      );
      await Deno.chmod(doclingPath, 0o755);

      const result = await runKnowledgeParser({
        filePath,
        outputDir,
        sourceReference: "uploads/offers/fallback.pdf",
        env: {
          PATH: `${binDir}:${originalPath}`,
          PYTHONPATH: pythonDir,
        },
      });

      assertEquals(result.source_type, "pdf");
      assertStringIncludes(result.summary, "Extracted 1 page");
      assertEquals(result.stats.engine, undefined);
      assertEquals(result.warnings.length, 1);
      assertStringIncludes(
        result.warnings[0] ?? "",
        "docling conversion failed; fell back to the built-in parser",
      );

      const markdown = await Deno.readTextFile(result.sandbox_output_path);
      assertStringIncludes(markdown, "# Fallback");
      assertStringIncludes(markdown, "## Page 1");
      assertStringIncludes(markdown, "Fallback PDF text");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("falls back to the built-in parser when docling times out", async () => {
    const tempDir = await Deno.makeTempDir({
      prefix: "veryfront-knowledge-parser-docling-timeout-",
    });
    const binDir = join(tempDir, "bin");
    const pythonDir = join(tempDir, "python");
    const filePath = join(tempDir, "timeout.pdf");
    const outputDir = join(tempDir, "knowledge-output");
    const doclingPath = join(binDir, "docling");
    const originalPath = Deno.env.get("PATH") ?? "";

    try {
      await Deno.mkdir(binDir, { recursive: true });
      await Deno.mkdir(pythonDir, { recursive: true });
      await Deno.writeTextFile(filePath, "stub pdf bytes");
      await Deno.writeTextFile(
        doclingPath,
        [
          "#!/bin/sh",
          "sleep 1",
          "exit 0",
        ].join("\n"),
      );
      await Deno.writeTextFile(
        join(pythonDir, "pdfplumber.py"),
        [
          "class _Page:",
          "    def __init__(self, text):",
          "        self._text = text",
          "",
          "    def extract_text(self):",
          "        return self._text",
          "",
          "    def extract_tables(self):",
          "        return []",
          "",
          "class _Pdf:",
          "    def __init__(self, path):",
          '        self.pages = [_Page("Timed out fallback PDF text")]',
          "",
          "    def __enter__(self):",
          "        return self",
          "",
          "    def __exit__(self, exc_type, exc, tb):",
          "        return False",
          "",
          "def open(path):",
          "    return _Pdf(path)",
        ].join("\n"),
      );
      await Deno.chmod(doclingPath, 0o755);

      const result = await runKnowledgeParser({
        filePath,
        outputDir,
        sourceReference: "uploads/offers/timeout.pdf",
        env: {
          PATH: `${binDir}:${originalPath}`,
          PYTHONPATH: pythonDir,
          VERYFRONT_KNOWLEDGE_DOCLING_TIMEOUT_SECONDS: "0.01",
        },
      });

      assertEquals(result.source_type, "pdf");
      assertEquals(result.stats.engine, undefined);
      assertEquals(result.warnings.length, 1);
      assertStringIncludes(
        result.warnings[0] ?? "",
        "docling conversion failed; fell back to the built-in parser: docling conversion timed out",
      );

      const markdown = await Deno.readTextFile(result.sandbox_output_path);
      assertStringIncludes(markdown, "Timed out fallback PDF text");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });
});

describe("runKnowledgeParsers", () => {
  it("uses docling for multiple supported rich documents", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "veryfront-knowledge-parser-batch-" });
    const binDir = join(tempDir, "bin");
    const fileA = join(tempDir, "offer.pdf");
    const fileB = join(tempDir, "notes.docx");
    const fileC = join(tempDir, "slides.pptx");
    const outputDir = join(tempDir, "knowledge-output");
    const doclingPath = join(binDir, "docling");
    const doclingArgsLogPath = join(tempDir, "docling-args.log");
    const originalPath = Deno.env.get("PATH") ?? "";

    try {
      await Deno.mkdir(binDir, { recursive: true });
      await Deno.writeTextFile(fileA, "stub pdf bytes");
      await Deno.writeTextFile(fileB, "stub docx bytes");
      await Deno.writeTextFile(fileC, "stub pptx bytes");
      await Deno.writeTextFile(
        doclingPath,
        [
          "#!/bin/sh",
          'printf "%s\\n" "---" "$@" >> "$DOCLING_ARGS_LOG"',
          'input="$1"',
          'name=$(basename "$input")',
          'stem="${name%.*}"',
          'out_dir=""',
          'prev=""',
          'for arg in "$@"; do',
          '  if [ "$prev" = "--output" ]; then',
          '    out_dir="$arg"',
          "  fi",
          '  prev="$arg"',
          "done",
          'if [ -z "$out_dir" ]; then',
          '  echo "missing output dir" >&2',
          "  exit 64",
          "fi",
          'mkdir -p "$out_dir"',
          'cat <<EOF > "$out_dir/$stem.md"',
          "## Fake $stem",
          "",
          "Parsed by docling $name",
          "EOF",
        ].join("\n"),
      );
      await Deno.chmod(doclingPath, 0o755);

      const results = await runKnowledgeParsers({
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
        env: {
          PATH: `${binDir}:${originalPath}`,
          DOCLING_ARGS_LOG: doclingArgsLogPath,
        },
      });

      assertEquals(results.length, 3);
      assertEquals(results.map((result) => result.source_type), ["pdf", "docx", "pptx"]);
      assert(results.every((result) => result.stats.engine === "docling"));

      const doclingArgsLog = await Deno.readTextFile(doclingArgsLogPath);
      assertStringIncludes(doclingArgsLog, fileA);
      assertStringIncludes(doclingArgsLog, fileB);
      assertStringIncludes(doclingArgsLog, fileC);
      assertStringIncludes(doclingArgsLog, "--image-export-mode");
      assertStringIncludes(doclingArgsLog, "placeholder");

      const firstMarkdown = await Deno.readTextFile(results[0]!.sandbox_output_path);
      const secondMarkdown = await Deno.readTextFile(results[1]!.sandbox_output_path);
      const thirdMarkdown = await Deno.readTextFile(results[2]!.sandbox_output_path);
      assertStringIncludes(firstMarkdown, "Parsed by docling offer.pdf");
      assertStringIncludes(secondMarkdown, "Parsed by docling notes.docx");
      assertStringIncludes(thirdMarkdown, "Parsed by docling slides.pptx");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });
});
