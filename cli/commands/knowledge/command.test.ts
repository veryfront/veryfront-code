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
  collectKnowledgeSources,
  createKnowledgeIngestResult,
  deriveKnowledgeRemotePath,
  formatKnowledgeUploadSource,
  ingestResolvedSources,
  isLikelyLocalPath,
  normalizeKnowledgeInputPath,
  normalizeProjectUploadPath,
  resolveKnowledgeDownloadOutputDir,
  runKnowledgeParser,
} from "./command.ts";
import { knowledgeIngestPythonSource } from "./parser-source.ts";
import type { ApiClient } from "#cli/shared/config";

function createMockClient(overrides: {
  get?: (path: string, params?: Record<string, string>) => Promise<unknown>;
} = {}): ApiClient {
  return {
    get: async <T>(path: string, params?: Record<string, string>): Promise<T> => {
      const result = await (overrides.get?.(path, params) ?? Promise.resolve({ data: [] }));
      return result as T;
    },
    post: <T>(): Promise<T> => Promise.resolve({} as T),
    put: <T>(): Promise<T> => Promise.resolve({} as T),
    patch: <T>(): Promise<T> => Promise.resolve({} as T),
    delete: <T>(): Promise<T> => Promise.resolve({} as T),
  };
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
  it("strips the uploads/ prefix before upload-store API calls", () => {
    assertEquals(normalizeProjectUploadPath("uploads/contracts/q1.pdf"), "contracts/q1.pdf");
    assertEquals(normalizeProjectUploadPath("uploads/"), "");
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
            uploadPath: "contracts/q1.pdf",
            localPath: "/workspace/uploads/contracts/q1.pdf",
          }];
        },
      },
    );

    assertEquals(calls, ["contracts/q1.pdf"]);
    assertEquals(collection, {
      sources: [
        {
          kind: "upload",
          input: "uploads/contracts/q1.pdf",
          uploadPath: "contracts/q1.pdf",
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
              uploadPath: "contracts/q1.pdf",
              localPath: "/workspace/uploads/contracts/q1.pdf",
            }];
          },
        },
      );

      assertEquals(calls, ["contracts/q1.pdf"]);
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
          data: [{ path: "a.pdf" }, { path: "b.pdf" }],
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
        downloadUploads: async (uploadPaths) => {
          downloadCalls.push(uploadPaths);
          return uploadPaths.map((uploadPath) => ({
            uploadPath,
            localPath: `/workspace/${uploadPath}`,
          }));
        },
      },
    );

    assertEquals(listCalls.length, 1);
    assertEquals(listCalls[0]?.params?.path, undefined);
    assertEquals(downloadCalls, [["a.pdf", "b.pdf"]]);
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
        if (params?.path === "contracts") {
          return Promise.resolve({
            data: [{ type: "folder", path: "contracts/" }],
            page_info: { next: null },
          });
        }
        return Promise.resolve({
          data: [{ type: "file", path: "contracts/q1.pdf" }],
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
    assertEquals(listCalls[0]?.params?.path, "contracts");
    assertEquals(listCalls[1]?.params?.path, "contracts/");
    assertEquals(listCalls[1]?.params?.recursive, "false");
    assertEquals(downloadCalls, [["contracts/q1.pdf"]]);
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
            localPath: `/workspace/uploads/${uploadPath}`,
          }));
        },
      },
    );

    assertEquals(downloadCalls, [["contracts/a.pdf", "contracts/b.pdf", "contracts/c.pdf"]]);
    assertEquals(
      collection.sources.map((source) =>
        source.kind === "upload" ? source.uploadPath : source.localPath
      ),
      ["contracts/a.pdf", "contracts/b.pdf", "contracts/c.pdf"],
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
                uploadPath: "contracts/b.pdf",
                localPath: "/workspace/uploads/contracts/b.pdf",
              },
              {
                uploadPath: "contracts/a.pdf",
                localPath: "/workspace/uploads/contracts/a.pdf",
              },
            ];
          },
        },
      );

      assertEquals(downloadCalls, [["contracts/a.pdf", "contracts/b.pdf"]]);
      assertEquals(collection, {
        sources: [
          {
            kind: "upload",
            input: "uploads/contracts/a.pdf",
            uploadPath: "contracts/a.pdf",
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
            uploadPath: "contracts/b.pdf",
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
            localPath: `/workspace/uploads/${uploadPath}`,
          }));
        },
      },
    );

    assertEquals(downloadCalls, [["contracts/spec.pdf", "tools/run_benchmark.py"]]);
    assertEquals(
      collection.sources.map((source) =>
        source.kind === "upload" ? source.uploadPath : source.localPath
      ),
      ["contracts/spec.pdf", "tools/run_benchmark.py"],
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
            { type: "file", path: "docs/guide.md" },
            { type: "file", path: "docs/.env" },
            { type: "file", path: "docs/node_modules/react/index.js" },
            { type: "file", path: "docs/archive.zip" },
            { type: "file", path: "docs/run_benchmark.py" },
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

    assertEquals(downloadCalls, [["docs/guide.md", "docs/run_benchmark.py"]]);
    assertEquals(
      collection.sources.map((source) =>
        source.kind === "upload" ? source.uploadPath : source.localPath
      ),
      ["docs/guide.md", "docs/run_benchmark.py"],
    );
    assertEquals(collection.skipped.length, 3);
  });
});

describe("ingestResolvedSources", () => {
  it("runs the parser and uploads knowledge markdown", async () => {
    const results = await ingestResolvedSources(
      [{
        kind: "upload",
        input: "uploads/contracts/q1.pdf",
        uploadPath: "contracts/q1.pdf",
        localPath: "/workspace/uploads/contracts/q1.pdf",
      }],
      {
        sources: [],
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
        runParser: async () => ({
          success: true,
          source_path: "/workspace/uploads/contracts/q1.pdf",
          source_filename: "q1.pdf",
          source_type: "pdf",
          slug: "contracts-q1",
          sandbox_output_path: "/workspace/knowledge/contracts-q1.md",
          suggested_project_path: "knowledge/contracts-q1.md",
          description: "Parsed from q1.pdf",
          title: "Q1",
          summary: "Extracted 4 page(s).",
          stats: { pages: 4 },
          warnings: [],
        }),
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
      [{
        kind: "local",
        input: "/var/folders/random/report.pdf",
        localPath: "/var/folders/random/report.pdf",
      }],
      {
        sources: [],
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

  it("prefers kreuzberg for PDF extraction when the binary is available", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "veryfront-knowledge-parser-kreuzberg-" });
    const binDir = join(tempDir, "bin");
    const filePath = join(tempDir, "offer.pdf");
    const outputDir = join(tempDir, "knowledge-output");
    const kreuzbergPath = join(binDir, "kreuzberg");
    const originalPath = Deno.env.get("PATH") ?? "";

    try {
      await Deno.mkdir(binDir, { recursive: true });
      await Deno.writeTextFile(filePath, "stub pdf bytes");
      await Deno.writeTextFile(
        kreuzbergPath,
        [
          "#!/bin/sh",
          'if [ "$1" != "extract" ]; then',
          '  echo "unexpected command" >&2',
          "  exit 64",
          "fi",
          'printf \'%s\\n\' \'{"content":"## Fake PDF\\n\\nParsed by kreuzberg","metadata":{"mime_type":"application/pdf","page_count":3,"table_count":1}}\'',
        ].join("\n"),
      );
      await Deno.chmod(kreuzbergPath, 0o755);

      const result = await runKnowledgeParser({
        filePath,
        outputDir,
        description: "Offer PDF",
        slug: "offer-pdf",
        sourceReference: "uploads/offers/offer.pdf",
        env: { PATH: `${binDir}:${originalPath}` },
      });

      assertEquals(result.source_type, "pdf");
      assertEquals(result.slug, "offer-pdf");
      assertEquals(result.stats.engine, "kreuzberg");
      assertEquals(result.stats.pages, 3);
      assertEquals(result.stats.tables, 1);
      assertStringIncludes(result.summary, "Converted PDF to markdown");

      const markdown = await Deno.readTextFile(result.sandbox_output_path);
      assertStringIncludes(markdown, 'source: "uploads/offers/offer.pdf"');
      assertStringIncludes(markdown, 'description: "Offer PDF"');
      assertStringIncludes(markdown, "# Offer");
      assertStringIncludes(markdown, "Parsed by kreuzberg");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("falls back to the built-in parser when kreuzberg extraction fails", async () => {
    const tempDir = await Deno.makeTempDir({
      prefix: "veryfront-knowledge-parser-kreuzberg-fallback-",
    });
    const binDir = join(tempDir, "bin");
    const pythonDir = join(tempDir, "python");
    const filePath = join(tempDir, "fallback.pdf");
    const outputDir = join(tempDir, "knowledge-output");
    const kreuzbergPath = join(binDir, "kreuzberg");
    const originalPath = Deno.env.get("PATH") ?? "";

    try {
      await Deno.mkdir(binDir, { recursive: true });
      await Deno.mkdir(pythonDir, { recursive: true });
      await Deno.writeTextFile(filePath, "stub pdf bytes");
      await Deno.writeTextFile(
        kreuzbergPath,
        [
          "#!/bin/sh",
          'echo "boom" >&2',
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
      await Deno.chmod(kreuzbergPath, 0o755);

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
        "kreuzberg extraction failed; fell back to the built-in parser",
      );

      const markdown = await Deno.readTextFile(result.sandbox_output_path);
      assertStringIncludes(markdown, "# Fallback");
      assertStringIncludes(markdown, "## Page 1");
      assertStringIncludes(markdown, "Fallback PDF text");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });
});
