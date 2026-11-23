import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { basename, dirname, join, normalize, resolve } from "veryfront/platform/path";
import { VeryfrontError } from "veryfront/errors";
import { inspectOkfDocument } from "veryfront/knowledge";
import { parseCliArgs } from "../../shared/args.ts";
import type { ParsedArgs } from "#cli/shared/types";
import {
  buildKnowledgeResource,
  collectKnowledgeSources,
  createKnowledgeIngestResult,
  deriveKnowledgeRemotePath,
  deriveOkfBundleRelativePath,
  formatKnowledgeUploadSource,
  ingestResolvedSources,
  isLikelyLocalPath,
  knowledgeCommand,
  normalizeKnowledgeInputPath,
  normalizeProjectUploadPath,
  parseKnowledgeIngestArgs,
  resolveKnowledgeDownloadOutputDir,
  runKnowledgeParser,
  runKnowledgeParsers,
  stripChatUploadPrefix,
} from "./command.ts";
import {
  createDownloadUploadsStub,
  createIndexReceipt,
  createKnowledgeCommandArgs,
  createLocalSource,
  createMockClient,
  createParserSuccess,
  createUploadSource,
} from "./command.test-helpers.ts";
import { computeHash, type Logger } from "#veryfront/utils";
import { VERSION } from "#cli/utils";
import {
  buildCustomKnowledgePath,
  buildCustomKnowledgeSlug,
  buildKnowledgeIngestIdentity,
  claimGeneratedKnowledgePath,
  findRemoteKnowledgeIngestSource,
  listRemoteKnowledgeSuffixPaths,
  readKnowledgeIngestSourceKey,
  readProvableLegacyLocalKnowledgeSource,
} from "./command-helpers.ts";
import { KnowledgeAllocationSession, type KnowledgeParserInput } from "./parser.ts";

describe("provable legacy local knowledge sources", () => {
  it("uses stored provenance and path spelling without inferring URL or upload origins", () => {
    const generated = { by: "veryfront/0.1.1289-rc" };
    for (
      const source of [
        "article.md",
        "./article.md",
        "./uploads/article.md",
        "/workspace/article.md",
      ]
    ) {
      assertEquals(
        readProvableLegacyLocalKnowledgeSource({ source, generated }),
        normalize(source),
      );
    }
    for (
      const source of [
        "uploads",
        "uploads/article.md",
        "https://example.test/article.md",
        "HTTP://example.test/article.md",
        "https:article",
        "ftp://example.test/article.md",
        "file:///workspace/article.md",
        "",
      ]
    ) {
      assertEquals(readProvableLegacyLocalKnowledgeSource({ source, generated }), undefined);
    }
    assertEquals(
      readProvableLegacyLocalKnowledgeSource({
        resource: "article.md",
        source: "article.md",
        generated,
      }),
      undefined,
    );
    assertEquals(readProvableLegacyLocalKnowledgeSource({ source: "article.md" }), undefined);
    assertEquals(
      readProvableLegacyLocalKnowledgeSource({
        source: "article.md",
        generated: { by: "authored/1" },
      }),
      undefined,
    );
    for (const source_key of [null, 42, "other-key"]) {
      assertEquals(
        readProvableLegacyLocalKnowledgeSource({
          source: "article.md",
          generated: { ...generated, source_key },
        }),
        undefined,
      );
    }
  });
});

type LoggedEvent = {
  level: string;
  message: string;
  metadata?: unknown;
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

describe("findRemoteKnowledgeIngestSource", () => {
  it("addresses the selected branch and rejects unresolved and malformed responses", async () => {
    let body: unknown = { status: "matched", path: "knowledge/earlier.md", version_id: "version" };
    const client = createMockClient({
      post: async (url, requestBody) => {
        assertEquals(url, "/projects/project%2Fslug/knowledge/ingest-source?ref=branch%3Afeature");
        assertEquals(requestBody, {
          root_path: "knowledge",
          resource: "uploads/source.md",
          legacy_source: "source.md",
          source_key: '["upload","uploads/source.md"]',
        });
        return body;
      },
    });
    const lookup = () =>
      findRemoteKnowledgeIngestSource({
        client,
        projectSlug: "project/slug",
        branch: "feature",
        rootPath: "knowledge",
        resource: "uploads/source.md",
        legacySource: "source.md",
        sourceKey: '["upload","uploads/source.md"]',
      });
    assertEquals(await lookup(), { path: "knowledge/earlier.md", versionId: "version" });
    body = { status: "absent" };
    assertEquals(await lookup(), undefined);
    body = { status: "unresolved" };
    await assertRejects(lookup, Error, "ambiguous source origin");
    body = { status: "ambiguous" };
    await assertRejects(lookup, Error, "Multiple current documents match");
    body = { status: "matched", path: "knowledge/earlier.md" };
    await assertRejects(lookup, Error, "Invalid knowledge source lookup response");
  });
});

describe("normalizeKnowledgeInputPath", () => {
  it("normalizes safe upload paths", () => {
    assertEquals(
      normalizeKnowledgeInputPath("uploads/contracts/q1.pdf"),
      "uploads/contracts/q1.pdf",
    );
  });

  it("rejects traversal as an invalid-argument usage error", () => {
    const error = assertThrows(
      () => normalizeKnowledgeInputPath("../secret.txt"),
      VeryfrontError,
      "Invalid knowledge input path",
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "invalid-argument");
  });
});

describe("knowledgeCommand", () => {
  it("parses --okf-bundle as a boolean before the ingest subcommand", () => {
    const args = parseCliArgs([
      "knowledge",
      "--okf-bundle",
      "ingest",
      "--path",
      "uploads/bundle",
      "--all",
    ]);

    assertEquals(args._, ["knowledge", "ingest"]);
    assertEquals(args["okf-bundle"], true);
    const parsed = parseKnowledgeIngestArgs(args);
    assertEquals(parsed.success, true);
    if (parsed.success) {
      assertEquals(parsed.data.okfBundle, true);
      assertEquals(parsed.data.path, "uploads/bundle");
      assertEquals(parsed.data.all, true);
    }
  });

  it("parses --branch before the ingest subcommand", () => {
    const args = parseCliArgs([
      "knowledge",
      "--branch",
      "chore/context-knowledge-proof-20261007",
      "ingest",
      "--path",
      "/workspace/okf-bundle",
      "--all",
    ]);

    assertEquals(args._, ["knowledge", "ingest"]);
    assertEquals(args.branch, "chore/context-knowledge-proof-20261007");
    const parsed = parseKnowledgeIngestArgs(args);
    assertEquals(parsed.success, true);
    if (parsed.success) {
      assertEquals(parsed.data.branch, "chore/context-knowledge-proof-20261007");
      assertEquals(parsed.data.path, "/workspace/okf-bundle");
      assertEquals(parsed.data.all, true);
    }
  });

  it("rejects explicit branch flags without a value", () => {
    for (
      const argv of [
        ["knowledge", "ingest", "doc.md", "--branch="],
        ["knowledge", "ingest", "doc.md", "--branch", "--json"],
        ["knowledge", "ingest", "doc.md", "-b", ""],
      ]
    ) {
      const parsed = parseKnowledgeIngestArgs(parseCliArgs(argv));
      assertEquals(parsed.success, false);
    }
  });

  it("rejects unusable ingest arguments as invalid-argument usage errors", async () => {
    const error = await assertRejects(
      () => knowledgeCommand({ _: ["knowledge", "ingest"] } as unknown as ParsedArgs),
      VeryfrontError,
      "Invalid knowledge ingest arguments",
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "invalid-argument");
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
    const tempDir = await makeTempDir();
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
      await Deno.remove(shadowDir, { recursive: true }).catch(() => undefined);
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
    const tempDir = await makeTempDir();
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
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-local-walk-" });
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

  it("skips remote OKF viewer artifacts before downloading uploads", async () => {
    const client = createMockClient({
      get: (_path, params) => {
        assertEquals(params?.path, "uploads/bundle/");
        return Promise.resolve({
          data: [
            { type: "file", path: "uploads/bundle/topic.md" },
            { type: "file", path: "uploads/bundle/viz.html" },
          ],
          page_info: { next: null },
        });
      },
    });
    const downloadCalls: string[][] = [];

    const collection = await collectKnowledgeSources(
      createKnowledgeCommandArgs({ path: "uploads/bundle", all: true, okfBundle: true }),
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

    assertEquals(downloadCalls, [["uploads/bundle/topic.md"]]);
    assertEquals(
      collection.sources.map((source) =>
        source.kind === "upload" ? source.uploadPath : source.localPath
      ),
      ["uploads/bundle/topic.md"],
    );
    assertEquals(collection.skipped, [{
      source: "uploads/bundle/viz.html",
      localSourcePath: null,
      reason: "unsupported_file_type",
      message:
        "OKF bundle mode preserves Markdown documents and referenced text and binary companions; unreferenced generated artifacts are skipped.",
    }]);
  });

  it("preserves referenced remote OKF companion assets before upload", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-okf-remote-companions-" });
    const remoteFiles = new Map([
      [
        "uploads/bundle/topic.md",
        "---\ntype: Attested Computation\ncomputation: scripts/revenue.js\nexecutor: bin/run\nresource: references/schema.json\nsources:\n  - resource: references/raw.json\nattester:\n  resource: references/check.json\n---\nRevenue\n",
      ],
      ["uploads/bundle/scripts/revenue.js", "export const revenue = 1;\r\n"],
      ["uploads/bundle/bin/run", "#!/bin/sh\necho run\n"],
      ["uploads/bundle/references/check.json", '{"ok":true}\n'],
      ["uploads/bundle/viz.html", "<html>viewer</html>"],
    ]);
    const client = createMockClient({
      get: () =>
        Promise.resolve({
          data: [...remoteFiles.keys()].map((path) => ({ type: "file", path })),
          page_info: { next: null },
        }),
    });
    const downloadCalls: string[][] = [];

    try {
      const collection = await collectKnowledgeSources(
        createKnowledgeCommandArgs({ path: "uploads/bundle", all: true, okfBundle: true }),
        {
          client,
          projectSlug: "my-project",
          downloadUploads: async (uploadPaths) => {
            downloadCalls.push(uploadPaths);
            const downloads = [];
            for (const uploadPath of uploadPaths) {
              const localPath = join(tempDir, uploadPath);
              await Deno.mkdir(dirname(localPath), { recursive: true });
              await Deno.writeTextFile(localPath, remoteFiles.get(uploadPath) ?? "");
              downloads.push({ uploadPath, localPath });
            }
            return downloads;
          },
        },
      );

      assertEquals(downloadCalls, [["uploads/bundle/topic.md"], [
        "uploads/bundle/scripts/revenue.js",
        "uploads/bundle/bin/run",
        "uploads/bundle/references/check.json",
      ]]);
      assertEquals(
        collection.sources.map((source) =>
          source.kind === "upload" ? source.uploadPath : source.localPath
        ).sort(),
        [
          "uploads/bundle/bin/run",
          "uploads/bundle/references/check.json",
          "uploads/bundle/scripts/revenue.js",
          "uploads/bundle/topic.md",
        ],
      );
      assertEquals(collection.skipped.map((skipped) => skipped.source), [
        "uploads/bundle/viz.html",
      ]);
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("preserves root-relative remote OKF companions referenced from nested computations", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-okf-remote-root-companions-" });
    const remoteFiles = new Map([
      [
        "uploads/bundle/computations/revenue-ytd.md",
        "---\ntype: Attested Computation\nattester:\n  resource: attesters/sql_equality.py\n---\nRevenue\n",
      ],
      ["uploads/bundle/attesters/sql_equality.py", "def attest():\n    return True\n"],
      ["uploads/bundle/viz.html", "<html>viewer</html>"],
    ]);
    const client = createMockClient({
      get: () =>
        Promise.resolve({
          data: [...remoteFiles.keys()].map((path) => ({ type: "file", path })),
          page_info: { next: null },
        }),
    });
    const downloadCalls: string[][] = [];

    try {
      const collection = await collectKnowledgeSources(
        createKnowledgeCommandArgs({ path: "uploads/bundle", all: true, okfBundle: true }),
        {
          client,
          projectSlug: "my-project",
          downloadUploads: async (uploadPaths) => {
            downloadCalls.push(uploadPaths);
            const downloads = [];
            for (const uploadPath of uploadPaths) {
              const localPath = join(tempDir, uploadPath);
              await Deno.mkdir(dirname(localPath), { recursive: true });
              await Deno.writeTextFile(localPath, remoteFiles.get(uploadPath) ?? "");
              downloads.push({ uploadPath, localPath });
            }
            return downloads;
          },
        },
      );

      assertEquals(downloadCalls, [["uploads/bundle/computations/revenue-ytd.md"], [
        "uploads/bundle/attesters/sql_equality.py",
      ]]);
      assertEquals(
        collection.sources.map((source) =>
          source.kind === "upload" ? source.uploadPath : source.localPath
        ).sort(),
        [
          "uploads/bundle/attesters/sql_equality.py",
          "uploads/bundle/computations/revenue-ytd.md",
        ],
      );
      assertEquals(collection.skipped.map((skipped) => skipped.source), [
        "uploads/bundle/viz.html",
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
  it("passes the uploaded file name and path to the parser without a path-derived slug", async () => {
    const inputs: KnowledgeParserInput[] = [];
    const uploadPath = "uploads/_knowledge-ingest/20261110201703921-e763c00b/20. Create.md";
    await ingestResolvedSources(
      [
        createUploadSource(uploadPath),
        createUploadSource(
          "uploads/chat-11111111-2222-3333-4444-555555555555-1700000000000-xyz99-agents.md",
        ),
      ],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async (input) => {
          inputs.push(input);
          return createParserSuccess();
        },
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
      },
    );

    assertEquals(
      inputs.map(({ slug, sourceName, resource, sourceReference }) => ({
        slug,
        sourceName,
        resource,
        sourceReference,
      })),
      [
        {
          slug: undefined,
          sourceName: "20. Create.md",
          resource: "20. Create.md",
          sourceReference: uploadPath,
        },
        {
          slug: undefined,
          sourceName: "agents.md",
          resource:
            "uploads/chat-11111111-2222-3333-4444-555555555555-1700000000000-xyz99-agents.md",
          sourceReference:
            "uploads/chat-11111111-2222-3333-4444-555555555555-1700000000000-xyz99-agents.md",
        },
      ],
    );
  });

  it("uses the current source path and version even when its title changed", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-source-lookup-" });
    try {
      const localPath = join(tempDir, "article.md");
      await Deno.writeTextFile(localPath, "# New heading\n\nUpdated content.");
      const writes: unknown[] = [];
      let lookupPath = "knowledge/old-heading.md";
      const ingest = () =>
        ingestResolvedSources(
          [createUploadSource("uploads/article.md", localPath)],
          createKnowledgeCommandArgs(),
          {
            client: createMockClient(),
            projectSlug: "my-project",
            outputDir: join(tempDir, "fresh"),
            runParser: runKnowledgeParser,
            findRemoteKnowledgeSource: async (source) => {
              assertEquals(source.resource, "uploads/article.md");
              assertEquals(source.rootPath, "knowledge");
              return { path: lookupPath, versionId: "original-version" };
            },
            readRemoteKnowledgeFile: async () => {
              throw new Error("An existing source should bypass filename allocation");
            },
            indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
            uploadKnowledgeFile: async (path, _local, _metadata, _kind, expected) => {
              writes.push({ path, expected });
              return { path };
            },
          },
        );
      const result = await ingest();
      assertEquals(result.failed, []);
      assertEquals(result.ingested.map(({ remotePath }) => remotePath), [
        "knowledge/old-heading.md",
      ]);
      assertEquals(writes, [
        { path: "knowledge/old-heading.md", expected: { versionId: "original-version" } },
      ]);
      for (const path of ["knowledge-other/article.md", "knowledge/nested/../article.md"]) {
        lookupPath = path;
        const rejected = await ingest();
        assertEquals(rejected.ingested, []);
        assertEquals(rejected.failed.length, 1);
        assertEquals(writes.length, 1);
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("reuses a canonical absolute local owner stored with a previous path spelling", async () => {
    const writes: unknown[] = [];
    const lookups: unknown[] = [];
    const result = await ingestResolvedSources(
      [createLocalSource("/workspace/contracts/../contracts/q1.txt")],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async () => createParserSuccess(),
        findRemoteKnowledgeSource: async ({ resource, legacySource, sourceKey }) => {
          lookups.push({ resource, legacySource, sourceKey });
          return legacySource === "/workspace/contracts/../contracts/q1.txt"
            ? { path: "knowledge/previous-title.md", versionId: "prior-version" }
            : undefined;
        },
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (path, _local, _metadata, _kind, expected) => {
          writes.push({ path, expected });
          return { path };
        },
      },
    );

    assertEquals(result.failed, []);
    assertEquals(lookups, [{
      resource: "/workspace/contracts/q1.txt",
      legacySource: "/workspace/contracts/../contracts/q1.txt",
      sourceKey: JSON.stringify(["local", "/workspace/contracts/q1.txt"]),
    }]);
    assertEquals(writes, [{
      path: "knowledge/previous-title.md",
      expected: { versionId: "prior-version" },
    }]);
  });

  it("uses one source key for repeated Studio batches and alternate local path spellings", () => {
    const firstBatch = createUploadSource("uploads/_knowledge-ingest/first/area/guide.md");
    const secondBatch = createUploadSource("uploads/_knowledge-ingest/second/area/guide.md");
    assertEquals(
      buildKnowledgeIngestIdentity(firstBatch),
      buildKnowledgeIngestIdentity(secondBatch),
    );
    assertEquals(
      buildKnowledgeIngestIdentity(createLocalSource("./area/guide.md")),
      {
        resource: resolve("area/guide.md"),
        sourceKey: JSON.stringify(["local", resolve("area/guide.md")]),
      },
    );
  });

  it("retains the original local source reference and ingestion result", async () => {
    const original = "./contracts/guide.md";
    const parsed: KnowledgeParserInput[] = [];
    const result = await ingestResolvedSources(
      [createLocalSource(original)],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async (input) => {
          parsed.push(input);
          return createParserSuccess();
        },
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (path) => ({ path }),
      },
    );
    assertEquals(parsed[0]?.sourceReference, original);
    assertEquals(parsed[0]?.resource, resolve(original));
    assertEquals(result.ingested[0]?.source, original);
    assertEquals(result.ingested[0]?.localSourcePath, original);
  });

  it("refuses ambiguous relative legacy owners without duplicating or overwriting them", async () => {
    const root = await makeTempDir({ prefix: "veryfront-relative-legacy-owner-" });
    try {
      const sourcePath = join(root, "guide.md");
      const outputDir = join(root, "output");
      const legacyPath = join(outputDir, "previous-title.md");
      await Deno.mkdir(outputDir);
      await Deno.writeTextFile(sourcePath, "# New title\n\nNew source.");
      const legacy =
        '---\nsource: "../old-workspace/guide.md"\ngenerated: { by: "veryfront/0.1.0" }\n---\nLegacy body.\n';
      await Deno.writeTextFile(legacyPath, legacy);
      const identity = buildKnowledgeIngestIdentity(createLocalSource(sourcePath));
      await assertRejects(
        () =>
          runKnowledgeParser({ filePath: sourcePath, outputDir, ...identity, sourceKind: "local" }),
        Error,
        "relative legacy source",
      );
      assertEquals(await Deno.readTextFile(legacyPath), legacy);
      const documents = [];
      for await (const entry of Deno.readDir(outputDir)) {
        if (entry.isFile && entry.name.endsWith(".md")) documents.push(entry.name);
      }
      assertEquals(documents, ["previous-title.md"]);
      const migrated = await runKnowledgeParser({
        filePath: sourcePath,
        outputDir,
        ...identity,
        sourceKind: "local",
        slug: "previous-title",
      });
      assertEquals(migrated.sandbox_output_path, legacyPath);
      assertEquals(
        readKnowledgeIngestSourceKey(
          inspectOkfDocument(legacyPath, await Deno.readTextFile(legacyPath)).metadata,
        ),
        identity.sourceKey,
      );
      const repeated = await runKnowledgeParser({
        filePath: sourcePath,
        outputDir,
        ...identity,
        sourceKind: "local",
      });
      assertEquals(repeated.sandbox_output_path, legacyPath);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("refuses historical relative typed owners at hashed and retained remote custom paths", async () => {
    const source = createLocalSource("./area/guide.md");
    const oldKey = JSON.stringify(["local", "area/guide.md"]);
    for (
      const oldPath of [
        `docs/imports/area-guide-source-${await computeHash(oldKey)}.md`,
        "docs/imports/area-guide.md",
        "docs/imports/area-guide-3.md",
      ]
    ) {
      const content =
        `---\nresource: "area/guide.md"\ngenerated: {by: "veryfront/0.1.0",source_key: ${
          JSON.stringify(oldKey)
        }}\n---\nOld body.`;
      await assertRejects(
        () =>
          claimGeneratedKnowledgePath({
            remotePath: "docs/imports/new-title.md",
            ...buildKnowledgeIngestIdentity(source),
            sourceKind: "local",
            legacySource: source.localPath,
            customSource: source,
            scanSuffixGaps: true,
            absenceConflicts: new Map(),
            listSuffixPaths: async () => new Set([oldPath]),
            readRemoteFile: async (path) =>
              path === oldPath ? { content, versionId: "old-version" } : undefined,
          }),
        Error,
        "relative local source",
      );
    }
  });

  it("refuses relative typed local owners until their output is explicitly migrated", async () => {
    const root = await makeTempDir();
    try {
      const filePath = join(root, "guide.md");
      const outputDir = join(root, "output");
      await Deno.mkdir(outputDir);
      await Deno.writeTextFile(filePath, "# New title\n\nNew body.");
      const path = join(outputDir, "old-title.md");
      const old =
        `---\nresource: "guide.md"\ngenerated:\n  by: "veryfront/0.1.0"\n  source_key: '["local","guide.md"]'\n---\nOld body.\n`;
      await Deno.writeTextFile(path, old);
      const input = {
        filePath,
        outputDir,
        ...buildKnowledgeIngestIdentity(createLocalSource(filePath)),
      };
      await assertRejects(() => runKnowledgeParser(input), Error, "relative legacy source");
      assertEquals(await Deno.readTextFile(path), old);
      assertEquals(
        (await runKnowledgeParser({ ...input, slug: "old-title" })).sandbox_output_path,
        path,
      );
      assertEquals((await runKnowledgeParser(input)).sandbox_output_path, path);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("refreshes matching ambiguous owners after another compatible session migrates them", async () => {
    const root = await makeTempDir();
    try {
      for (const kind of ["source", "resource", "typed"]) {
        const directory = join(root, kind);
        const outputDir = join(directory, "output");
        await Deno.mkdir(outputDir, { recursive: true });
        const first = join(directory, "first", "guide.md");
        const second = join(directory, "second", "guide.md");
        const other = join(directory, "other.md");
        await Deno.mkdir(join(directory, "first"));
        await Deno.mkdir(join(directory, "second"));
        for (const file of [first, second, other]) {
          await Deno.writeTextFile(file, "# Guide\n\nBody.");
        }
        const provenance = kind === "source"
          ? 'source: "./guide.md"\ngenerated: { by: "veryfront/0.1.0" }'
          : kind === "resource"
          ? 'resource: "guide.md"\ngenerated: { by: "veryfront/0.1.0" }'
          : `resource: "guide.md"\ngenerated: { by: "veryfront/0.1.0", source_key: '["local","guide.md"]' }`;
        await Deno.writeTextFile(
          join(outputDir, "legacy.md"),
          `---\n${provenance}\n---\nOld body.`,
        );
        const session = new KnowledgeAllocationSession();
        const input = (filePath: string) => ({
          filePath,
          outputDir,
          ...buildKnowledgeIngestIdentity(createLocalSource(filePath)),
        });
        await runKnowledgeParser(input(other), { allocationSession: session });
        await runKnowledgeParser({ ...input(first), slug: "legacy" });
        const result = await runKnowledgeParser(input(second), { allocationSession: session });
        assert(result.sandbox_output_path !== join(outputDir, "legacy.md"), kind);
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("refreshes ambiguity after compatible legacy publications", async () => {
    const root = await makeTempDir();
    try {
      for (const mode of ["new", "replace-positive", "failed-write", "same-session-generated"]) {
        for (const kind of ["resource", "source", "typed"]) {
          if (mode === "same-session-generated" && kind !== "resource") continue;
          const directory = join(root, `${mode}-${kind}`);
          const outputDir = join(directory, "output");
          await Deno.mkdir(outputDir, { recursive: true });
          const guide = join(directory, "guide.md");
          const other = join(directory, "other.md");
          await Deno.writeTextFile(guide, "# Guide\n\nBody.");
          await Deno.writeTextFile(other, "# Other\n\nBody.");
          const input = (filePath: string) => ({
            filePath,
            outputDir,
            ...buildKnowledgeIngestIdentity(createLocalSource(filePath)),
          });
          if (mode === "replace-positive") {
            await runKnowledgeParser({ ...input(guide), slug: "legacy" });
          }
          const session = new KnowledgeAllocationSession();
          await runKnowledgeParser(input(other), { allocationSession: session });
          const metadata = kind === "resource"
            ? 'resource: "area/guide.md"\ngenerated: { by: "veryfront/0.1.0" }'
            : kind === "source"
            ? 'source: "area/guide.md"\ngenerated: { by: "veryfront/0.1.0" }'
            : `resource: "area/guide.md"\ngenerated: { by: "veryfront/0.1.0", source_key: '["local","area/guide.md"]' }`;
          const legacy = join(directory, "legacy.md");
          const content = `---\ntype: Document\n${metadata}\n---\nLegacy body.`;
          await Deno.writeTextFile(legacy, content);
          if (mode === "failed-write") {
            const writer = new KnowledgeAllocationSession();
            await assertRejects(
              () =>
                writer.directWrite(outputDir, async () => {
                  await Deno.writeTextFile(join(outputDir, "legacy.md"), content);
                  throw new Error("Failure after publication");
                }),
              Error,
              "Failure after publication",
            );
          } else if (mode === "same-session-generated") {
            await runKnowledgeParser({ filePath: legacy, outputDir, resource: "area/guide.md" }, {
              allocationSession: session,
            });
          } else {
            await runKnowledgeParser({ filePath: legacy, outputDir, okfRelativePath: "legacy.md" });
          }
          const message = kind === "resource"
            ? "ambiguous relative resource"
            : "relative legacy source";
          await assertRejects(() => runKnowledgeParser(input(guide)), Error, message);
          await assertRejects(
            () => runKnowledgeParser(input(guide), { allocationSession: session }),
            Error,
            message,
          );
        }
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("refuses ambiguous keyless relative resources without claiming a local origin", async () => {
    const root = await makeTempDir({ prefix: "veryfront-relative-resource-owner-" });
    try {
      const filePath = join(root, "guide.md");
      const outputDir = join(root, "output");
      await Deno.mkdir(outputDir);
      await Deno.writeTextFile(filePath, "# New title\n\nNew source.");
      const legacyPath = join(outputDir, "previous-title.md");
      const legacy =
        '---\nresource: "area/guide.md"\ngenerated: { by: "veryfront/0.1.0" }\n---\nLegacy body.\n';
      await Deno.writeTextFile(legacyPath, legacy);
      await assertRejects(
        () =>
          runKnowledgeParser({
            filePath,
            outputDir,
            ...buildKnowledgeIngestIdentity(createLocalSource(filePath)),
            sourceKind: "local",
          }),
        Error,
        "ambiguous relative resource",
      );
      assertEquals(await Deno.readTextFile(legacyPath), legacy);
      const migrated = await runKnowledgeParser({
        filePath,
        outputDir,
        ...buildKnowledgeIngestIdentity(createLocalSource(filePath)),
        sourceKind: "local",
        slug: "previous-title",
      });
      assertEquals(migrated.sandbox_output_path, legacyPath);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("does not overwrite a keyless relative resource with a staged upload", async () => {
    const root = await makeTempDir();
    try {
      const filePath = join(root, "article.md");
      const outputDir = join(root, "output");
      await Deno.mkdir(outputDir);
      await Deno.writeTextFile(filePath, "# Article\n\nIncoming upload.");
      const legacyPath = join(outputDir, "article.md");
      const original =
        '---\nresource: article.md\ngenerated: { by: "veryfront/0.1.0" }\n---\nOriginal source.';
      await Deno.writeTextFile(legacyPath, original);
      const result = await runKnowledgeParser({
        filePath,
        outputDir,
        ...buildKnowledgeIngestIdentity(
          createUploadSource("uploads/_knowledge-ingest/batch/article.md", filePath),
        ),
      });
      assertEquals(await Deno.readTextFile(legacyPath), original);
      assertEquals(result.sandbox_output_path, join(outputDir, "article-2.md"));
      assertStringIncludes(await Deno.readTextFile(result.sandbox_output_path), "Incoming upload.");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("refuses keyless upload-shaped resources before allocating a local owner", async () => {
    const root = await makeTempDir();
    try {
      const filePath = join(root, "guide.md");
      const outputDir = join(root, "output");
      await Deno.mkdir(outputDir);
      await Deno.writeTextFile(filePath, "# New title\n\nBody.");
      for (const resource of ["uploads/guide.md", "uploads/_knowledge-ingest/old/guide.md"]) {
        const path = join(outputDir, "old.md");
        const old = `---\nresource: ${
          JSON.stringify(resource)
        }\ngenerated: { by: "veryfront/0.1.0" }\n---\nOld body.`;
        await Deno.writeTextFile(path, old);
        await assertRejects(
          () =>
            runKnowledgeParser({
              filePath,
              outputDir,
              ...buildKnowledgeIngestIdentity(createLocalSource(filePath)),
            }),
          Error,
          "ambiguous relative resource",
        );
        assertEquals(await Deno.readTextFile(path), old);
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("refreshes cached positive owners before dismissing a matching ambiguity", async () => {
    const root = await makeTempDir();
    try {
      const filePath = join(root, "guide.md"),
        other = join(root, "other.md"),
        outputDir = join(root, "output");
      await Deno.mkdir(outputDir);
      await Deno.writeTextFile(filePath, "# New title\n\nBody.");
      await Deno.writeTextFile(other, "# Other\n\nBody.");
      const input = (filePath: string) => ({
        filePath,
        outputDir,
        ...buildKnowledgeIngestIdentity(createLocalSource(filePath)),
      });
      await runKnowledgeParser({ ...input(filePath), slug: "known" });
      await Deno.writeTextFile(
        join(outputDir, "legacy.md"),
        '---\nresource: "guide.md"\ngenerated: { by: "veryfront/0.1.0" }\n---\nLegacy body.',
      );
      const session = new KnowledgeAllocationSession();
      await runKnowledgeParser(input(other), { allocationSession: session });
      await runKnowledgeParser({ ...input(other), slug: "known" });
      await assertRejects(
        () => runKnowledgeParser(input(filePath), { allocationSession: session }),
        Error,
        "ambiguous relative resource",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("keeps typed upload owners and URL resources separate from local owners", async () => {
    const root = await makeTempDir({ prefix: "veryfront-legacy-resource-kinds-" });
    try {
      const filePath = join(root, "guide.md");
      const outputDir = join(root, "output");
      await Deno.mkdir(outputDir);
      await Deno.writeTextFile(filePath, "# Local guide\n\nLocal source.");
      for (
        const [index, resource] of ["uploads/guide.md", "https://example.com/guide.md"].entries()
      ) {
        await Deno.writeTextFile(
          join(outputDir, `external-${index}.md`),
          `---\nresource: ${JSON.stringify(resource)}\ngenerated: ${
            JSON.stringify({
              by: "veryfront/0.1.0",
              ...(index === 0 ? { source_key: JSON.stringify(["upload", resource]) } : {}),
            })
          }\n---\nExternal body.\n`,
        );
      }
      const result = await runKnowledgeParser({
        filePath,
        outputDir,
        ...buildKnowledgeIngestIdentity(createLocalSource(filePath)),
        sourceKind: "local",
      });
      assertStringIncludes(await Deno.readTextFile(result.sandbox_output_path), "Local source.");
      for (const index of [0, 1]) {
        assertStringIncludes(
          await Deno.readTextFile(join(outputDir, `external-${index}.md`)),
          "External body.",
        );
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("keeps absolute legacy owners and unrelated relative legacy names safe", async () => {
    const root = await makeTempDir({ prefix: "veryfront-absolute-legacy-owner-" });
    try {
      const sourcePath = join(root, "guide.md");
      const outputDir = join(root, "output");
      await Deno.mkdir(outputDir);
      await Deno.writeTextFile(sourcePath, "# New title\n\nNew source.");
      const unrelated =
        '---\nsource: "../elsewhere/other.md"\ngenerated: { by: "veryfront/0.1.0" }\n---\nUnrelated.\n';
      await Deno.writeTextFile(join(outputDir, "unrelated.md"), unrelated);
      const legacyPath = join(outputDir, "previous-title.md");
      await Deno.writeTextFile(
        legacyPath,
        `---\nsource: ${
          JSON.stringify(sourcePath)
        }\ngenerated: { by: "veryfront/0.1.0" }\n---\nOld source.\n`,
      );
      const identity = buildKnowledgeIngestIdentity(createLocalSource(sourcePath));
      const result = await runKnowledgeParser({
        filePath: sourcePath,
        outputDir,
        ...identity,
        sourceKind: "local",
      });
      assertEquals(result.sandbox_output_path, legacyPath);
      assertEquals(await Deno.readTextFile(join(outputDir, "unrelated.md")), unrelated);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("keeps main's source-derived custom paths when same-title files arrive in a new order", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-custom-path-" });
    try {
      const names = ["a", "b", "c"];
      for (const name of names) {
        await Deno.writeTextFile(join(tempDir, `${name}.md`), `# Overview\n\nSource ${name}.`);
      }
      const remote = new Map([
        [
          "docs/imports/a.md",
          [
            "---",
            `source: ${JSON.stringify(join(tempDir, "a.md"))}`,
            "generated:",
            '  by: "veryfront/0.1.0"',
            "---",
          ].join("\n"),
        ],
      ]);
      const guards: Array<{ path: string; expectation: unknown }> = [];
      let reads = 0;
      const ingest = (order: string[], outputDir: string) =>
        ingestResolvedSources(
          order.map((name) =>
            name === "a"
              ? createLocalSource(join(tempDir, "a.md"))
              : createUploadSource(`uploads/${name}.md`, join(tempDir, `${name}.md`))
          ),
          createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
          {
            client: createMockClient(),
            projectSlug: "my-project",
            outputDir: join(tempDir, outputDir),
            runParser: runKnowledgeParser,
            listRemoteKnowledgeSuffixPaths: async () => new Set(remote.keys()),
            readRemoteKnowledgeFile: async (path) => {
              reads++;
              const content = remote.get(path);
              return content === undefined ? undefined : { content, versionId: path };
            },
            uploadKnowledgeFile: async (path, file, _metadata, _kind, expectation) => {
              guards.push({ path, expectation });
              remote.set(path, await Deno.readTextFile(file));
              return { path };
            },
          },
        );

      const bPath = await buildCustomKnowledgePath(
        createUploadSource("uploads/b.md"),
        "docs/imports",
      );
      const cPath = await buildCustomKnowledgePath(
        createUploadSource("uploads/c.md"),
        "docs/imports",
      );
      const first = await ingest(names, "initial");
      assertEquals(first.failed, []);
      assertEquals(first.ingested.map(({ remotePath }) => remotePath), [
        "docs/imports/a.md",
        bPath,
        cPath,
      ]);
      assertEquals(guards.splice(0), [
        { path: "docs/imports/a.md", expectation: { versionId: "docs/imports/a.md" } },
        { path: bPath, expectation: { absent: true } },
        { path: cPath, expectation: { absent: true } },
      ]);

      const reordered = ["b", "c", "a"];
      const second = await ingest(reordered, "reordered");
      const stablePaths = [bPath, cPath, "docs/imports/a.md"];
      assertEquals(second.failed, []);
      assertEquals(second.ingested.map(({ remotePath }) => remotePath), stablePaths);
      assertEquals(guards, stablePaths.map((path) => ({ path, expectation: { versionId: path } })));
      assertEquals(remote.size, 3);
      assertEquals(reads, 18);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("updates a retained custom suffix while validating its local ownership hint", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-suffix-gap-" });
    try {
      const filePath = join(tempDir, "input.md");
      await Deno.writeTextFile(filePath, "# Updated heading\n\nUpdated content.");
      const path = "docs/imports/a-b-3.md";
      const reads: string[] = [];
      const writes: unknown[] = [];
      const client = createMockClient({
        get: async (url, params) => {
          assertEquals(url, "/projects/my-project/files");
          assertEquals(params, {
            pattern: "docs/imports/a-b-*.md",
            fields: "(path)",
            limit: "100",
            branch_id: "selected-branch",
          });
          return { data: [{ path }], page_info: { next: null } };
        },
      });
      const result = await ingestResolvedSources(
        [createUploadSource("uploads/a/b.md", filePath)],
        createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
        {
          client,
          projectSlug: "my-project",
          outputDir: join(tempDir, "generated"),
          runParser: runKnowledgeParser,
          listRemoteKnowledgeSuffixPaths: (stem) =>
            listRemoteKnowledgeSuffixPaths({
              client,
              projectSlug: "my-project",
              branchId: "selected-branch",
              stem,
            }),
          readRemoteKnowledgeFile: async (candidate) => {
            reads.push(candidate);
            return candidate === path
              ? {
                content: [
                  "---",
                  'resource: "uploads/a/b.md"',
                  "generated:",
                  `  source_key: ${JSON.stringify('["upload","uploads/a/b.md"]')}`,
                  "---",
                ].join("\n"),
                versionId: "retained-version",
              }
              : undefined;
          },
          uploadKnowledgeFile: async (remotePath, file, _metadata, _kind, expected) => {
            writes.push({ path: remotePath, expected });
            assertStringIncludes(await Deno.readTextFile(file), "Updated content.");
            return { path: remotePath };
          },
        },
      );
      assertEquals(result.failed, []);
      assertEquals(result.ingested.map(({ remotePath }) => remotePath), [path]);
      assertEquals(writes, [{ path, expected: { versionId: "retained-version" } }]);
      assertEquals(reads, [
        await buildCustomKnowledgePath(createUploadSource("uploads/a/b.md"), "docs/imports"),
        "docs/imports/updated-heading.md",
        "docs/imports/a-b.md",
        path,
      ]);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("reuses a retained custom suffix with normalized root and listing paths", async () => {
    for (const knowledgePath of [".", "./", "docs/imports", "./docs//imports/", "docs\\imports"]) {
      const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-normalized-suffix-" });
      try {
        const firstSource = join(tempDir, "first.md");
        const retainedSource = join(tempDir, "retained.md");
        await Deno.writeTextFile(firstSource, "# Overview\n\nFirst source.");
        await Deno.writeTextFile(retainedSource, "# Overview\n\nRetained source.");
        const root = normalizeKnowledgeInputPath(knowledgePath);
        const prefix = root === "." ? "" : `${root}/`;
        const initialPath = `${prefix}a-b.md`;
        const retainedPath = `${prefix}a-b-2.md`;
        const normalizePath = (path: string) => normalizeKnowledgeInputPath(path);
        const remote = new Map<string, { content: string; versionId: string }>();
        const reads: string[] = [];
        const writes: Array<{ path: string; expected: unknown }> = [];
        let publication = 0;
        const patterns: string[] = [];
        const client = createMockClient({
          get: async (url, params) => {
            assertEquals(url, "/projects/my-project/files");
            assertEquals(params?.fields, "(path)");
            assertEquals(params?.limit, "100");
            assertEquals(params?.ref, "branch:selected");
            patterns.push(params?.pattern ?? "");
            return {
              data: [...remote.keys()]
                .filter((path) => path.startsWith(`${prefix}a-b-`))
                .flatMap((path) =>
                  [path, `./${path}`, `/${path}`, path.replaceAll("/", "\\")]
                    .map((path) => ({ path }))
                ),
              page_info: { next: null },
            };
          },
        });
        const ingest = (sources: ReturnType<typeof createUploadSource>[]) =>
          ingestResolvedSources(
            sources,
            createKnowledgeCommandArgs({ knowledgePath }),
            {
              client,
              projectSlug: "my-project",
              outputDir: join(tempDir, "generated"),
              runParser: runKnowledgeParser,
              listRemoteKnowledgeSuffixPaths: (stem) =>
                listRemoteKnowledgeSuffixPaths({
                  client,
                  projectSlug: "my-project",
                  branch: "selected",
                  stem,
                }),
              readRemoteKnowledgeFile: async (candidate) => {
                const path = normalizePath(candidate);
                reads.push(path);
                return remote.get(path);
              },
              uploadKnowledgeFile: async (candidate, file, _metadata, _kind, expected) => {
                const path = normalizePath(candidate);
                writes.push({ path, expected });
                remote.set(path, {
                  content: await Deno.readTextFile(file),
                  versionId: `version-${++publication}`,
                });
                return { path };
              },
            },
          );
        const source = createUploadSource("uploads/a/b.md", retainedSource);
        const initial = await ingest([createUploadSource("uploads/a-b.md", firstSource), source]);
        assertEquals(initial.failed, [], knowledgePath);
        const firstPublished = initial.ingested[0]?.remotePath;
        const retainedPublished = initial.ingested[1]?.remotePath;
        assert(firstPublished && retainedPublished && firstPublished !== retainedPublished);
        const firstDocument = remote.get(normalizePath(firstPublished));
        const retainedDocument = remote.get(normalizePath(retainedPublished));
        assert(firstDocument && retainedDocument);
        remote.clear();
        remote.set(initialPath, firstDocument);
        remote.set(retainedPath, retainedDocument);
        remote.delete(initialPath);
        reads.length = 0;
        writes.length = 0;
        await Deno.writeTextFile(retainedSource, "# Overview\n\nUpdated retained source.");

        const updated = await ingest([source]);
        assertEquals(updated.failed, [], knowledgePath);
        assertEquals([...remote.keys()], [retainedPath], knowledgePath);
        assertEquals(writes, [{ path: retainedPath, expected: { versionId: "version-2" } }]);
        assertEquals(reads, [
          normalizePath(await buildCustomKnowledgePath(source, root)),
          `${prefix}overview-2.md`,
          initialPath,
          retainedPath,
        ]);
        assert(patterns.length > 0);
        assert(patterns.every((pattern) => pattern === `${prefix}a-b-*.md`));
        assertStringIncludes(remote.get(retainedPath)?.content ?? "", "Updated retained source.");
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    }
  });

  it("preserves the first absent conflict while closing its iterator", async () => {
    const sourceKey = '["local","guide.md"]';
    const conflicts = new Map<string, unknown>([["knowledge/previous-conflict.md", undefined]]);
    let closed = false;
    Object.defineProperty(conflicts, "values", {
      value: () => {
        const entries = (function* () {
          try {
            yield undefined;
          } finally {
            closed = true;
          }
        })();
        return {
          [Symbol.iterator]() {
            return this;
          },
          next: () => {
            const entry = entries.next();
            return {
              done: entry.done,
              get value() {
                assertEquals(closed, false);
                return entry.value;
              },
            };
          },
          return: () => {
            entries.return();
            throw new Error("iterator close must not replace the original conflict");
          },
        };
      },
    });
    let rejected = false;
    try {
      await claimGeneratedKnowledgePath({
        remotePath: "knowledge/guide.md",
        resource: "guide.md",
        legacySource: "./guide.md",
        sourceKey,
        sourceKind: "local",
        absenceConflicts: conflicts,
        readRemoteFile: async () => ({
          content: `---\nresource: guide.md\ngenerated: ${
            JSON.stringify({
              by: "veryfront/0.1.0",
              source_key: sourceKey,
            })
          }\n---\nExisting body.`,
          versionId: "current-version",
        }),
      });
    } catch (error) {
      rejected = true;
      assertEquals(error, undefined);
    }
    assert(rejected);
    assert(closed);
  });

  it("classifies legacy local origins without losing resource or typed-key precedence", async () => {
    const generated = { by: "veryfront/0.1.0" };
    const resource = "./uploads/guide.md";
    const path = "docs/imports/uploads-guide.md";
    const sourceKey = '["local","uploads/guide.md"]';
    const cases = [
      { metadata: { source: resource, generated }, expected: "matched" },
      { metadata: { source: ".\\uploads\\guide.md", generated }, expected: "matched" },
      { metadata: { resource, source: "guide.md", generated }, expected: "matched" },
      { metadata: { resource: ".\\uploads\\guide.md", generated }, expected: "matched" },
      { metadata: { resource: "uploads/guide.md", generated }, expected: "ambiguous" },
      {
        metadata: { resource: "uploads/guide.md", tags: ["md"], source_type: "md", generated },
        expected: "ambiguous",
      },
      { metadata: { source: "uploads/guide.md", generated }, expected: "ambiguous" },
      {
        metadata: { resource: "different.md", source: resource, generated },
        expected: "different",
      },
      { metadata: { resource: null, source: resource, generated }, expected: "different" },
      {
        metadata: {
          resource,
          generated: { ...generated, source_key: '["upload","uploads/guide.md"]' },
        },
        expected: "different",
      },
      {
        metadata: { resource, generated: { ...generated, source_key: sourceKey } },
        expected: "matched",
      },
      { metadata: { resource }, expected: "ambiguous" },
    ];
    for (const { metadata, expected } of cases) {
      const content = [
        "---",
        ...Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
        "---",
        "Existing body.",
      ].join("\n");
      const claim = () =>
        claimGeneratedKnowledgePath({
          remotePath: path,
          resource,
          legacySource: resource,
          sourceKey,
          sourceKind: "local",
          scanSuffixGaps: true,
          absenceConflicts: new Map(),
          listSuffixPaths: async () => new Set(),
          readRemoteFile: async (candidate) =>
            candidate === path ? { content, versionId: "legacy-version" } : undefined,
        });
      if (expected === "ambiguous") {
        await assertRejects(claim, Error, "source origin is ambiguous");
      } else {
        assertEquals(
          await claim(),
          expected === "matched"
            ? { remotePath: path, expected: { versionId: "legacy-version" } }
            : { remotePath: "docs/imports/uploads-guide-2.md", expected: { absent: true } },
        );
      }
    }
    for (
      const resource of [
        "./uploads/guide.md",
        ".\\uploads\\guide.md",
        "../uploads/guide.md",
        "..\\uploads\\guide.md",
        "/workspace/uploads/guide.md",
        "C:/workspace/uploads/guide.md",
        String.raw`C:\workspace\uploads\guide.md`,
        String.raw`\\server\share\guide.md`,
      ]
    ) {
      for (const field of ["resource", "source"]) {
        const content = `---\n${field}: ${JSON.stringify(resource)}\ngenerated: ${
          JSON.stringify(generated)
        }\n---\n`;
        const identity = buildKnowledgeIngestIdentity(createLocalSource(resource));
        assertEquals(
          await claimGeneratedKnowledgePath({
            remotePath: path,
            resource,
            legacySource: resource,
            sourceKey: identity.sourceKey,
            sourceKind: "local",
            scanSuffixGaps: true,
            absenceConflicts: new Map(),
            readRemoteFile: async (candidate) =>
              candidate === path ? ({ content, versionId: "legacy-version" }) : undefined,
          }),
          { remotePath: path, expected: { versionId: "legacy-version" } },
          `${field}: ${resource}`,
        );
      }
    }
  });

  it("keeps structural bundle files separate from generated custom destinations", async () => {
    for (const name of ["index", "log"]) {
      for (const kind of ["local", "upload"] as const) {
        const source = kind === "local"
          ? createLocalSource(`${name}.md`)
          : createUploadSource(`uploads/${name}.md`, `${name}.md`);
        const identity = buildKnowledgeIngestIdentity(source);
        const content = name === "index"
          ? "---\nokf_version: '0.2'\n---\n# Bundle\n"
          : "# Log\n\nCreated bundle.\n";
        assertEquals(
          await claimGeneratedKnowledgePath({
            remotePath: `docs/imports/${name}-document.md`,
            resource: identity.resource,
            sourceKey: identity.sourceKey,
            sourceKind: kind,
            legacySource: source.input,
            scanSuffixGaps: true,
            customSource: source,
            absenceConflicts: new Map(),
            listSuffixPaths: async () => new Set(),
            readRemoteFile: async (path) =>
              path === `docs/imports/${name}.md`
                ? { content, versionId: "structural-version" }
                : undefined,
          }),
          {
            remotePath: await buildCustomKnowledgePath(source, "docs/imports"),
            expected: { absent: true },
          },
        );
      }
    }
  });

  it("requires explicit terminal pagination evidence for bounded custom ownership", async () => {
    for (const pageInfo of [undefined, {}, { next: "" }, { next: "more" }, { next: null }]) {
      const client = createMockClient({
        get: async () => ({
          data: [{ path: "docs/imports/article-2.md" }],
          ...(pageInfo === undefined ? {} : { page_info: pageInfo }),
        }),
      });
      const result = await listRemoteKnowledgeSuffixPaths({
        client,
        projectSlug: "test",
        stem: "docs/imports/article",
      });
      assertEquals(
        result,
        pageInfo?.next === null ? new Set(["docs/imports/article-2.md"]) : undefined,
      );
    }
  });

  it("scopes historical staging discovery before bounding unrelated catalog paths", async () => {
    const source = createUploadSource(
      "uploads/_knowledge-ingest/new-batch/article.md",
      "article.md",
    );
    const identity = buildKnowledgeIngestIdentity(source);
    const retained = "docs/imports/knowledge-ingest-old-batch-article-12.md";
    const unrelated = Array.from(
      { length: 101 },
      (_, i) => `docs/imports/knowledge-ingest-batch-other-${i}.md`,
    );
    const patterns: string[] = [];
    const reads: string[] = [];
    const client = createMockClient({
      get: async (_url, params) => {
        const pattern = params?.pattern;
        assert(pattern);
        assert(pattern !== "docs/imports/knowledge-ingest-*.md");
        patterns.push(pattern);
        const matcher = new RegExp(`^${pattern.replaceAll(".", "\\.").replaceAll("*", ".*")}$`);
        const matching = [...unrelated, retained].filter((path) => matcher.test(path));
        return { data: matching.map((path) => ({ path })), page_info: { next: null } };
      },
    });
    const result = await claimGeneratedKnowledgePath({
      remotePath: "docs/imports/article.md",
      resource: identity.resource,
      sourceKey: identity.sourceKey,
      sourceKind: "upload",
      legacySource: source.uploadPath,
      scanSuffixGaps: true,
      customSource: source,
      absenceConflicts: new Map(),
      listSuffixPaths: (stem) =>
        listRemoteKnowledgeSuffixPaths({ client, projectSlug: "test", stem }),
      readRemoteFile: async (path) => {
        reads.push(path);
        return path === retained
          ? {
            content:
              `---\nsource: uploads/_knowledge-ingest/old-batch/article.md\ngenerated: { by: "veryfront/0.1.0", source_key: ${
                JSON.stringify(identity.sourceKey)
              } }\n---\nRetained.`,
            versionId: "retained-version",
          }
          : undefined;
      },
    });
    assertEquals(result, { remotePath: retained, expected: { versionId: "retained-version" } });
    assert(patterns.some((pattern) => pattern.endsWith("article.md")));
    assert(patterns.some((pattern) => pattern.endsWith("article-*.md")));
    assert(reads.every((path) => !unrelated.includes(path)));
  });

  it("bounds erased historical filenames and rejects missing origin proof", async () => {
    const source = createUploadSource("uploads/_knowledge-ingest/new/日本.md", "article.md");
    const identity = buildKnowledgeIngestIdentity(source);
    const path = "docs/imports/knowledge-ingest-old.md";
    for (const state of ["empty", "unrelated", "ambiguous", "partial"] as const) {
      const claim = () =>
        claimGeneratedKnowledgePath({
          remotePath: "docs/imports/document.md",
          ...identity,
          sourceKind: "upload",
          legacySource: source.uploadPath,
          scanSuffixGaps: true,
          customSource: source,
          absenceConflicts: new Map(),
          listSuffixPaths: async (stem) =>
            stem === "docs/imports/knowledge-ingest"
              ? state === "partial" ? undefined : new Set(state === "empty" ? [] : [path])
              : new Set(),
          readRemoteFile: async (candidate) =>
            candidate === path
              ? {
                content: state === "ambiguous"
                  ? '---\nresource: 日本.md\ngenerated: { by: "veryfront/0.1.0" }\n---\nUnknown origin.'
                  : `---\nresource: article.md\ngenerated: { by: "veryfront/0.1.0", source_key: '["upload","uploads/article.md"]' }\n---\nDifferent source.`,
                versionId: "existing-version",
              }
              : undefined,
        });
      if (state === "ambiguous") await assertRejects(claim, Error, "origin is ambiguous");
      else if (state === "partial") await assertRejects(claim, Error, "incomplete path listing");
      else {assertEquals(await claim(), {
          remotePath: await buildCustomKnowledgePath(source, "docs/imports"),
          expected: { absent: true },
        });}
    }
  });

  it("uses bounded exhaustive globs for valid oversized historical paths", async () => {
    const source = createLocalSource(`${Array(6).fill("a".repeat(180)).join("/")}/article.md`);
    const identity = buildKnowledgeIngestIdentity(source);
    const remotePath = `docs/imports/${await buildCustomKnowledgeSlug(source)}.md`;
    const legacy = `docs/imports/${source.localPath.replace(/\.md$/, "").replaceAll("/", "-")}.md`;
    for (const exists of [false, true]) {
      const lengths: number[] = [];
      const client = createMockClient({
        get: async (_url, params) => {
          const pattern = params?.pattern;
          assert(pattern);
          lengths.push(pattern.length);
          assert(pattern.length <= 1024);
          const matcher = new RegExp(`^${pattern.replaceAll(".", "\\.").replaceAll("*", ".*")}$`);
          return {
            data: exists && matcher.test(legacy) ? [{ path: legacy }] : [],
            page_info: { next: null },
          };
        },
      });
      const claim = () =>
        claimGeneratedKnowledgePath({
          remotePath,
          ...identity,
          sourceKind: "local",
          legacySource: source.input,
          scanSuffixGaps: true,
          customSource: source,
          absenceConflicts: new Map(),
          listSuffixPaths: (stem) =>
            listRemoteKnowledgeSuffixPaths({ client, projectSlug: "test", stem }),
          readRemoteFile: async (path) =>
            exists && path === legacy
              ? {
                content: `---\nsource: ${
                  JSON.stringify(source.input)
                }\ngenerated: { by: "veryfront/0.1.0" }\n---\nRetained long source.`,
                versionId: "legacy-version",
              }
              : undefined,
        });
      if (exists) await assertRejects(claim, Error, "source origin is ambiguous");
      else {
        assertEquals(await claim(), {
          remotePath: await buildCustomKnowledgePath(source, "docs/imports"),
          expected: { absent: true },
        });
      }
      assert(lengths.includes(1023));
    }
  });

  it("requires a version and one owner across every custom allocator family", async () => {
    const source = createUploadSource("uploads/article.md", "article.md");
    const identity = buildKnowledgeIngestIdentity(source);
    const base = "docs/imports/article.md";
    const legacy =
      `---\nsource: uploads/article.md\ngenerated: { by: "veryfront/0.1.0", source_key: ${
        JSON.stringify(identity.sourceKey)
      } }\n---\nExisting.`;
    for (const suffix of [undefined, 2, 151]) {
      const paths = new Set([
        base,
        ...(suffix === undefined ? [] : [`docs/imports/article-${suffix}.md`]),
      ]);
      await assertRejects(
        () =>
          claimGeneratedKnowledgePath({
            remotePath: base,
            ...identity,
            legacySource: source.uploadPath,
            sourceKind: "upload",
            scanSuffixGaps: true,
            customSource: source,
            absenceConflicts: new Map(),
            listSuffixPaths: async () => paths,
            readRemoteFile: async (path) =>
              paths.has(path)
                ? { content: legacy, ...(suffix === undefined ? {} : { versionId: path }) }
                : undefined,
          }),
        Error,
        suffix === undefined ? "current version" : "Multiple current documents",
      );
    }
    for (const exists of [false, true]) {
      await assertRejects(
        () =>
          claimGeneratedKnowledgePath({
            remotePath: base,
            ...identity,
            legacySource: source.uploadPath,
            sourceKind: "upload",
            scanSuffixGaps: true,
            customSource: source,
            absenceConflicts: new Map(),
            listSuffixPaths: async () => undefined,
            readRemoteFile: async (path) =>
              exists && path === base ? { content: legacy, versionId: "owner-version" } : undefined,
          }),
        Error,
        "incomplete path listing",
      );
    }
    const staged = createUploadSource("uploads/_knowledge-ingest/new/article.md", "article.md");
    const stagedIdentity = buildKnowledgeIngestIdentity(staged);
    const old = "docs/imports/knowledge-ingest-old-article.md";
    const content = `---\nresource: article.md\ngenerated: { by: "veryfront/0.1.0", source_key: ${
      JSON.stringify(stagedIdentity.sourceKey)
    } }\n---\nExisting.`;
    await assertRejects(
      () =>
        claimGeneratedKnowledgePath({
          remotePath: base,
          ...stagedIdentity,
          legacySource: staged.uploadPath,
          sourceKind: "upload",
          scanSuffixGaps: true,
          customSource: staged,
          absenceConflicts: new Map(),
          listSuffixPaths: async (stem) => new Set(stem.includes("knowledge-ingest") ? [old] : []),
          readRemoteFile: async (path) =>
            path === base || path === old ? { content, versionId: path } : undefined,
        }),
      Error,
      "Multiple current documents",
    );
  });

  it("does not promote a local explicit slug into legacy upload provenance", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-forged-staging-name-" });
    try {
      const file = join(tempDir, "article.md");
      await Deno.writeTextFile(file, "# Local article\n\nAuthored local content.");
      const parsed = await runKnowledgeParser({
        filePath: file,
        outputDir: join(tempDir, "legacy"),
        resource: "article.md",
        sourceReference: "article.md",
        slug: "knowledge-ingest-old-article",
      });
      const original = await Deno.readTextFile(parsed.sandbox_output_path);
      let writes = 0;
      const path = "docs/imports/knowledge-ingest-old-article.md";
      const result = await ingestResolvedSources(
        [createUploadSource("uploads/_knowledge-ingest/new/article.md", file)],
        createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
        {
          client: createMockClient(),
          projectSlug: "test",
          outputDir: join(tempDir, "new"),
          runParser: runKnowledgeParser,
          listRemoteKnowledgeSuffixPaths: async () => new Set([path]),
          readRemoteKnowledgeFile: async (candidate) =>
            candidate === path ? { content: original, versionId: "local-version" } : undefined,
          uploadKnowledgeFile: async () => {
            writes += 1;
            throw new Error("Cannot publish ambiguous ownership");
          },
        },
      );
      assertEquals(result.failed.length, 1);
      assert(result.failed[0]?.message?.includes("origin is ambiguous"));
      assertEquals(writes, 0);
      assertEquals(await Deno.readTextFile(parsed.sandbox_output_path), original);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("keeps explicit custom destinations separate when historical globs cross directories", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-custom-destination-" });
    try {
      const file = join(tempDir, "article.md");
      const remote = new Map<string, { content: string; versionId: string }>();
      const reads: string[] = [];
      const client = createMockClient({
        get: async (_url, params) => {
          const pattern = params?.pattern;
          assert(pattern);
          // The files API's wildcard deliberately includes slash characters.
          const matcher = new RegExp(`^${pattern.replaceAll(".", "\\.").replaceAll("*", ".*")}$`);
          return {
            data: [...remote.keys()].filter((path) => matcher.test(path)).map((path) => ({ path })),
            page_info: { next: null },
          };
        },
      });
      for (const name of ["日本", "article"]) {
        remote.clear();
        await Deno.writeTextFile(file, "# Original\n\nFirst explicit destination.");
        const source = createUploadSource(`uploads/_knowledge-ingest/batch/${name}.md`, file);
        const ingest = (knowledgePath: string, pinnedSlug?: string) =>
          ingestResolvedSources(
            [source],
            createKnowledgeCommandArgs({ knowledgePath, slug: pinnedSlug }),
            {
              client,
              projectSlug: "test",
              outputDir: join(tempDir, "generated"),
              runParser: runKnowledgeParser,
              listRemoteKnowledgeSuffixPaths: (stem) =>
                listRemoteKnowledgeSuffixPaths({ client, projectSlug: "test", stem }),
              readRemoteKnowledgeFile: async (path) => {
                reads.push(path);
                return remote.get(path);
              },
              uploadKnowledgeFile: async (path, file, _metadata, _kind, expected) => {
                assertEquals(expected, pinnedSlug ? undefined : { absent: true });
                remote.set(path, { content: await Deno.readTextFile(file), versionId: path });
                return { path };
              },
            },
          );
        const pinnedSlug = name === "article" ? "other-article" : undefined;
        const nested = pinnedSlug
          ? `docs/imports/knowledge-ingest-archive/${pinnedSlug}.md`
          : await buildCustomKnowledgePath(source, "docs/imports/knowledge-ingest-archive");
        const first = await ingest("docs/imports/knowledge-ingest-archive", pinnedSlug);
        assertEquals(first.failed, []);
        assertEquals(first.ingested.map((file) => file.remotePath), [nested]);
        const original = remote.get(nested);
        assert(original);
        reads.length = 0;
        await Deno.writeTextFile(file, "# Updated\n\nSecond explicit destination.");
        const second = await ingest("docs/imports");
        assertEquals(second.failed, []);
        assertEquals(second.ingested.map((file) => file.remotePath), [
          await buildCustomKnowledgePath(source, "docs/imports"),
        ]);
        assertEquals(remote.size, 2);
        assertEquals(remote.get(nested), original);
        assert(!reads.includes(nested));
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("retains historical custom paths across staging batches and filename policy changes", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-legacy-alias-" });
    try {
      const file = join(tempDir, "article.md");
      const longName = "a".repeat(230);
      const longFile = join(tempDir, `${longName}.md`);
      await Deno.writeTextFile(file, "# Article\n\nUpdated article.");
      await Deno.writeTextFile(longFile, "# Article\n\nUpdated long source.");
      const fixtures = [
        {
          source: createUploadSource("uploads/_knowledge-ingest/batch-1/article.md", file),
          reference: "uploads/_knowledge-ingest/batch-1/article.md",
          path: "docs/imports/knowledge-ingest-batch-1-article.md",
        },
        {
          source: createUploadSource("uploads/_knowledge-ingest/batch-2/article.md", file),
          reference: "uploads/_knowledge-ingest/batch-1/article.md",
          path: "docs/imports/knowledge-ingest-batch-1-article-12.md",
        },
        {
          source: createUploadSource("uploads/_knowledge-ingest/batch-2/article.md", file),
          reference: "article.md",
          resource: "article.md",
          path: "docs/imports/knowledge-ingest-batch-1-article.md",
        },
        {
          source: createUploadSource("uploads/_knowledge-ingest/batch-1/日本.md", file),
          reference: "uploads/_knowledge-ingest/batch-1/日本.md",
          path: "docs/imports/knowledge-ingest-batch-1.md",
        },
        {
          source: createUploadSource(
            "uploads/_knowledge-ingest/batch-1/chat-11111111-2222-3333-4444-555555555555-1700000000000-xyz99-article.md",
            file,
          ),
          reference:
            "uploads/_knowledge-ingest/batch-1/chat-11111111-2222-3333-4444-555555555555-1700000000000-xyz99-article.md",
          path: "docs/imports/knowledge-ingest-batch-1-article.md",
        },
        {
          source: createLocalSource(longFile),
          reference: longFile,
          path: `docs/imports/${longName}.md`,
        },
        {
          source: createUploadSource("uploads/index.md", file),
          reference: "uploads/index.md",
          path: "docs/imports/index.md",
        },
      ];
      for (const fixture of fixtures) {
        const content = [
          "---",
          'type: "Generated Document"',
          `source: ${JSON.stringify(fixture.reference)}`,
          ...(fixture.resource === undefined
            ? []
            : [`resource: ${JSON.stringify(fixture.resource)}`]),
          'source_type: "md"',
          `generated: ${
            JSON.stringify({
              by: "veryfront/0.1.0",
              ...(fixture.source.kind === "upload" && fixture.resource === undefined
                ? { source_key: buildKnowledgeIngestIdentity(fixture.source).sourceKey }
                : {}),
            })
          }`,
          "---",
          "Original body.",
        ].join("\n");
        const remote = new Map([[fixture.path, { content, versionId: "legacy-version" }]]);
        const reads: string[] = [];
        const writes: unknown[] = [];
        const client = createMockClient({
          get: async (url, params) => {
            assertEquals(url, "/projects/my-project/files");
            assertEquals(params?.ref, "branch:selected");
            assertEquals(params?.fields, "(path)");
            assertEquals(params?.limit, "100");
            const pattern = params?.pattern;
            assert(pattern);
            const matcher = new RegExp(`^${pattern.replaceAll(".", "\\.").replaceAll("*", ".*")}$`);
            return {
              data: [...remote.keys()].filter((path) => matcher.test(path)).map((path) => ({
                path,
              })),
              page_info: { next: null },
            };
          },
        });
        const ingest = () =>
          ingestResolvedSources(
            [fixture.source],
            createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
            {
              client,
              projectSlug: "my-project",
              outputDir: join(tempDir, "generated"),
              runParser: runKnowledgeParser,
              findRemoteKnowledgeSource: async () => {
                throw new Error("Custom paths cannot use the canonical catalog");
              },
              listRemoteKnowledgeSuffixPaths: (stem) =>
                listRemoteKnowledgeSuffixPaths({
                  client,
                  projectSlug: "my-project",
                  branch: "selected",
                  stem,
                }),
              readRemoteKnowledgeFile: async (path) => {
                reads.push(path);
                return remote.get(path);
              },
              uploadKnowledgeFile: async (path, file, _metadata, _kind, expected) => {
                writes.push({ path, expected });
                remote.set(path, {
                  content: await Deno.readTextFile(file),
                  versionId: "updated-version",
                });
                return { path };
              },
            },
          );
        const result = await ingest();
        if (fixture.resource !== undefined) {
          assertEquals(result.failed.length, 1);
          assert(result.failed[0]?.message?.includes("origin is ambiguous"));
          assertEquals(writes, []);
          assertEquals(remote.get(fixture.path), { content, versionId: "legacy-version" });
          continue;
        }
        assertEquals(result.failed, [], fixture.path);
        assertEquals([...remote.keys()], [fixture.path]);
        assertEquals(writes, [{ path: fixture.path, expected: { versionId: "legacy-version" } }]);
        assert(reads.length <= 4, JSON.stringify(reads));
        writes.length = 0;
        if (
          fixture.source.kind === "upload" &&
          fixture.source.uploadPath.includes("/_knowledge-ingest/")
        ) {
          fixture.source.uploadPath = fixture.source.uploadPath.replace(
            /\/_knowledge-ingest\/[^/]+\//,
            "/_knowledge-ingest/next-batch/",
          );
          fixture.source.input = fixture.source.uploadPath;
        }
        const repeated = await ingest();
        assertEquals(repeated.failed, [], fixture.path);
        assertEquals([...remote.keys()], [fixture.path]);
        assertEquals(writes, [{ path: fixture.path, expected: { versionId: "updated-version" } }]);
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("rejects incomplete or ambiguous historical custom ownership without publishing", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-legacy-guards-" });
    try {
      const file = join(tempDir, "article.md");
      await Deno.writeTextFile(file, "# Article\n\nUpdated body.");
      for (
        const failure of [
          "partial",
          "ambiguous",
          "malformed",
          "missing-version",
          "missing-listing",
          "null-resource",
          "invalid-key",
        ] as const
      ) {
        const content =
          '---\nsource: "uploads/_knowledge-ingest/old/article.md"\ngenerated: { by: "veryfront/0.1.0" }\n---\nOriginal body.';
        const path = "docs/imports/knowledge-ingest-old-article.md";
        const storedContent = failure === "malformed"
          ? "---\nsource: [\n---\n"
          : failure === "null-resource"
          ? content.replace("source:", "resource: null\nsource:")
          : failure === "invalid-key"
          ? content.replace('by: "veryfront/0.1.0"', 'by: "veryfront/0.1.0", source_key: 42')
          : content;
        const remote = new Map([
          [path, {
            content: storedContent,
            versionId: failure === "missing-version" ? undefined : "version-old",
          }],
          ...(failure === "ambiguous"
            ? [
              ["docs/imports/knowledge-ingest-other-article.md", {
                content: content.replace("/old/", "/other/"),
                versionId: "version-other",
              }] as const,
            ]
            : []),
        ]);
        let writes = 0;
        const result = await ingestResolvedSources(
          [createUploadSource("uploads/_knowledge-ingest/new/article.md", file)],
          createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
          {
            client: createMockClient(),
            projectSlug: "my-project",
            outputDir: join(tempDir, "generated"),
            runParser: runKnowledgeParser,
            ...(failure === "missing-listing" ? {} : {
              listRemoteKnowledgeSuffixPaths: async () =>
                failure === "partial" ? undefined : new Set(remote.keys()),
            }),
            readRemoteKnowledgeFile: async (path) => remote.get(path),
            uploadKnowledgeFile: async (path) => {
              writes++;
              return { path };
            },
          },
        );
        assertEquals(result.ingested, [], failure);
        assertEquals(result.failed.length, 1, failure);
        assertEquals(writes, 0, failure);
        assertEquals(
          remote.get(path)?.content,
          storedContent,
        );
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("does not adopt an unrelated local origin or conflicting typed key at a historical custom name", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-legacy-origin-" });
    try {
      const file = join(tempDir, "index.md");
      await Deno.writeTextFile(file, "# Index\n\nIncoming upload.");
      for (
        const generated of [{ by: "veryfront/0.1.0" }, {
          by: "veryfront/0.1.0",
          source_key: '["local","uploads/index.md"]',
        }]
      ) {
        const content = `---\nsource: index.md\ngenerated: ${
          JSON.stringify(generated)
        }\n---\nLocal original.`;
        const remote = new Map([["docs/imports/index.md", {
          content,
          versionId: "local-version",
        }]]);
        const result = await ingestResolvedSources(
          [createUploadSource("uploads/index.md", file)],
          createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
          {
            client: createMockClient(),
            projectSlug: "my-project",
            outputDir: join(tempDir, "generated"),
            runParser: runKnowledgeParser,
            listRemoteKnowledgeSuffixPaths: async () => new Set(),
            readRemoteKnowledgeFile: async (path) => remote.get(path),
            uploadKnowledgeFile: async (path, file, _metadata, _kind, expected) => {
              assertEquals(
                path,
                await buildCustomKnowledgePath(
                  createUploadSource("uploads/index.md"),
                  "docs/imports",
                ),
              );
              assertEquals(expected, { absent: true });
              remote.set(path, {
                content: await Deno.readTextFile(file),
                versionId: "upload-version",
              });
              return { path };
            },
          },
        );
        assertEquals(result.failed, []);
        assertEquals(remote.size, 2);
        assertEquals(remote.get("docs/imports/index.md"), { content, versionId: "local-version" });
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("rejects a staged upload at a custom destination with ambiguous historical origin", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-ambiguous-source-" });
    try {
      const filePath = join(tempDir, "article.md");
      await Deno.writeTextFile(filePath, "# Different title\n\nRemote upload body.");
      const path = "docs/imports/article.md";
      const original = [
        "---",
        "type: Document",
        "resource: article.md",
        "source: article.md",
        "generated:",
        '  by: "veryfront/0.1.0"',
        "---",
        "Local original body.",
      ].join("\n");
      const remote = new Map([[path, original]]);
      const result = await ingestResolvedSources(
        [createUploadSource("uploads/_knowledge-ingest/batch/article.md", filePath)],
        createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
        {
          client: createMockClient(),
          projectSlug: "my-project",
          outputDir: join(tempDir, "generated"),
          runParser: runKnowledgeParser,
          listRemoteKnowledgeSuffixPaths: async () => new Set(),
          readRemoteKnowledgeFile: async (candidate) => {
            const content = remote.get(candidate);
            return content === undefined ? undefined : { content, versionId: path };
          },
          uploadKnowledgeFile: async (candidate, file) => {
            remote.set(candidate, await Deno.readTextFile(file));
            return { path: candidate };
          },
        },
      );
      assertEquals(result.ingested, []);
      assertEquals(result.failed.length, 1);
      const failure = result.failed[0];
      assert(failure);
      assertStringIncludes(failure.message, "source origin is ambiguous");
      assertEquals([...remote], [[path, original]]);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("leaves room for the longest suffix on flattened custom source names", async () => {
    const prefix = `uploads/${"a".repeat(100)}/${"b".repeat(100)}/${"c".repeat(100)}`;
    const first = createUploadSource(`${prefix}/one.md`);
    const second = createUploadSource(`${prefix}/two.md`);
    const slug = await buildCustomKnowledgeSlug(first);
    assertEquals(await buildCustomKnowledgeSlug(first), slug);
    assert(slug !== await buildCustomKnowledgeSlug(second));
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-slug-limit-" });
    try {
      const filename = `${slug}-source-${"d".repeat(16)}.md`;
      assert(new TextEncoder().encode(filename).length <= 255);
      const path = join(tempDir, filename);
      await Deno.writeTextFile(path, "content");
      assertEquals(await Deno.readTextFile(path), "content");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("omits absolute Windows and UNC directories from custom filenames", async () => {
    for (
      const path of [
        "C:/Users/Example/project/guide.md",
        String.raw`C:\Users\Example\project\guide.md`,
        String.raw`\\development\project\guide.md`,
      ]
    ) {
      assertEquals(await buildCustomKnowledgeSlug(createLocalSource(path)), "guide");
    }
  });

  it("reuses a staged source at its custom destination across Studio batches", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-batch-path-" });
    try {
      const filePath = join(tempDir, "guide.md");
      await Deno.writeTextFile(filePath, "# Overview\n\nOriginal guide.");
      const remote = new Map<string, { content: string; versionId: string }>();
      const guards: unknown[] = [];
      const ingest = (batch: string) =>
        ingestResolvedSources(
          [createUploadSource(`uploads/_knowledge-ingest/${batch}/area/guide.md`, filePath)],
          createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
          {
            client: createMockClient(),
            projectSlug: "my-project",
            outputDir: join(tempDir, batch),
            runParser: runKnowledgeParser,
            listRemoteKnowledgeSuffixPaths: async () => new Set(remote.keys()),
            readRemoteKnowledgeFile: async (path) => remote.get(path),
            uploadKnowledgeFile: async (path, file, _metadata, _kind, expected) => {
              guards.push(expected);
              remote.set(path, { content: await Deno.readTextFile(file), versionId: batch });
              return { path };
            },
          },
        );
      const first = await ingest("first");
      await Deno.writeTextFile(filePath, "# New overview\n\nUpdated guide.");
      const second = await ingest("second");
      const path = await buildCustomKnowledgePath(
        createUploadSource("uploads/_knowledge-ingest/first/area/guide.md"),
        "docs/imports",
      );
      assertEquals(first.failed, []);
      assertEquals(second.failed, []);
      assertEquals(first.ingested.map(({ remotePath }) => remotePath), [path]);
      assertEquals(second.ingested.map(({ remotePath }) => remotePath), [path]);
      assertEquals(guards, [{ absent: true }, { versionId: "first" }]);
      assertEquals(remote.size, 1);
      assertStringIncludes(remote.get(path)?.content ?? "", "Updated guide.");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("keeps generated index and log sources as concepts at custom destinations", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-reserved-custom-" });
    try {
      const sources = [];
      for (const name of ["index", "log"]) {
        const path = join(tempDir, `${name}.md`);
        await Deno.writeTextFile(path, `# ${name}\n\nDocument body.`);
        sources.push(createUploadSource(`uploads/${name}.md`, path));
      }
      const remote = new Map<string, string>();
      const result = await ingestResolvedSources(
        sources,
        createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
        {
          client: createMockClient(),
          projectSlug: "my-project",
          outputDir: join(tempDir, "generated"),
          runParser: runKnowledgeParser,
          listRemoteKnowledgeSuffixPaths: async () => new Set(),
          readRemoteKnowledgeFile: async () => undefined,
          uploadKnowledgeFile: async (path, file) => {
            remote.set(path, await Deno.readTextFile(file));
            return { path };
          },
        },
      );
      assertEquals(result.failed, []);
      assertEquals(
        [...remote.keys()],
        await Promise.all(
          sources.map((source) => buildCustomKnowledgePath(source, "docs/imports")),
        ),
      );
      for (const [path, content] of remote) {
        const document = inspectOkfDocument(path, content, { bundleRoot: "docs/imports" });
        assertEquals(document.kind, "concept");
        assertEquals(document.envelopeConforms, true);
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("admits one first publication when the same source arrives with different titles", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-source-claim-" });
    const writes: string[] = [];
    const committed = new Set<string>();
    const bothLookups = Promise.withResolvers<void>();
    let lookupCount = 0;
    try {
      const ingest = async (title: string) => {
        const localPath = join(tempDir, `${title}.md`);
        await Deno.writeTextFile(localPath, `# ${title}\n\nContent.`);
        return ingestResolvedSources(
          [createUploadSource("uploads/same-source.md", localPath)],
          createKnowledgeCommandArgs(),
          {
            client: createMockClient(),
            projectSlug: "my-project",
            outputDir: join(tempDir, title),
            runParser: runKnowledgeParser,
            findRemoteKnowledgeSource: async () => {
              if (++lookupCount === 2) bothLookups.resolve();
              await bothLookups.promise;
              return undefined;
            },
            indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
            uploadKnowledgeFile: async (path, _local, _metadata, _kind, expected) => {
              writes.push(path);
              assertEquals(expected, { absent: true });
              if (committed.has(path)) {
                throw Object.assign(new Error("Already created"), { status: 409 });
              }
              committed.add(path);
              return { path };
            },
          },
        );
      };
      const results = await Promise.all([ingest("First title"), ingest("Second title")]);
      assertEquals(writes.length, 2);
      assertEquals(committed.size, 1);
      assertEquals(results.flatMap((result) => result.ingested).length, 1);
      assertEquals(results.flatMap((result) => result.failed).length, 1);
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("reuses existing remote paths when same-title sources arrive in reverse order", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-remote-suffix-" });
    const a = join(tempDir, "a.md");
    const b = join(tempDir, "b.md");
    const writes: unknown[] = [];
    const remote = new Map([
      ["knowledge/overview.md", "uploads/a.md"],
      ["knowledge/overview-2.md", "uploads/b.md"],
    ]);
    try {
      await Deno.writeTextFile(a, "# Overview\n\nFirst source.");
      await Deno.writeTextFile(b, "# Overview\n\nSecond source.");
      const result = await ingestResolvedSources(
        [createUploadSource("uploads/b.md", b), createUploadSource("uploads/a.md", a)],
        createKnowledgeCommandArgs(),
        {
          client: createMockClient(),
          projectSlug: "my-project",
          outputDir: join(tempDir, "output"),
          runParser: runKnowledgeParser,
          readRemoteKnowledgeFile: async (path) => {
            const resource = remote.get(path);
            if (!resource) return undefined;
            return { content: `---\nresource: ${resource}\n---\n`, versionId: resource };
          },
          indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
          uploadKnowledgeFile: async (path, _local, _metadata, _kind, expected) => {
            writes.push({ path, expected });
            return { path };
          },
        },
      );
      assertEquals(result.failed, []);
      assertEquals(result.ingested.map((item) => item.slug), ["overview-2", "overview"]);
      assertEquals(writes, [
        { path: "knowledge/overview-2.md", expected: { versionId: "uploads/b.md" } },
        { path: "knowledge/overview.md", expected: { versionId: "uploads/a.md" } },
      ]);
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("allocates more than 100 same-title paths and preserves a retained suffix after deletion", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-remote-many-" });
    const remote = new Map<string, string>();
    let reads = 0;
    const deps: Parameters<typeof ingestResolvedSources>[2] = {
      client: createMockClient(),
      projectSlug: "my-project",
      outputDir: join(tempDir, "output"),
      runParser: runKnowledgeParser,
      readRemoteKnowledgeFile: async (path: string) => {
        reads += 1;
        const content = remote.get(path);
        return content === undefined ? undefined : { content, versionId: path };
      },
      indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
      uploadKnowledgeFile: async (path: string, local: string) => {
        remote.set(path, await Deno.readTextFile(local));
        return { path };
      },
    };
    try {
      const sources = [];
      for (let index = 1; index <= 101; index += 1) {
        const name = `source-${index}.md`;
        const path = join(tempDir, name);
        await Deno.writeTextFile(path, "# Overview\n\nText.");
        sources.push(createUploadSource(`uploads/${name}`, path));
      }
      const args = createKnowledgeCommandArgs();
      const initial = await ingestResolvedSources(sources, args, deps);
      assertEquals(initial.failed, []);
      assertEquals(remote.size, 101);
      assertEquals(reads, 201);

      const original = remote.get("knowledge/overview.md");
      assert(original);
      remote.delete("knowledge/overview.md");
      const updated = await ingestResolvedSources(sources.slice(1, 2), args, deps);
      assertEquals(updated.failed, []);
      assertEquals(updated.ingested.map((item) => item.remotePath), ["knowledge/overview-2.md"]);
      assertEquals(remote.size, 100);
      assertEquals(remote.has("knowledge/overview.md"), false);

      remote.set("knowledge/overview.md", original);
      const latePath = join(tempDir, "late.md");
      await Deno.writeTextFile(latePath, "# Overview\n\nLate source.");
      const lateSource = createUploadSource("uploads/late.md", latePath);
      const freshDeps = { ...deps, outputDir: join(tempDir, "fresh") };
      const added = await ingestResolvedSources([lateSource], args, freshDeps);
      assertEquals(added.failed, []);
      const [result] = added.ingested;
      assert(result);
      assertStringIncludes(result.remotePath, "knowledge/overview-source-");
      const retried = await ingestResolvedSources([lateSource], args, freshDeps);
      assertEquals(retried.failed, []);
      assertEquals(retried.ingested.map(({ remotePath }) => remotePath), [result.remotePath]);
      assertEquals(remote.size, 102);
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("adds a short suffix instead of overwriting another source's knowledge file", async () => {
    const remote: Record<string, string> = {
      "knowledge/contracts-q1.md": '---\ntype: "Document"\nresource: "uploads/other/q1.pdf"\n---\n',
      "knowledge/contracts-q1-2.md": '---\ntype: "Document"\nresource: "q1.pdf"\n---\n',
    };
    const reads: string[] = [];
    const writes: unknown[] = [];
    const result = await ingestResolvedSources(
      [createUploadSource("uploads/contracts/q1.pdf")],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async () => createParserSuccess(),
        readRemoteKnowledgeFile: async (path) => {
          reads.push(path);
          const content = remote[path];
          return content === undefined ? undefined : { content, versionId: "v-other" };
        },
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath, _local, _metadata, _kind, expected) => {
          writes.push({ remotePath, expected });
          return { path: remotePath };
        },
      },
    );

    assertEquals(reads, [
      "knowledge/contracts-q1.md",
      "knowledge/contracts-q1-2.md",
      "knowledge/contracts-q1-3.md",
    ]);
    assertEquals(writes, [{
      remotePath: "knowledge/contracts-q1-3.md",
      expected: { absent: true },
    }]);
    assertEquals(result.ingested[0]?.slug, "contracts-q1-3");
  });

  it("updates the knowledge file it already wrote for the same source at that version", async () => {
    const writes: unknown[] = [];
    const result = await ingestResolvedSources(
      [createUploadSource("uploads/contracts/q1.pdf")],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async () => createParserSuccess(),
        readRemoteKnowledgeFile: async () => ({
          content: '---\ntype: "Document"\nresource: "uploads/contracts/q1.pdf"\n---\n',
          versionId: "v-1",
        }),
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath, _local, _metadata, _kind, expected) => {
          writes.push({ remotePath, expected });
          return { path: remotePath };
        },
      },
    );

    assertEquals(result.ingested[0]?.remotePath, "knowledge/contracts-q1.md");
    assertEquals(writes, [{
      remotePath: "knowledge/contracts-q1.md",
      expected: { versionId: "v-1" },
    }]);
  });

  it("updates a legacy knowledge file at its current version", async () => {
    const writes: unknown[] = [];
    const result = await ingestResolvedSources(
      [createUploadSource("uploads/contracts/q1.pdf")],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async () => createParserSuccess(),
        readRemoteKnowledgeFile: async () => ({
          content: '---\ntype: "Generated Document"\nsource: "uploads/contracts/q1.pdf"\n---\n',
          versionId: "v-1",
        }),
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath, _local, _metadata, _kind, expected) => {
          writes.push({ remotePath, expected });
          return { path: remotePath };
        },
      },
    );

    assertEquals(result.ingested[0]?.remotePath, "knowledge/contracts-q1.md");
    assertEquals(writes, [{
      remotePath: "knowledge/contracts-q1.md",
      expected: { versionId: "v-1" },
    }]);
  });

  it("fails instead of overwriting a newer write of the same source", async () => {
    const writes: string[] = [];
    const result = await ingestResolvedSources(
      [createUploadSource("uploads/contracts/q1.pdf")],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async () => createParserSuccess(),
        readRemoteKnowledgeFile: async () => ({
          content: '---\nresource: "uploads/contracts/q1.pdf"\n---\n',
          versionId: "v-1",
        }),
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath) => {
          writes.push(remotePath);
          throw Object.assign(new Error("File has been modified since it was read"), {
            status: 409,
          });
        },
      },
    );

    assertEquals(writes, ["knowledge/contracts-q1.md"]);
    assertEquals(result.ingested, []);
    assertEquals(result.failed.length, 1);
  });

  it("chooses again when another run takes the path between the read and the write", async () => {
    const remote = new Map<string, string>();
    const writes: string[] = [];
    const result = await ingestResolvedSources(
      [createUploadSource("uploads/contracts/q1.pdf")],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async () => createParserSuccess(),
        readRemoteKnowledgeFile: async (path) => {
          const content = remote.get(path);
          return content === undefined ? undefined : { content, versionId: "v-other" };
        },
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath, _local, _metadata, _kind, expected) => {
          writes.push(remotePath);
          if (remotePath === "knowledge/contracts-q1.md") {
            assertEquals(expected, { absent: true });
            remote.set(remotePath, '---\nresource: "uploads/other/q1.pdf"\n---\n');
            throw Object.assign(new Error("File was created after absence was observed"), {
              status: 409,
            });
          }
          return { path: remotePath };
        },
      },
    );

    assertEquals(result.failed, []);
    assertEquals(writes, ["knowledge/contracts-q1.md", "knowledge/contracts-q1-2.md"]);
    assertEquals(result.ingested[0]?.remotePath, "knowledge/contracts-q1-2.md");
  });

  it("uses one custom source path when a competing base document disappears between claims", async () => {
    const source = createUploadSource("uploads/a/b.md", "b.md");
    const identity = buildKnowledgeIngestIdentity(source);
    const base = "docs/imports/a-b.md";
    const remote = new Map([[base, {
      content:
        '---\nresource: "other.md"\ngenerated: {source_key: "local:other.md", by: "knowledge-ingest"}\n---\n',
      versionId: "other-version",
    }]]);
    const claim = () =>
      claimGeneratedKnowledgePath({
        remotePath: base,
        resource: identity.resource,
        sourceKey: identity.sourceKey,
        sourceKind: "upload",
        customSource: source,
        legacySource: source.input,
        scanSuffixGaps: true,
        absenceConflicts: new Map(),
        listSuffixPaths: async (stem) =>
          new Set([...remote.keys()].filter((path) => path.startsWith(stem))),
        readRemoteFile: async (path) => remote.get(path),
      });
    const beforeDeletion = await claim();
    remote.delete(base);
    const afterDeletion = await claim();
    const expectedPath = await buildCustomKnowledgePath(source, "docs/imports");
    assertEquals(beforeDeletion, { remotePath: expectedPath, expected: { absent: true } });
    assertEquals(afterDeletion, beforeDeletion);
    let admitted = 0;
    for (const candidate of [beforeDeletion, afterDeletion]) {
      if (!remote.has(candidate.remotePath)) {
        remote.set(candidate.remotePath, {
          content: `---\nresource: ${JSON.stringify(identity.resource)}\ngenerated: ${
            JSON.stringify({ source_key: identity.sourceKey, by: "knowledge-ingest" })
          }\n---\n`,
          versionId: "winner-version",
        });
        admitted++;
      }
    }
    assertEquals(admitted, 1);
    assertEquals(await claim(), {
      remotePath: expectedPath,
      expected: { versionId: "winner-version" },
    });
  });

  it("fails closed on exhausted custom probes before duplicating a high-suffix owner", async () => {
    const source = createUploadSource("uploads/a/b.md", "b.md");
    const identity = buildKnowledgeIngestIdentity(source);
    const stablePath = await buildCustomKnowledgePath(source, "docs/imports");
    const foreign = {
      content:
        '---\nresource: "other.md"\ngenerated: {source_key: "other-source", by: "veryfront/0.1.0"}\n---\n',
      versionId: "foreign-version",
    };
    const owner = {
      content: `---\nresource: ${JSON.stringify(identity.resource)}\ngenerated: ${
        JSON.stringify({ source_key: identity.sourceKey, by: "veryfront/0.1.0" })
      }\n---\n`,
      versionId: "owner-version",
    };
    for (const complete of [true, false]) {
      let listings = 0;
      let writes = 0;
      const result = await ingestResolvedSources(
        [source],
        createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
        {
          client: createMockClient(),
          projectSlug: "my-project",
          outputDir: "/workspace/knowledge",
          runParser: async () => createParserSuccess(),
          readRemoteKnowledgeFile: async (path) =>
            path === stablePath ? undefined : path === "docs/imports/a-b-151.md" ? owner : foreign,
          listRemoteKnowledgeSuffixPaths: async () => {
            listings++;
            return complete
              ? new Set([
                "docs/imports/a-b.md",
                ...Array.from({ length: 99 }, (_, index) => `docs/imports/a-b-${index + 2}.md`),
                "docs/imports/a-b-151.md",
              ])
              : undefined;
          },
          uploadKnowledgeFile: async (path) => {
            writes++;
            return { path };
          },
        },
      );
      assertEquals(result.ingested, []);
      assertEquals(result.failed.length, 1);
      assertEquals(listings, 1);
      assertEquals(writes, 0);
      assertStringIncludes(
        result.failed[0]!.message,
        complete ? "Too many knowledge paths" : "complete path listing",
      );
    }
  });

  it("does not recreate a deleted custom conflict winner on retry", async () => {
    let writes = 0;
    const result = await ingestResolvedSources(
      [createUploadSource("uploads/a/b.md", "b.md")],
      createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async () => createParserSuccess(),
        listRemoteKnowledgeSuffixPaths: async () => new Set(),
        readRemoteKnowledgeFile: async () => undefined,
        uploadKnowledgeFile: async (path) => {
          writes++;
          if (writes === 1) {
            throw Object.assign(new Error("Concurrent custom write"), {
              status: 409,
            });
          }
          return { path };
        },
      },
    );
    assertEquals(writes, 1);
    assertEquals(result.ingested, []);
    assertEquals(result.failed.length, 1);
    assertStringIncludes(result.failed[0]!.message, "Concurrent custom write");
  });

  it("keeps the winner when the same source claims an absent path concurrently", async () => {
    const remote = new Map<string, string>();
    const writes: string[] = [];
    const result = await ingestResolvedSources(
      [createUploadSource("uploads/contracts/q1.pdf")],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async () => createParserSuccess(),
        readRemoteKnowledgeFile: async (path) => {
          const content = remote.get(path);
          return content === undefined ? undefined : { content, versionId: "v-other" };
        },
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath, _local, _metadata, _kind, expected) => {
          writes.push(remotePath);
          if (remotePath === "knowledge/contracts-q1.md") {
            assertEquals(expected, { absent: true });
            remote.set(remotePath, '---\nresource: "uploads/contracts/q1.pdf"\n---\n');
            throw Object.assign(new Error("File was created after absence was observed"), {
              status: 409,
            });
          }
          return { path: remotePath };
        },
      },
    );

    assertEquals(result.failed.length, 1);
    assertEquals(writes, ["knowledge/contracts-q1.md"]);
    assertEquals(result.ingested, []);
  });

  it("preserves generic custom destinations without claiming a canonical knowledge index", async () => {
    for (const knowledgePath of ["knowledge", "docs/imports/acme", "knowledge-sibling"]) {
      let indexCalls = 0;
      const result = await ingestResolvedSources(
        [createUploadSource("uploads/contracts/q1.pdf")],
        createKnowledgeCommandArgs({ knowledgePath }),
        {
          client: createMockClient(),
          projectSlug: "my-project",
          outputDir: "/workspace/knowledge",
          runParser: async () => createParserSuccess(),
          uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
          indexKnowledgeDocument: async (input) => {
            indexCalls++;
            return createIndexReceipt(input.published.path);
          },
        },
      );
      assertEquals(result.failed, []);
      assertEquals(result.ingested.length, 1);
      assertEquals(result.ingested[0]?.remotePath, `${knowledgePath}/contracts-q1.md`);
      assertEquals(indexCalls, knowledgePath === "knowledge" ? 1 : 0);
      assertEquals(result.ingested[0]?.canonicalIndex !== undefined, knowledgePath === "knowledge");
    }
  });

  it("indexes the selected branch while preserving runtime destination authority and main default", async () => {
    for (
      const { branch, destinationBranch, expected } of [
        { branch: "feature/docs", destinationBranch: undefined, expected: "feature/docs" },
        {
          branch: "feature/docs",
          destinationBranch: "runtime-preview",
          expected: "runtime-preview",
        },
        { branch: undefined, destinationBranch: undefined, expected: "main" },
      ]
    ) {
      const indexedBranches: string[] = [];
      const result = await ingestResolvedSources(
        [createUploadSource("uploads/contracts/q1.pdf")],
        createKnowledgeCommandArgs({ branch }),
        {
          client: createMockClient(),
          projectSlug: "my-project",
          outputDir: "/workspace/knowledge",
          destinationBranch,
          runParser: async () => createParserSuccess(),
          uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
          indexKnowledgeDocument: async (input) => {
            indexedBranches.push(input.branch);
            return createIndexReceipt(input.published.path);
          },
        },
      );
      assertEquals(result.failed, []);
      assertEquals(indexedBranches, [expected]);
    }
  });

  it("stops parsing and uploads when the run is cancelled", async () => {
    const controller = new AbortController();
    let parserCalls = 0;
    let uploadCalls = 0;

    await assertRejects(
      () =>
        ingestResolvedSources(
          [
            createUploadSource("uploads/contracts/q1.pdf"),
            createUploadSource("uploads/contracts/q2.pdf"),
          ],
          createKnowledgeCommandArgs(),
          {
            client: createMockClient(),
            projectSlug: "my-project",
            outputDir: "/workspace/knowledge",
            signal: controller.signal,
            runParser: async () => {
              parserCalls++;
              controller.abort(new Error("run cancelled"));
              return createParserSuccess();
            },
            indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
            uploadKnowledgeFile: async (remotePath) => {
              uploadCalls++;
              return { path: remotePath };
            },
          },
        ),
      Error,
      "run cancelled",
    );

    assertEquals(parserCalls, 1);
    assertEquals(uploadCalls, 0);
  });

  it("passes cancellation to extraction without an event logger", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel active extraction");
    let receivedSignal: AbortSignal | undefined;
    let uploadCalls = 0;
    await assertRejects(
      () =>
        ingestResolvedSources(
          [createUploadSource("uploads/report.pdf")],
          createKnowledgeCommandArgs(),
          {
            client: createMockClient(),
            projectSlug: "my-project",
            outputDir: "/workspace/knowledge",
            signal: controller.signal,
            runParser: async (_input, deps) => {
              receivedSignal = deps?.signal;
              assertEquals(receivedSignal, controller.signal);
              controller.abort(reason);
              receivedSignal?.throwIfAborted();
              return createParserSuccess();
            },
            indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
            uploadKnowledgeFile: async (remotePath) => {
              uploadCalls++;
              return { path: remotePath };
            },
          },
        ),
      Error,
      "cancel active extraction",
    );
    assertEquals(receivedSignal, controller.signal);
    assertEquals(uploadCalls, 0);
  });

  it("runs the parser and uploads knowledge markdown", async () => {
    const results = await ingestResolvedSources(
      [createUploadSource("uploads/contracts/q1.pdf")],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async () => createParserSuccess(),
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
      },
    );

    assertEquals(results, {
      ingested: [{
        canonicalIndex: createIndexReceipt("knowledge/contracts-q1.md"),
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

  it("uploads OKF bundle-root metadata for custom knowledge prefixes", async () => {
    const uploads: Array<{ remotePath: string; metadata?: Record<string, unknown> }> = [];

    const results = await ingestResolvedSources(
      [{
        kind: "local",
        input: "/workspace/acme/index.md",
        localPath: "/workspace/acme/index.md",
      }],
      createKnowledgeCommandArgs({
        path: "/workspace/acme",
        all: true,
        outputDir: "/workspace/knowledge",
        knowledgePath: "knowledge/imports/acme",
        okfBundle: true,
      }),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async () =>
          createParserSuccess({
            sandbox_output_path: "/workspace/knowledge/index.md",
          }),
        uploadKnowledgeFile: async (remotePath, _localPath, metadata) => {
          uploads.push({ remotePath, metadata });
          return { path: remotePath };
        },
      },
    );

    assertEquals(results.failed, []);
    assertEquals(uploads, [{
      remotePath: "knowledge/imports/acme/index.md",
      metadata: { _veryfront: { okf: { bundle_root_path: "knowledge/imports/acme" } } },
    }]);
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
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
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
        source_ordinal: 1,
        source_count: 2,
        source_type: "pdf",
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
        source_ordinal: 1,
        source_count: 2,
        source_type: "pdf",
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
        source_ordinal: 2,
        source_count: 2,
        source_type: "pptx",
        slide_current: 1,
        slide_total: 1,
        characters: 80,
        source_name: "roadmap.pptx",
      },
    ]);
  });

  it("logs parser-start progress before invoking the parser without claiming a real parser callback", async () => {
    const events: LoggedEvent[] = [];
    let parserCalled = false;

    await ingestResolvedSources(
      [createUploadSource("uploads/manuals/bosch.pdf")],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async () => {
          const parserStart = events.find((event) =>
            event.message === "Starting knowledge source parser"
          );
          assertEquals(parserStart?.metadata, {
            phase: "parser_started_pre_call",
            progress_unit: "file",
            progress_current: 1,
            progress_total: 1,
            source_ordinal: 1,
            source_count: 1,
            source_type: "pdf",
            source_name: "bosch.pdf",
          });
          parserCalled = true;
          return createParserSuccess();
        },
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
        eventLogger: createMemoryEventLogger(events),
      },
    );

    assertEquals(parserCalled, true);
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
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
      },
    );

    assertEquals(hasProgressCallback, false);
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
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
      },
    );

    assertEquals(results.ingested, [{
      canonicalIndex: createIndexReceipt("knowledge/run-benchmark.md"),
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
            slug: "run-benchmark",
            sandbox_output_path: "/workspace/knowledge/run-benchmark.md",
            suggested_project_path: "knowledge/run-benchmark.md",
            description: "Parsed from run_benchmark.py",
            title: "Run Benchmark",
            summary: "Parsed as text.",
            stats: { lines: 1 },
            warnings: [],
          };
        },
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
      },
    );

    assertEquals(calls, [
      "/workspace/contracts/broken.pdf",
      "/workspace/contracts/run_benchmark.py",
    ]);
    assertEquals(results.ingested, [{
      canonicalIndex: createIndexReceipt("knowledge/run-benchmark.md"),
      source: "/workspace/contracts/run_benchmark.py",
      localSourcePath: "/workspace/contracts/run_benchmark.py",
      outputPath: "/workspace/knowledge/run-benchmark.md",
      remotePath: "knowledge/run-benchmark.md",
      slug: "run-benchmark",
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
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
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
            indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
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

describe("buildKnowledgeResource", () => {
  it("preserves local paths that resemble the remote upload staging folder", () => {
    const path = "uploads/_knowledge-ingest/batch-1/brief.pdf";
    assertEquals(buildKnowledgeResource(createLocalSource(path)), path);
  });

  it("uses the path the user uploaded, not the Studio ingest staging folder", () => {
    assertEquals(
      buildKnowledgeResource(
        createUploadSource("uploads/_knowledge-ingest/20261110201703921-e763c00b/guides/a b.md"),
      ),
      "guides/a b.md",
    );
    assertEquals(
      buildKnowledgeResource(createUploadSource("_knowledge-ingest/batch-1/brief.pdf")),
      "brief.pdf",
    );
  });

  it("keeps other upload paths and local paths", () => {
    assertEquals(
      buildKnowledgeResource(createUploadSource("contracts/q1.pdf")),
      "uploads/contracts/q1.pdf",
    );
    assertEquals(
      buildKnowledgeResource(createLocalSource("/workspace/docs/a.md")),
      "/workspace/docs/a.md",
    );
  });
});

it("collects hidden OKF upload Markdown without downloading viewer artifacts", async () => {
  const paths = ["uploads/.bundle/index.md", "uploads/.bundle/.catalog/topic.md"];
  const calls: string[][] = [];
  const collection = await collectKnowledgeSources(
    { sources: [], path: "uploads/.bundle", all: true, recursive: true, okfBundle: true },
    {
      client: createMockClient({
        get: () =>
          Promise.resolve({
            data: [...paths, "uploads/.bundle/viz.html"].map((path) => ({ type: "file", path })),
            page_info: { next: null },
          }),
      }),
      projectSlug: "my-project",
      downloadUploads: createDownloadUploadsStub(calls),
    },
  );
  assertEquals(calls, [paths]);
  assertEquals(
    collection.sources.map((source) => source.localPath),
    paths.map((path) => `/workspace/${path}`),
  );
  assertEquals(collection.skipped.length, 1);
  assertEquals(collection.skipped[0]?.source, "uploads/.bundle/viz.html");
});

it("retains skipped-only prefix results without retrying a directory prefix", async () => {
  let calls = 0;
  const collection = await collectKnowledgeSources(
    { sources: [], path: "uploads/docs", all: true, recursive: true, okfBundle: false },
    {
      client: createMockClient({
        get: () => {
          calls++;
          return Promise.resolve({
            data: [{ type: "file", path: "uploads/docs/archive.zip" }],
            page_info: { next: null },
          });
        },
      }),
      projectSlug: "my-project",
      downloadUploads: async () => {
        throw new Error("must not download unsupported files");
      },
    },
  );
  assertEquals(calls, 1);
  assertEquals(collection.sources, []);
  assertEquals(collection.skipped.map((source) => source.reason), ["unsupported_file_type"]);
});

it("collects Markdown in hidden OKF roots and directories", async () => {
  const tempDir = await makeTempDir({ prefix: "veryfront-okf-hidden-" });
  const root = join(tempDir, ".bundle");
  const paths = ["index.md", ".catalog/topic.md", ".hidden.md"];
  try {
    for (const path of paths) {
      await Deno.mkdir(dirname(join(root, path)), { recursive: true });
      await Deno.writeTextFile(join(root, path), "# Authored document\n");
    }
    const collection = await collectKnowledgeSources(
      { sources: [], path: root, all: true, recursive: true, okfBundle: true },
      {
        client: createMockClient(),
        projectSlug: "my-project",
        downloadUploads: async () => {
          throw new Error("must not download local bundle files");
        },
      },
    );
    assertEquals(
      collection.sources.map((source) => source.localPath).sort(),
      paths.map((path) => join(root, path)).sort(),
    );
    assertEquals(collection.skipped, []);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

const canonicalGa4OkfDocuments: Array<{
  path: string;
  kind: "concept" | "index";
  source: string;
}> = [
  {
    path: "datasets/ga4_obfuscated_sample_ecommerce.md",
    kind: "concept",
    source: [
      "---",
      "type: BigQuery Dataset",
      "resource: https://bigquery.googleapis.com/v2/projects/bigquery-public-data/datasets/ga4_obfuscated_sample_ecommerce",
      "title: GA4 Obfuscated Sample Ecommerce Dataset",
      "extension:",
      "  nested: [one, two]",
      "generated:",
      "  by: reference_agent/gemini-3.5-flash",
      "  at: '2026-07-10T21:14:56+00:00'",
      "sources:",
      "- title: BigQuery Dataset Metadata for ga4_obfuscated_sample_ecommerce",
      "  id: ga4-metadata",
      "  resource: https://bigquery.googleapis.com/v2/projects/bigquery-public-data/datasets/ga4_obfuscated_sample_ecommerce",
      "---",
      "",
      "This dataset contains [events_](../tables/events_.md).",
      "",
      "[^ga4-demo-docs]: [Google Analytics 4 eCommerce Demo Dataset documentation](https://developers.google.com/analytics/bigquery/web-ecommerce-demo-dataset)",
      "",
    ].join("\n"),
  },
  {
    path: "datasets/index.md",
    kind: "index",
    source:
      "# Datasets\n\n* [ga4_obfuscated_sample_ecommerce](ga4_obfuscated_sample_ecommerce.md)\n",
  },
  {
    path: "index.md",
    kind: "index",
    source: [
      "# Subdirectories",
      "",
      "* [datasets](datasets/index.md) - Obfuscated Google Analytics 4 dataset.",
      "* [tables](tables/index.md) - Exported BigQuery tables.",
      "* [references](references/index.md) - Metrics and supporting references.",
      "",
    ].join("\n"),
  },
  {
    path: "references/index.md",
    kind: "index",
    source: "# References\n\n* [metrics](metrics/index.md)\n",
  },
  {
    path: "references/metrics/acquired_users.md",
    kind: "concept",
    source:
      "---\ntype: Metric\ntitle: Acquired users\n---\nAcquired users reference [events_](../../tables/events_.md).\n",
  },
  {
    path: "references/metrics/frequently_active_users.md",
    kind: "concept",
    source:
      "---\ntype: Metric\ntitle: Frequently active users\n---\nFrequently active users reference [events_](../../tables/events_.md).\n",
  },
  {
    path: "references/metrics/google_acquired_cohorts.md",
    kind: "concept",
    source:
      "---\ntype: Metric\ntitle: Google acquired cohorts\n---\nGoogle acquired cohorts reference [Acquired users](acquired_users.md).\n",
  },
  {
    path: "references/metrics/highly_active_users.md",
    kind: "concept",
    source:
      "---\ntype: Metric\ntitle: Highly active users\n---\nHighly active users reference [events_](../../tables/events_.md).\n",
  },
  {
    path: "references/metrics/index.md",
    kind: "index",
    source: [
      "# Metrics",
      "",
      "* [acquired_users](acquired_users.md)",
      "* [frequently_active_users](frequently_active_users.md)",
      "* [google_acquired_cohorts](google_acquired_cohorts.md)",
      "* [highly_active_users](highly_active_users.md)",
      "* [n_day_active_users](n_day_active_users.md)",
      "* [n_day_inactive_users](n_day_inactive_users.md)",
      "* [purchasers](purchasers.md)",
      "",
    ].join("\n"),
  },
  {
    path: "references/metrics/n_day_active_users.md",
    kind: "concept",
    source:
      "---\ntype: Metric\ntitle: N day active users\n---\nN day active users reference [events_](../../tables/events_.md).\n",
  },
  {
    path: "references/metrics/n_day_inactive_users.md",
    kind: "concept",
    source:
      "---\ntype: Metric\ntitle: N day inactive users\n---\nN day inactive users reference [events_](../../tables/events_.md).\n",
  },
  {
    path: "references/metrics/purchasers.md",
    kind: "concept",
    source:
      "---\ntype: Metric\ntitle: Purchasers\n---\nPurchasers reference [events_](../../tables/events_.md).\n",
  },
  {
    path: "tables/events_.md",
    kind: "concept",
    source:
      "---\ntype: BigQuery Table\ntitle: events_\n---\nEvent table for [GA4 dataset](../datasets/ga4_obfuscated_sample_ecommerce.md).\n",
  },
  {
    path: "tables/index.md",
    kind: "index",
    source: "# Tables\n\n* [events_](events_.md)\n",
  },
];

it("keeps the canonical 14-file GA4 OKF bundle paths and skips generated viewer artifacts", async () => {
  const tempDir = await makeTempDir({ prefix: "veryfront-okf-ga4-" });
  const bundleDir = join(tempDir, "ga4");
  const outputDir = join(tempDir, "out");
  const viewerPath = join(bundleDir, "viz.html");

  try {
    for (const document of canonicalGa4OkfDocuments) {
      const path = join(bundleDir, document.path);
      await Deno.mkdir(dirname(path), { recursive: true });
      await Deno.writeTextFile(path, document.source);
    }
    await Deno.writeTextFile(viewerPath, "<html>viewer</html>");

    const collection = await collectKnowledgeSources(
      createKnowledgeCommandArgs({ path: bundleDir, all: true, okfBundle: true }),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        downloadUploads: async () => {
          throw new Error("should not download local OKF fixtures");
        },
      },
    );
    assertEquals(
      collection.sources.map((source) => source.localPath.slice(bundleDir.length + 1)).sort(),
      canonicalGa4OkfDocuments.map((document) => document.path).sort(),
    );
    assertEquals(collection.skipped.map((skipped) => basename(skipped.source)), ["viz.html"]);

    const uploads: Array<
      { remotePath: string; content: string; metadata?: Record<string, unknown> }
    > = [];
    const results = await ingestResolvedSources(
      collection.sources,
      createKnowledgeCommandArgs({
        path: bundleDir,
        all: true,
        outputDir,
        okfBundle: true,
      }),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir,
        runParser: runKnowledgeParser,
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath, localPath, metadata) => {
          uploads.push({ remotePath, content: await Deno.readTextFile(localPath), metadata });
          return { path: remotePath };
        },
      },
    );

    assertEquals(
      uploads.map((upload) => upload.remotePath).sort(),
      canonicalGa4OkfDocuments.map((document) => `knowledge/${document.path}`).sort(),
    );
    assertEquals(
      uploads.every((upload) =>
        JSON.stringify(upload.metadata) ===
          JSON.stringify({ _veryfront: { okf: { bundle_root_path: "knowledge" } } })
      ),
      true,
    );
    for (const document of canonicalGa4OkfDocuments) {
      assertEquals(
        uploads.find((upload) => upload.remotePath === `knowledge/${document.path}`)?.content,
        document.source,
      );
    }
    assertEquals(results.ingested.length, 14);
    assertEquals(results.failed, []);
    assertEquals(
      results.ingested.filter((result) => result.documentKind === "okf_concept").length,
      9,
    );
    assertEquals(
      results.ingested.filter((result) => result.documentKind === "okf_index").length,
      5,
    );
    const dataset = results.ingested.find((result) => result.remotePath.includes("ga4_obfuscated"));
    assertEquals(dataset?.documentKind, "okf_concept");
    assertEquals(dataset?.okf?.metadata.extension, { nested: ["one", "two"] });
    assertEquals(dataset?.okf?.metadata.generated, {
      by: "reference_agent/gemini-3.5-flash",
      at: "2026-07-10T21:14:56+00:00",
    });
    assertEquals(dataset?.okf?.metadata.sources, [{
      title: "BigQuery Dataset Metadata for ga4_obfuscated_sample_ecommerce",
      id: "ga4-metadata",
      resource:
        "https://bigquery.googleapis.com/v2/projects/bigquery-public-data/datasets/ga4_obfuscated_sample_ecommerce",
    }]);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
  }
});

it("preserves accepted uppercase Markdown bundle extensions", async () => {
  const tempDir = await makeTempDir({ prefix: "veryfront-okf-uppercase-" });
  const bundleDir = join(tempDir, "bundle");
  const outputDir = join(tempDir, "out");
  const topicPath = join(bundleDir, "Concept.MD");
  const source = "---\ntype: Topic\ntitle: Uppercase extension\n---\nBody\n";
  try {
    await Deno.mkdir(bundleDir, { recursive: true });
    await Deno.writeTextFile(topicPath, source);
    const collection = await collectKnowledgeSources(
      createKnowledgeCommandArgs({ path: bundleDir, all: true, recursive: true, okfBundle: true }),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        downloadUploads: async () => [],
      },
    );
    const uploads: Array<{ remotePath: string; content: string }> = [];
    const indexedPaths: string[] = [];
    const results = await ingestResolvedSources(
      collection.sources,
      createKnowledgeCommandArgs({ path: bundleDir, all: true, outputDir, okfBundle: true }),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir,
        runParser: runKnowledgeParser,
        indexKnowledgeDocument: async (input) => {
          indexedPaths.push(input.published.path);
          return createIndexReceipt(input.published.path);
        },
        uploadKnowledgeFile: async (remotePath, localPath) => {
          uploads.push({ remotePath, content: await Deno.readTextFile(localPath) });
          return { path: remotePath };
        },
      },
    );

    assertEquals(results.failed, []);
    assertEquals(uploads, [{ remotePath: "knowledge/Concept.MD", content: source }]);
    assertEquals(results.ingested[0]?.documentKind, "okf_concept");
    assertEquals(indexedPaths, ["knowledge/Concept.MD"]);
    assertEquals(results.ingested[0]?.canonicalIndex?.path, "knowledge/Concept.MD");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
  }
});

it("reports legacy OKF diagnostics as partial failures without rewriting valid siblings", async () => {
  const tempDir = await makeTempDir({ prefix: "veryfront-okf-partial-" });
  const bundleDir = join(tempDir, "bundle");
  const outputDir = join(tempDir, "out");
  const validPath = join(bundleDir, "valid.md");
  const legacyPath = join(bundleDir, "legacy.md");
  const validSource = "---\ntype: Reference\ntitle: Valid\n---\nValid body\n";
  const legacySource = "---\nsource: old.txt\nsource_type: txt\n---\nLegacy body\n";
  try {
    await Deno.mkdir(bundleDir, { recursive: true });
    await Deno.writeTextFile(validPath, validSource);
    await Deno.writeTextFile(legacyPath, legacySource);
    const collection = await collectKnowledgeSources(
      createKnowledgeCommandArgs({ path: bundleDir, all: true, recursive: true, okfBundle: true }),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        downloadUploads: async () => [],
      },
    );
    const uploads: string[] = [];
    const results = await ingestResolvedSources(
      collection.sources,
      createKnowledgeCommandArgs({ path: bundleDir, all: true, outputDir, okfBundle: true }),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir,
        runParser: runKnowledgeParser,
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath) => {
          uploads.push(remotePath);
          return { path: remotePath };
        },
      },
    );

    assertEquals(uploads, ["knowledge/valid.md"]);
    assertEquals(results.ingested[0]?.remotePath, "knowledge/valid.md");
    assertEquals(results.failed.length, 1);
    assertEquals(results.failed[0]?.source, legacyPath);
    assertEquals(results.failed[0]?.reason, "parser_error");
    assertStringIncludes(results.failed[0]?.message ?? "", "Add a non-empty type");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
  }
});

it("rejects OKF bundle paths that escape the declared root before writing", () => {
  assertThrows(
    () =>
      deriveOkfBundleRelativePath(
        createLocalSource("/workspace/other/outside.md"),
        "/workspace/bundle",
      ),
    VeryfrontError,
    "Invalid OKF bundle relative path",
  );
});

describe("runKnowledgeParser", () => {
  it("ignores H1-shaped lines inside Markdown HTML blocks", async () => {
    const root = await makeTempDir({ prefix: "veryfront-knowledge-html-heading-" });
    try {
      const blocks = [
        `${" \t".repeat(20_000)}1234567890. not a list marker`,
        `${"> \t- ".repeat(100)}# Nested heading`,
        "1. - item\n    <widget>\ntext\n   # Visible title",
        "1. - item\n    2. <widget>\ntext\n   # Visible title",
        "1. - item\n\t<widget>\ntext\n   # Visible title",
        "-\n\n  ~~~md\n# Internal example\n  ~~~\n\n# Visible title",
        "-\n\n  ```md\n# Internal example\n  ```\n\n# Visible title",
        "1. Item\n-\n  <div>Metadata</div>\n# Visible title",
        "  2. Item\n    <div>Metadata</div>\n<span>\n# Visible title",
        "===\n<span>\n# Visible title",
        "- item\n2. <widget>\n    ```\n  # Visible title",
        "- item\n1. <widget>\n    ```\n\n# Visible title",
        "Intro\n- <widget>\n    ```\n\n# Visible title",
        "    code\n\n2. <widget>\n# Visible title",
        "- - -\n  ~~~js\nx\n~~~\n# Visible title",
        "* * *\n  <script>\n</script>\n# Visible title",
        "Section\n-\n  ~~~js\nx\n~~~\n# Visible title",
        "- Item\n<br>\n  <div>Content</div>\n# Visible title",
        "- Item\n<span>Label</span>\n  <div>Content</div>\n# Visible title",
        "- Item\n<strong>Label</strong>\n  <div>Content</div>\n# Visible title",
        "- <div>\n  First item\n  </div>\n- <div>\n  Second item\n  </div>\n# Visible title",
        "- First item\ncontinued\n  <div>\n  Second line\n  </div>\n# Visible title",
        "Intro\n2. <div>\n   # Visible title",
        "Intro\n2. ```md\n   # Visible title",
        "\uFEFF# Visible title",
        "\uFEFF---\n# metadata comment\ntitle: doc\n---\n# Visible title",
        "\n---\n# metadata comment\ntitle: doc\n---\n# Visible title",
        "- item\n  ```js\n  x\n  ```\nSome prose\n<widget>\n# Visible title",
        "- item\n  ```js\n  x\n  ```\n\nSome prose\n<widget>\n# Visible title",
        "- <div>text</div>\n\nSome prose\n<span>\n# Visible title",
        "- <!-- note -->\n\nSome prose\n<br>\n# Visible title",
        "```md\n- ```\n# Internal note\n```",
        "```md\n- item\n    ```\n# Internal note\n```",
        "-\t<div>\n  # Visible title",
        "<pre>\n</style>\n# Visible title",
        "- item\n  <div>Nested content</div>\n# Visible title",
        "<API_KEY>\n# Visible title",
        "## Section\n<widget>\n# Internal note",
        "---\n<widget>\n# Internal note",
        "- ```\n  # Internal note\n  ```\n# Visible title",
        "- <div>\n  # Internal note\n# Visible title",
        "- - <div>\n    # Internal note\n# Visible title",
        "  <div>\n# Internal note",
        "<script>\n# Internal note\n</script >\n# Still internal\n</script>",
        "    <div>\n# Visible title",
        "<!--\n# Internal note\n-->",
        "<script>\n# Internal note\n</script>",
        "<pre>\n# Internal note\n</pre>",
        "<style>\n# Internal note\n</style>",
        "<textarea>\n# Internal note\n</textarea>",
        "<div>\n# Internal note\n</div>",
        "<?processing\n# Internal note\n?>",
        "<!DOCTYPE\n# Internal note\n>",
        "<![CDATA[\n# Internal note\n]]>",
        '<custom-widget attr="value">\n# Internal note\n</custom-widget>',
      ];
      for (const [index, block] of blocks.entries()) {
        const filePath = join(root, `source-${index}.md`);
        const body = `${block}\n\n# Visible title\n\nOriginal body.\n`;
        await Deno.writeTextFile(filePath, body);
        const result = await runKnowledgeParser({
          filePath,
          outputDir: join(root, `out-${index}`),
        });
        assertEquals(result.title, "Visible title", block);
        assertEquals(result.slug, "visible-title", block);
        assertStringIncludes(
          await Deno.readTextFile(result.sandbox_output_path),
          body.replace(/^\uFEFF/, "").replace(/^(?:[ \t]*\n)+/, ""),
        );
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("keeps Markdown headings following MDX components", async () => {
    const root = await makeTempDir({ prefix: "veryfront-knowledge-mdx-heading-" });
    try {
      for (
        const [index, component] of [
          "<Banner />",
          "<Banner>Intro</Banner>",
          "<div />",
          "<Header />",
        ].entries()
      ) {
        const filePath = join(root, `source-${index}.mdx`);
        await Deno.writeTextFile(filePath, `${component}\n# Visible title\n`);
        const result = await runKnowledgeParser({
          filePath,
          outputDir: join(root, `out-${index}`),
        });
        assertEquals(result.title, "Visible title");
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("does not turn a reference-only thematic break into a Setext title", async () => {
    const root = await makeTempDir();
    try {
      for (const extension of ["md", "pdf", "html", "docx"]) {
        for (const [index, separator] of ["---", "----", "- - -", "***", "___"].entries()) {
          const filePath = join(root, `source.${extension}`);
          const content = `[ref]: /url\n${separator}\n===`;
          await Deno.writeTextFile(filePath, extension === "md" ? content : "synthetic input");
          const result = await runKnowledgeParser({
            filePath,
            outputDir: join(root, `${extension}-${index}`),
          }, { extractDocumentText: () => Promise.resolve(content) });
          assertEquals(result.title, "source", `${extension}: ${separator}`);
          assertStringIncludes(await Deno.readTextFile(result.sandbox_output_path), "# source");
        }
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("preserves extracted Markdown indentation when finding document titles", async () => {
    const root = await makeTempDir({ prefix: "veryfront-knowledge-extracted-heading-" });
    try {
      for (const extension of ["pdf", "html", "docx"]) {
        const filePath = join(root, `source.${extension}`);
        await Deno.writeTextFile(filePath, "synthetic extractor input");
        const content = "    <div>example</div>\n# Real title";
        const result = await runKnowledgeParser({ filePath, outputDir: join(root, extension) }, {
          extractDocumentText: () => Promise.resolve(content),
        });
        assertEquals(result.title, "Real title");
        assertEquals(result.slug, "real-title");
        assertStringIncludes(await Deno.readTextFile(result.sandbox_output_path), content);
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("preserves headings after nested containers and multiline definitions", async () => {
    const root = await makeTempDir({ prefix: "veryfront-heading-nested-" });
    const fixtures = [
      {
        name: "empty frontmatter later separator",
        body: "---\n---\n# Real title\n\n---\n# Later title",
        formats: ["md", "mdx", "pdf", "html", "docx"],
      },
      {
        name: "empty frontmatter no later separator",
        body: "---\n---\n# Real title",
        formats: ["md", "mdx", "pdf", "html", "docx"],
      },
      {
        name: "nonempty frontmatter later separator",
        body: "---\ntitle: Metadata title\n---\n# Real title\n\n---\n# Later title",
        formats: ["md", "mdx", "pdf", "html", "docx"],
      },
      {
        name: "empty frontmatter CRLF later separator",
        body: "---\r\n---\r\n# Real title\r\n\r\n---\r\n# Later title",
        formats: ["md", "mdx", "pdf", "html", "docx"],
      },
      {
        name: "empty item fixed padding",
        body: "-  \n  <div>\n# Real title",
        formats: ["md", "pdf"],
      },
      {
        name: "empty tab item fixed padding",
        body: "-\t\n  ```\n# Real title",
        formats: ["md", "pdf"],
      },
      {
        name: "four-space destination continuation",
        body: "[ref]:\n    /url\n===\n<span>\n# Real title",
        formats: ["md", "pdf"],
      },
      {
        name: "wrapped reference label",
        body: "[wrapped\nlabel]: /url\n===\n<span>\n# Real title",
        formats: ["md", "pdf"],
      },
      {
        name: "quoted ordered-list fence indentation",
        body: "> 10. ```\n>     code\n>     ```\n> Text\n<span>\n# Real title",
        formats: ["md", "pdf", "html", "docx"],
      },
      {
        name: "quoted nested-list fence indentation",
        body: "> - - ```\n>     code\n>     ```\n> Text\n<span>\n# Real title",
        formats: ["md", "pdf", "html", "docx"],
      },
      {
        "name": "MDX exported template",
        "body": "export const example = `\n    # Internal example\n`\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX JSX expression",
        "body": "<Example code={`\n    # Internal example\n`} />\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX JSX quoted attribute",
        "body": '<Example title="\n    # Internal example\n" />\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "MDX nested template expression",
        "body": "export const example = `${`inner ${1}`}`\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX standalone expression",
        "body": "{`\n    # Internal example\n`}\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "reference interrupted by heading",
        "body": "[Roadmap\n# Real title\n]: /roadmap",
        "formats": ["md", "mdx", "pdf"],
      },
      {
        "name": "reference interrupted by list",
        "body": "[Roadmap\n- item\n]: /roadmap\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "reference interrupted by quote",
        "body": "[Roadmap\n> text\n]: /roadmap\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "label block boundary ===",
        "title": "[ref",
        "slug": "ref",
        "body": "[ref\n===\n]: /url\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "label block boundary ---",
        "body": "[ref\n---\n]: /url\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "label block boundary - item",
        "body": "[ref\n- item\n]: /url\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "label block boundary > text",
        "body": "[ref\n> text\n]: /url\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "label block boundary ```md",
        "body": "[ref\n```md\n# Internal example\n```\n]: /url\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "destination block boundary ===",
        "title": "[ref]:",
        "slug": "ref",
        "body": "[ref]:\n===\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "destination block boundary ---",
        "body": "[ref]:\n---\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "destination block boundary - item",
        "body": "[ref]:\n- item\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "destination block boundary > text",
        "body": "[ref]:\n> text\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "destination block boundary ```md",
        "body": "[ref]:\n```md\n# Internal example\n```\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "title block boundary ===",
        "title": '[ref]: /url "title',
        "slug": "ref-url-title",
        "body": '[ref]: /url "title\n===\n"\n# Real title',
        "formats": ["md", "pdf"],
      },
      {
        "name": "title block boundary ---",
        "body": '[ref]: /url "title\n---\n"\n# Real title',
        "formats": ["md", "pdf"],
      },
      {
        "name": "title block boundary - item",
        "body": '[ref]: /url "title\n- item\n"\n# Real title',
        "formats": ["md", "pdf"],
      },
      {
        "name": "title block boundary > text",
        "body": '[ref]: /url "title\n> text\n"\n# Real title',
        "formats": ["md", "pdf"],
      },
      {
        "name": "title block boundary ```md",
        "body": '[ref]: /url "title\n```md\n# Internal example\n```\n"\n# Real title',
        "formats": ["md", "pdf"],
      },
      {
        "name": "MDX regex braces and template expressions",
        "body": "{(() => { const r = /[}]/; return `nested ${`value ${1}`}` })()}\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX multiline ESM assignment",
        "body": "export const example =\n`\n    # Internal example\n`\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX ESM JSX child",
        "body":
          "export const example = <Example>\n\n    # Internal example\n</Example>\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX expression JSX child",
        "body": "{<Example>\n    # Internal example\n</Example>}\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX regex after return",
        "body": "{(() => { return /[}]/ })()}\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX true indented child heading",
        "body": "<Example>\n\n    # Real title\n\n</Example>",
        "formats": ["mdx"],
      },
      {
        "name": "MDX arrow JSX",
        "body":
          "export const Example = () => <div>\n\n    # Internal example\n</div>\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX regex after comment",
        "body": '{/* comment */ /[{]/.test("x")}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "MDX regex after condition",
        "body": '{(() => { if (true) /[{]/.test("x"); })()}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "MDX regex after conditional block",
        "body": '{(() => { if (true) {} /[{]/.test("x"); })()}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "MDX component exits list",
        "body": "- Item\n\n<Component />\n\n  # Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX expression exits list",
        "body": "- Item\n\n{null}\n\n  # Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX export exits list",
        "body": "- Item\n\nexport const x = 1\n\n  # Real title",
        "formats": ["mdx"],
      },
      {
        "name": "new nested item has no inherited paragraph",
        "body": "Intro\n- -\ntext\n  # Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        name: "MDX nested marker retains the interrupted paragraph",
        body: "Intro\n- -\ntext\n  # Nested title\n\n# Real title",
        formats: ["mdx"],
      },
      {
        "name": "incomplete MDX ESM across blank line",
        "body": "export const example =\n\n`\n    # Internal example\n`\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "default exported JSX",
        "body": "export default <Example>\n\n    # Internal example\n</Example>\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "regex after function declaration",
        "body": '{(() => { function f() {} /[{]/.test("x"); })()}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "regex in exported function",
        "body":
          'export const example = (() => { function f() {} /[{]/.test("x"); })()\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "division after function expression",
        "body": "{(() => { const f = function() {} / 2; return f; })()}\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "regex after class declaration",
        "body": '{(() => { class Example {} /[{]/.test("x"); })()}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "JSX raw quoted backslash",
        "body": '<Example path="docs\\" />\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "regex after async declaration",
        "body":
          'export function example() { async function f() {} /[{]/.test("x"); }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "regex after bare statement block",
        "body": '{(() => { {} /[{]/.test("x"); })()}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "nested lazy quote-list-quote paragraph",
        "body": "> - > Note\n<span>\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        "name": "quoted inline span retains lazy paragraph",
        "body": "> ```code```\n<span>\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        "name": "quoted inline span does not create root Setext",
        "body": "> ```code```\ncontinued\n===\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "optional catch body before regex",
        "body": 'export function f() { try {} catch {} /[{]/.test("x"); }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "for-await body before regex",
        "body":
          'export async function f() { for await (const x of []) {} /[{]/.test("x"); }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "Unicode JSX tag ownership",
        "body": "export const example = <Übersicht>It's text</Übersicht>\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "underscore JSX tag ownership",
        "body": "export const example = <_Banner>It's text</_Banner>\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "dollar JSX tag ownership",
        "body": "export const example = <$Banner>It's text</$Banner>\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "contextual identifier ends export",
        "body": 'import { from } from "pkg"\nexport const convert = from\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "contextual identifier default export",
        "body": "export default as\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "list child reference definition before lazy HTML",
        "body": "- [ref]: /url\n  ===\n<span>\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "ordered list child reference definition before lazy HTML",
        "body": "1. [ref]: /url\n   ===\n<span>\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        name: "MDX indented heading interrupts unmatched list",
        body: "   - item\n    # Real title\n\n# Later title",
        formats: ["mdx"],
      },
      {
        name: "MDX indented fence interrupts reference",
        body: "[ref]:\n    ~~~\nexample\n~~~\n# Real title",
        formats: ["mdx"],
      },
      // Follow the content renderer for lazy tags; cmark 0.31.1 differs here.
      {
        name: "rendered lazy closing tags start their own HTML block",
        title: "Later title",
        slug: "later-title",
        body: "1. item\n</script>\n</span>\n  # Real title\n\n# Later title",
        formats: ["md", "pdf"],
      },
      // An empty item can follow indented code, so its indented H1 remains nested.
      {
        name: "CommonMark empty item after indented code",
        body: "    example\n-\n  # Nested title\n\n# Real title",
        formats: ["md", "pdf"],
      },
      {
        name: "MDX indented H2 after list",
        body: "   - item\n    ## nested\n===\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX indented quote after quote",
        body: "> item\n    > quote\n===\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX indented list after list",
        body: "   - item\n    - item\n===\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX indented thematic break after list",
        body: "   - item\n    ***\n===\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX NBSP is content in lazy paragraph",
        body: "- item\n\u00a0# First\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX quoted heading before indented quote",
        body: ">     ## Section\n    > quote\n===\n\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX quoted heading before indented list",
        body: ">     ## Section\n    - item\n===\n\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX quoted fence before indented reference",
        body: ">     ~~~\n    [ref]: /url\n===\n\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX empty list after indented H2",
        body: "    ## Section\n    -\n===\n\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX indented quote after interrupting H2",
        body: "> note\n    ## Section\n    > quote\n===\n\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX NBSP content before list-owned fence",
        body: "    - item\n\u00a0```\n      ```\n\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX indented definition before Setext marker",
        body: "    [ref]: /url\n     ===\n\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX NBSP is content after nested empty items",
        body: "    -\n      -\n\u00a0\n      ~~~\n# Hidden\n      ~~~\n\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX nested unescaped bracket is not a reference label",
        body: "    [[]:l\n=\n# Later title",
        title: "[[]:l",
        slug: "l",
        formats: ["mdx"],
      },
      {
        name: "MDX nested empty marker retains definition interruption",
        body: "[ref]: /url\n- -\n\u00a0```\n  ```\n\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX nested empty marker retains paragraph interruption",
        body: "- [ref]:\n    - -\n\u00a0```\n  text\n===\n\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX outdented quote closes the prior list paragraph",
        body: "- item\n> -\ntext\n===\n# Later title",
        title: "text",
        slug: "text",
        formats: ["mdx"],
      },
      {
        name: "MDX quoted definition has no visible Setext paragraph",
        body: ">[f]:l\n>-\n\u00a0\n=\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX continued quoted definition has no visible Setext paragraph",
        body: ">[f]:\n> /url\n>-\n\u00a0\n=\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX lazy quoted-list content cannot become Setext",
        body: "> - item\n> ===\nTitle\n===\n\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX quote exits the prior bullet list paragraph",
        body: "> - item\n> > -\nTitle\n===\n\n# Later title",
        title: "Title",
        slug: "title",
        formats: ["mdx"],
      },
      {
        name: "MDX quote exits the prior ordered list paragraph",
        body: "> 1. item\n> > -\nTitle\n===\n\n# Later title",
        title: "Title",
        slug: "title",
        formats: ["mdx"],
      },
      {
        name: "MDX shallower quote exits the deeper list paragraph",
        body: "> > - item\n> -\nTitle\n===\n\n# Later title",
        title: "Title",
        slug: "title",
        formats: ["mdx"],
      },
      {
        name: "MDX nested quote closes its own Setext paragraph",
        body: "> > note\n> > -\nTitle\n===\n\n# Later title",
        title: "Title",
        slug: "title",
        formats: ["mdx"],
      },
      {
        name: "MDX quoted sibling starts its own paragraph context",
        body: "> - item\n> - -\ntext\n===\n\n# Later title",
        title: "text",
        slug: "text",
        formats: ["mdx"],
      },
      {
        name: "MDX quoted empty marker inherits root paragraph interruption",
        body: "Intro\n>     -\ntext\n===\n\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "MDX nested quote inherits its paragraph interruption",
        body: "> Intro\n>     > -\ntext\n===\n\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "reference destination normalizes NUL before tokenization",
        body: "[ref]: /url\u0000\n===\n\n# Real title",
        formats: ["md", "mdx", "pdf", "html", "docx"],
      },
      {
        name: "reference backslash does not escape a tab delimiter",
        body: '[ref]: /url\\\t"title"\n===\n\n# Real title',
        formats: ["md", "mdx", "pdf", "html", "docx"],
      },
      {
        name: "MDX reference backslash cannot escape a space",
        body: "    [ref]: /url\\ /other\n===\n\n# Later title",
        title: "[ref]: /url\\ /other",
        slug: "ref-url-other",
        formats: ["mdx"],
      },
      ...["\u000b", "\f", "\u001f", "\u007f"].map((character) => ({
        name: `reference destination rejects ASCII control ${character.charCodeAt(0)}`,
        body: `[ref]: /url${character}\n===\n\n# Later title`,
        title: `[ref]: /url${character}`.trim(),
        slug: "ref-url",
        formats: ["md", "mdx", "pdf"],
      })),
      {
        "name": "MDX stack preserves quoted list ownership after an empty item",
        "body": "> -\n>   note\n> - *\nTitle\n===",
        "title": "Title",
        "slug": "title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX stack preserves quoted list ownership after a heading",
        "body": "> - ## Heading\n>   note\n> - *\nTitle\n===",
        "title": "Title",
        "slug": "title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX stack retains list ancestors around nested quoted backtick fences",
        "body": "> - note\n>   > ```\n>   > code\nTitle\n===",
        "title": "Title",
        "slug": "title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX stack retains list ancestors around nested quoted tilde fences",
        "body": "> - note\n>   > ~~~\n>   > code\nTitle\n===",
        "title": "Title",
        "slug": "title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX stack recognizes a definition in a quote that interrupts a paragraph",
        "body": "Intro\n> [ref]: /url\n> ===\nTitle\n===\n# Final",
        "title": "Final",
        "slug": "final",
        "formats": ["mdx"],
      },
      {
        "name": "MDX stack recognizes a definition in nested quotes that interrupt a paragraph",
        "body": "Intro\n> > [ref]: /url\n> > ===\nTitle\n===\n# Final",
        "title": "Final",
        "slug": "final",
        "formats": ["mdx"],
      },
      {
        "name": "MDX stack updates the quoted definition state on lazy text",
        "body": "> [ref]: /url\nnote\n> -\nnote\n> -\nTitle\n===\n# Final",
        "title": "Final",
        "slug": "final",
        "formats": ["mdx"],
      },
      {
        "name": "MDX stack retains omitted nested quoted list state on a lazy line",
        "body": "> > 1. note\n> note\n> > > -\nTitle\n===\n# Final",
        "title": "Title",
        "slug": "title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX flow root expression interrupts the previous list",
        "body": "Intro\n- * *\n{true}\n    # First\n# Final",
        "title": "First",
        "slug": "first",
        "formats": ["mdx"],
      },
      {
        "name": "MDX flow root JSX interrupts the previous list",
        "body": "Intro\n- -\n<Component />\n   Title\n===\n# Final",
        "title": "Title",
        "slug": "title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX flow quoted JSX is flow rather than visible paragraph",
        "body": "> <Component />\n> ===\nTitle\n===\n# Final",
        "title": "Final",
        "slug": "final",
        "formats": ["mdx"],
      },
      {
        "name": "MDX flow listed JSX permits a following empty list",
        "body": "- <Component />\n  - -\nTitle\n===\n# Final",
        "title": "Title",
        "slug": "title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX flow quoted expression permits a following empty list",
        "body": "> {true}\n> - -\nTitle\n===\n# Final",
        "title": "Title",
        "slug": "title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX flow quoted definition accepts a lazy destination",
        "body": "> [ref]:\n/url\n> ===\nTitle\n===\n# Final",
        "title": "Final",
        "slug": "final",
        "formats": ["mdx"],
      },
      {
        "name": "MDX flow listed definition accepts a lazy destination",
        "body": "- [ref]:\n/url\n  ===\nTitle\n===\n# Final",
        "title": "Final",
        "slug": "final",
        "formats": ["mdx"],
      },
      {
        "name": "MDX flow JSX interrupts a pending definition",
        "body": "    [ref]:\n<Component />\n2. Other\n===\n# Final",
        "title": "Final",
        "slug": "final",
        "formats": ["mdx"],
      },
      {
        "name": "MDX quoted definition accepts lazy label",
        "body": "> [ref\n]: /url\n> ===\nTitle\n===\n# Final",
        "title": "Final",
        "slug": "final",
        "formats": ["mdx"],
      },
      {
        "name": "MDX quoted definition accepts lazy title",
        "body": '> [ref]: /url\n"title"\n> ===\nTitle\n===\n# Final',
        "title": "Final",
        "slug": "final",
        "formats": ["mdx"],
      },
      {
        "name": "MDX quoted definition accepts lazy multiline title",
        "body": '> [ref]: /url "title\ncontinued"\n> ===\nTitle\n===\n# Final',
        "title": "Final",
        "slug": "final",
        "formats": ["mdx"],
      },
      {
        "name": "MDX listed definition accepts lazy label",
        "body": "- [ref\n]: /url\n  ===\nTitle\n===\n# Final",
        "title": "Final",
        "slug": "final",
        "formats": ["mdx"],
      },
      {
        "name": "MDX listed definition accepts lazy title",
        "body": '- [ref]: /url\n"title"\n  ===\nTitle\n===\n# Final',
        "title": "Final",
        "slug": "final",
        "formats": ["mdx"],
      },
      {
        "name": "MDX listed definition accepts lazy multiline title",
        "body": '- [ref]: /url "title\ncontinued"\n  ===\nTitle\n===\n# Final',
        "title": "Final",
        "slug": "final",
        "formats": ["mdx"],
      },
      {
        "name": "MDX lazy Setext marker is a reference destination '> '",
        "body": "> [ref]:\n===\n> ===\nTitle\n===\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX lazy Setext marker is a reference destination '- '",
        "body": "- [ref]:\n===\n  ===\nTitle\n===\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX blank closes nested quoted ``` fence ''",
        "body": "- > ```\n\n  > Note\nTitle\n===\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX blank closes nested quoted ``` fence '> '",
        "body": "> - > ```\n>\n>   > Note\nTitle\n===\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX blank releases quoted list before ``` ''",
        "body": "> - item\n\n>   ```\n> note\nTitle\n===\n\n# Later",
        "title": "Title",
        "slug": "title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX blank releases quoted list before ``` '- '",
        "body": "- > - item\n\n  >   ```\n  > note\nTitle\n===\n\n# Later",
        "title": "Title",
        "slug": "title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX blank closes nested quoted ~~~ fence ''",
        "body": "- > ~~~\n\n  > Note\nTitle\n===\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX blank closes nested quoted ~~~ fence '> '",
        "body": "> - > ~~~\n>\n>   > Note\nTitle\n===\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX blank releases quoted list before ~~~ ''",
        "body": "> - item\n\n>   ~~~\n> note\nTitle\n===\n\n# Later",
        "title": "Title",
        "slug": "title",
        "formats": ["mdx"],
      },
      {
        "name": "MDX blank releases quoted list before ~~~ '- '",
        "body": "- > - item\n\n  >   ~~~\n  > note\nTitle\n===\n\n# Later",
        "title": "Title",
        "slug": "title",
        "formats": ["mdx"],
      },
      {
        name: "MDX empty quote makes its containing item nonempty",
        body: "-\n  >\n\n      ```\n\n# Real title",
        formats: ["mdx"],
      },
      {
        "name": "quoted Setext closes lazy paragraph",
        "body": "> Quoted section\n> ===\nReal title\n===\n\n# Later title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "quoted H2 closes lazy paragraph",
        "body": "> Quoted section\n> ---\nReal title\n===\n\n# Later title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "nested quoted Setext closes lazy paragraph",
        "body": ">> Quoted section\n>> ===\nReal title\n===\n\n# Later title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "quoted list Setext closes lazy paragraph",
        "body": "> - Quoted section\n>   ===\nReal title\n===\n\n# Later title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "quoted nested list Setext closes lazy paragraph",
        "body": "> - - Quoted section\n>     ===\nReal title\n===\n\n# Later title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "decreasing quote depth does not complete Setext",
        "body": ">> Quoted section\n> ===\nReal title\n===\n\n# Later title",
        "title": "Later title",
        "slug": "later-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "increasing quote depth does not complete Setext",
        "body": "> Quoted section\n>> ===\nReal title\n===\n\n# Later title",
        "title": "Later title",
        "slug": "later-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "outdented list underline remains lazy paragraph",
        "body": "> - Quoted section\n> ===\nReal title\n===\n\n# Later title",
        "title": "Later title",
        "slug": "later-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "indented underline remains paragraph",
        "body": "> Quoted section\n>     ===\nReal title\n===\n\n# Later title",
        "title": "Later title",
        "slug": "later-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "blank prevents quoted Setext",
        "body": "> Quoted section\n>\n> ===\nReal title\n===\n\n# Later title",
        "title": "Later title",
        "slug": "later-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "reference-only quote has no Setext text",
        "body": "> [ref]: /url\n> ===\nReal title\n===\n\n# Later title",
        "title": "Later title",
        "slug": "later-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "multiline reference-only quote has no Setext text",
        "body": "> [ref]:\n> /url\n> ===\nReal title\n===\n\n# Later title",
        "title": "Later title",
        "slug": "later-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "reference followed by text supports Setext",
        "body": "> [ref]: /url\n> Quoted section\n> ===\nReal title\n===\n\n# Later title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "lazy quoted text supports Setext",
        "body": "> Quoted section\nlazy continuation\n> ===\nReal title\n===\n\n# Later title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "quoted list containing quote Setext",
        "body": "> - > Quoted section\n>   > ===\nReal title\n===\n\n# Later title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "outdented quote cannot underline a list child",
        "body": "> - > Quoted section\n>> ===\nReal title\n===\n\n# Later title",
        "title": "Later title",
        "slug": "later-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "spaced outdented quote cannot underline a list child",
        "body": "> - > Quoted section\n> > ===\nReal title\n===\n\n# Later title",
        "title": "Later title",
        "slug": "later-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "reference-only quoted hyphens remain paragraph text",
        "body": "> [ref]: /url\n> ---\nReal title\n===\n\n# Later title",
        "title": "Later title",
        "slug": "later-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "outer list quote changes owner",
        "body": "- > Text\n> ===\nNot a heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "ordered outer list quote changes owner",
        "body": "1. > Text\n> ===\nNot a heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "quoted list keeps ownership after heading",
        "body": "> - ## Section\n>   Paragraph\n> ===\nNot a heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "quoted list keeps ownership after blank",
        "body": "> - Item\n>\n>   Paragraph\n> ===\nNot a heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "quoted list keeps ownership after code",
        "body": "> -     code\n>   Paragraph\n> ===\nNot a heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "quoted list keeps ownership after fence",
        "body":
          "> - ```\n>   code\n>   ```\n>   Paragraph\n> ===\nNot a heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "nested quoted list keeps ownership after blank",
        "body": "> - > Item\n>   >\n>   > Paragraph\n> > ===\nNot a heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "quoted list after heading accepts owned underline",
        "body": "> - ## Section\n>   Paragraph\n>   ===\nNot a heading\n===\n\n# Real title",
        "title": "Not a heading",
        "slug": "not-a-heading",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "quoted list after blank accepts owned underline",
        "body": "> - Item\n>\n>   Paragraph\n>   ===\nNot a heading\n===\n\n# Real title",
        "title": "Not a heading",
        "slug": "not-a-heading",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "quoted list after code accepts owned underline",
        "body": "> -     code\n>   Paragraph\n>   ===\nNot a heading\n===\n\n# Real title",
        "title": "Not a heading",
        "slug": "not-a-heading",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "list-owned quoted fence exits ancestor list",
        "body": "> - > ~~~\n> > Text\nNot a heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "list-owned quoted HTML exits ancestor list",
        "body": "> - > <div>\n> > Text\nNot a heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "empty ancestor list closes nested quote",
        "body": "> > Text\n> -\n> > ===\nNot a heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "blank closes empty quoted list",
        "body": "> -\n>\n>     code\nReal title\n===\n\n# Later title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "owned list fence continues full prefix",
        "body": "> - > ~~~\n>   > Hidden\n>   > ~~~\nReal title\n===\n\n# Later title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "owned HTML continues full prefix",
        "body": "> - > <div>\n>   > Hidden\n>   >\nReal title\n===\n\n# Later title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "ordered ancestor list closes nested quote",
        "body": "> > Text\n> 2.\n> > ===\nNot a heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "blank closes nested empty quoted list",
        "body": ">> -\n>>\n>>     code\nReal title\n===\n\n# Later title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "lazy quote list indentation does not expose a fence",
        "body": "> 100. Text\n>     ~~~\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "lazy quote list indentation does not expose HTML",
        "body": "> 100. Text\n>     <div>\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "lazy quote list indentation does not expose a thematic break",
        "body": "> 100. Text\n>     ---\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "closing ancestor drops descendant list after heading",
        "body": "> - > - ## Section\n> >     code\nReal title\n===\n\n# Later title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "closing ancestor drops descendant list after empty item",
        "body": ">  - > -\n>>     code\nCandidate\n===\n\n# Fallback",
        "title": "Candidate",
        "slug": "candidate",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "new shallower paragraph drops descendant list after fence",
        "body": "> > - ~~~\n>    code\n> >     code\nCandidate\n===\n\n# Fallback",
        "title": "Candidate",
        "slug": "candidate",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "new shallower reference drops descendant list",
        "body": ">   > -\n>    [ref]: /url\n>>     code\nCandidate\n===\n\n# Fallback",
        "title": "Candidate",
        "slug": "candidate",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "new shallower reference drops descendant list after fence",
        "body": "> > - ```\n> [ref]: /url\n>>     code\nCandidate\n===\n\n# Fallback",
        "title": "Candidate",
        "slug": "candidate",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "reference-only thematic break follows CommonMark contract",
        "body": "> [ref]: /url\n> ---\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "underindented list marker remains lazy before mutation",
        "body": "> 100. Text\n>     - Text\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "root definition expires preceding quoted list",
        "body": "> - ## Section\n[ref]: /url\n>     code\nCandidate\n===\n\n# Fallback",
        "title": "Candidate",
        "slug": "candidate",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "rendered outdented custom HTML releases the root paragraph",
        "body": "> -\n>     code\n> <custom>\nCandidate\n===\n\n# Fallback",
        "title": "Candidate",
        "slug": "candidate",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "indented reference retains definition continuation",
        "body": "> [ref]: /url\n>     [ref]: /url\n> ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "first unmatched outer list retains lazy nested quote",
        "body": "> 100. - Text\n>     > </div>\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "first unmatched outer list retains lazy nested fence",
        "body": "> 100. 2. Text\n>     > ```\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "new root list definition expires nested quote owner",
        "body": "> - > [ref]:\n- [ref]: /url\n>     ===\nCandidate\n===\n\n# Fallback",
        "title": "Candidate",
        "slug": "candidate",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "underindented ancestor marker retains deeper paragraph",
        "body": "> 100. > Text\n>     - Text\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "underindented ancestor empty marker retains deeper paragraph",
        "body": "> 100. > Text\n>     -\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "nested quoted ancestor retains lazy ordered marker",
        "body": "> > 100. > Text\n> >     2. Text\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "root list quoted ancestor retains lazy marker",
        "body": "- > 100. > Text\n  >     - Text\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "quoted definition accepts lazy Setext-shaped destination",
        "body": "> [ref]:\n===\n> ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "nested quote definition accepts lazy destination",
        "body": "> > [ref]:\n===\n> > ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "quoted list definition accepts lazy destination",
        "body": "> - [ref]:\n===\n>   ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "root list quoted definition accepts lazy destination",
        "body": "- > [ref]:\n===\n  > ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "thematic break closes quoted paragraph in root list",
        "body": "- > Text\n    ---\n  > ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "star thematic break closes quoted paragraph in root list",
        "body": "- > Text\n    ***\n  > ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "ATX heading closes quoted paragraph in root list",
        "body": "- > Text\n    ## Subheading\n  > ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "ordered list interruption closes quoted paragraph",
        "body": "100. > Text\n       ---\n     > ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "quoted list interruption closes nested quoted paragraph",
        "body": "> - > Text\n>     ---\n>   > ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "closed quoted definition cannot join a later quote",
        "body":
          '- > [ref]: /url "title"\n    ---\n  /url\n     > ===\nCandidate\n===\n\n# Fallback',
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "indented lazy definition contributes visible quoted Setext text",
        "body": "> [first]: /one\n  [second]: /two\n> ---\nDocument title\n===\n\n# Fallback",
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "root list empty marker closes quoted paragraph",
        "body": "- > Text\n    -\n  > ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "root list empty ordered marker closes quoted paragraph",
        "body": "- > Text\n    2.\n  > ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "root list non-one ordered marker closes quoted paragraph",
        "body": "- > Text\n    100. Text\n  > ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "ordered root list empty marker closes quoted paragraph",
        "body": "100. > Text\n       -\n     > ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "ordered root list empty ordered marker closes quoted paragraph",
        "body": "100. > Text\n       2.\n     > ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "ordered root list non-one marker closes quoted paragraph",
        "body": "100. > Text\n       100. Text\n     > ===\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "root list empty marker separates quoted definitions",
        "body": '- > [ref]: /url "title"\n    -\n  /url\n     > ===\nCandidate\n===\n\n# Fallback',
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "root list empty ordered marker separates quoted definitions",
        "body": '- > [ref]: /url "title"\n    2.\n  /url\n     > ===\nCandidate\n===\n\n# Fallback',
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "root list non-one marker separates quoted definitions",
        "body":
          '- > [ref]: /url "title"\n    100. Text\n  /url\n     > ===\nCandidate\n===\n\n# Fallback',
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "nested list sibling cannot retain an old quote owner",
        "body":
          "    </custom>\n- - > [r]: /url\n    -\n<custom>\n>       /url\nCandidate\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "fully matched indented definition remains a definition",
        "body": "> [first]: /one\n>   [second]: /two\n> ---\nDocument title\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "unindented lazy definition remains a definition",
        "body": "> [first]: /one\n[second]: /two\n> ---\nDocument title\n===\n\n# Fallback",
        "title": "Fallback",
        "slug": "fallback",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name":
          "root complete reference definition indentation 0 recognizes a following thematic break",
        "body": "[first]: /one\n[second]: /two\n---\nDocument title\n===\n\n# Fallback",
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name":
          "root complete reference definition indentation 1 recognizes a following thematic break",
        "body": "[first]: /one\n [second]: /two\n---\nDocument title\n===\n\n# Fallback",
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name":
          "root complete reference definition indentation 2 recognizes a following thematic break",
        "body": "[first]: /one\n  [second]: /two\n---\nDocument title\n===\n\n# Fallback",
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name":
          "root complete reference definition indentation 3 recognizes a following thematic break",
        "body": "[first]: /one\n   [second]: /two\n---\nDocument title\n===\n\n# Fallback",
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name":
          "root complete reference definition indentation 4 recognizes a following thematic break",
        "body": "[first]: /one\n    [second]: /two\n---\nDocument title\n===\n\n# Fallback",
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "root complete reference title indentation 0 recognizes a following thematic break",
        "body": '[first]: /one\n"title"\n---\nDocument title\n===\n\n# Fallback',
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "root complete reference title indentation 1 recognizes a following thematic break",
        "body": '[first]: /one\n "title"\n---\nDocument title\n===\n\n# Fallback',
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "root complete reference title indentation 2 recognizes a following thematic break",
        "body": '[first]: /one\n  "title"\n---\nDocument title\n===\n\n# Fallback',
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "root complete reference title indentation 3 recognizes a following thematic break",
        "body": '[first]: /one\n   "title"\n---\nDocument title\n===\n\n# Fallback',
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "root complete reference title indentation 4 recognizes a following thematic break",
        "body": '[first]: /one\n    "title"\n---\nDocument title\n===\n\n# Fallback',
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name":
          "root continued reference destination indentation 0 recognizes a following thematic break",
        "body": "[first]:\n/two\n---\nDocument title\n===\n\n# Fallback",
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name":
          "root continued reference destination indentation 1 recognizes a following thematic break",
        "body": "[first]:\n /two\n---\nDocument title\n===\n\n# Fallback",
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name":
          "root continued reference destination indentation 2 recognizes a following thematic break",
        "body": "[first]:\n  /two\n---\nDocument title\n===\n\n# Fallback",
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name":
          "root continued reference destination indentation 3 recognizes a following thematic break",
        "body": "[first]:\n   /two\n---\nDocument title\n===\n\n# Fallback",
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name":
          "root continued reference destination indentation 4 recognizes a following thematic break",
        "body": "[first]:\n    /two\n---\nDocument title\n===\n\n# Fallback",
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name":
          "root continued reference title indentation 0 recognizes a following thematic break",
        "body": '[first]:\n"title"\n---\nDocument title\n===\n\n# Fallback',
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name":
          "root continued reference title indentation 1 recognizes a following thematic break",
        "body": '[first]:\n "title"\n---\nDocument title\n===\n\n# Fallback',
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name":
          "root continued reference title indentation 2 recognizes a following thematic break",
        "body": '[first]:\n  "title"\n---\nDocument title\n===\n\n# Fallback',
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name":
          "root continued reference title indentation 3 recognizes a following thematic break",
        "body": '[first]:\n   "title"\n---\nDocument title\n===\n\n# Fallback',
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name":
          "root continued reference title indentation 4 recognizes a following thematic break",
        "body": '[first]:\n    "title"\n---\nDocument title\n===\n\n# Fallback',
        "title": "Document title",
        "slug": "document-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "CommonMark ordered marker after indented code starts a list",
        "body": "    example code\n2. Installation\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "HTML block after lazy - item",
        "body": "- item\n<span>\n<span>\n# Hidden\n\n# Real title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
        "title": "Real title",
        "slug": "real-title",
      },
      {
        "name": "HTML block after lazy 1. item",
        "body": "1. item\n<span>\n<span>\n# Hidden\n\n# Real title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
        "title": "Real title",
        "slug": "real-title",
      },
      {
        "name": "HTML block after lazy - - item",
        "body": "- - item\n<span>\n<span>\n# Hidden\n\n# Real title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
        "title": "Real title",
        "slug": "real-title",
      },
      {
        "name": "ordered paragraph after code 2.",
        "body": "    code\n2. Heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "ordered paragraph after code 2. with blank",
        "body": "    code\n\n2. Heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "ordered paragraph after code 2)",
        "body": "    code\n2) Heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "ordered paragraph after code 2) with blank",
        "body": "    code\n\n2) Heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "ordered paragraph after code 123.",
        "body": "    code\n123. Heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "ordered paragraph after code 123. with blank",
        "body": "    code\n\n123. Heading\n===\n\n# Real title",
        "title": "Real title",
        "slug": "real-title",
        "formats": [
          "md",
          "pdf",
          "html",
          "docx",
        ],
      },
      {
        "name": "Markdown HTML div retains nonblank U+00A0",
        "body": "<div>\n\u00a0\n# Hidden example\n</div>\n\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        "name": "Markdown HTML custom-element retains nonblank U+00A0",
        "body": "<custom-element>\n\u00a0\n# Hidden example\n</custom-element>\n\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        "name": "Markdown HTML div retains nonblank U+2003",
        "body": "<div>\n\u2003\n# Hidden example\n</div>\n\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        "name": "Markdown HTML custom-element retains nonblank U+2003",
        "body": "<custom-element>\n\u2003\n# Hidden example\n</custom-element>\n\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        "name": "Markdown HTML div retains nonblank U+202F",
        "body": "<div>\n\u202f\n# Hidden example\n</div>\n\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        "name": "Markdown HTML custom-element retains nonblank U+202F",
        "body": "<custom-element>\n\u202f\n# Hidden example\n</custom-element>\n\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      { name: "MDX indented Setext heading", body: "    Real title\n    ===", formats: ["mdx"] },
      { name: "MDX tab Setext heading", body: "\tReal title\n\t===", formats: ["mdx"] },
      {
        "name": "default exported regex",
        "body": "export default /foo/\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "regex after else",
        "body": '{(() => { if (true) {} else /[{]/.test("x"); })()}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "regex after do",
        "body": '{(() => { do /[{]/.test("x"); while(false); })()}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "JSX after typeof",
        "body": "{typeof <div>It's content</div>}\n\n# Real title",
        "formats": ["mdx"],
      },
      { "name": "bare import is Markdown", "body": "import\n\n# Real title", "formats": ["mdx"] },
      { "name": "bare export is Markdown", "body": "export\n\n# Real title", "formats": ["mdx"] },
      {
        "name": "tab after export is Markdown",
        "body": "export\tconst example =\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "indented export is Markdown",
        "body": "  export const example =\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "export cannot interrupt paragraph",
        "body": "Paragraph\nexport const example =\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "postfix increment completes ESM",
        "body": "export const value = counter++\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "postfix decrement completes ESM",
        "body": "export const value = counter--\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "prefix increment still needs operand",
        "body": "export const value = ++\n\ncounter\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "postfix division keeps regex operand",
        "body": 'export const value = counter++ / /[{]/.test("x")\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "labelled block before regex",
        "body": 'export function f() { label: {} /[{]/.test("x"); }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "case block before regex",
        "body":
          'export function f() { switch (1) { case 1: {} /[{]/.test("x"); } }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "ternary case label before regex",
        "body":
          'export function f() { switch (1) { case true ? 1 : 2: {} /[{]/.test("x"); } }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "object property is not a statement label",
        "body": "export const value = ({ label: {} }) / 2\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "method body owns labelled statements",
        "body": 'export const value = { method() { label: {} /[{]/.test("x"); } }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "static body owns labelled statements",
        "body": 'export class Example { static { label: {} /[{]/.test("x"); } }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "for-of separator before regex",
        "body": 'export function f() { for (const x of /[{]/.exec("{")) {} }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "for-await-of separator before regex",
        "body":
          'export async function f() { for await (const x of /[{]/.exec("{")) {} }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "expression for-of separator before regex",
        "body": '{(() => { for (const x of /[{]/.exec("{")) {} })()}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "JSX attribute for-of separator before regex",
        "body":
          '<Component value={(() => { for (const x of /[{]/.exec("{")) {} })()} />\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "ordinary of identifier preserves division",
        "body": "export const of = 4 / 2\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "for initializer of identifier preserves division",
        "body": "export function f() { for (of / 2; false;) {} }\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "for member of preserves division",
        "body": "export function f() { for (object.of / 2; false;) {} }\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "bare reference destination greater-than",
        "body": "[ref]: https://example.com/search?q=a>b\n===\n# Real title",
        "formats": ["md", "mdx", "pdf", "html", "docx"],
      },
      {
        "name": "bare reference destination less-than",
        "body": "[ref]: https://example.com/search?q=a<b\n===\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        "name": "continued bare reference destination angle",
        "body": "[ref]:\n  https://example.com/search?q=a>b\n===\n# Real title",
        "formats": ["md", "mdx", "pdf", "html", "docx"],
      },
      {
        "name": "ASI block in ESM",
        "body": 'export function f() {\nconst a = 1\n{}\n/[{]/.test("x");\n}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "ASI block in expression",
        "body": '{(() => {\nconst a = 1\n{}\n/[{]/.test("x");\n})()}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "ASI block in JSX attribute",
        "body":
          '<Component value={(() => {\nconst a = 1\n{}\n/[{]/.test("x");\n})()} />\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "return ASI before block",
        "body": 'export function f() { return\n{}\n/[{]/.test("x"); }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "yield ASI before block",
        "body": 'export function* f() { yield\n{}\n/[{]/.test("x"); }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "newline object operand retains division",
        "body": 'export function f() { const a =\n{} / /[{]/.test("x"); }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "newline return object retains division",
        "body": 'export function f() { return (\n{} / /[{]/.test("x")); }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "newline arrow body remains an expression",
        "body": 'export const f = (() =>\n{}) / /[{]/.test("x")\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "newline parenthesized object retains division",
        "body": 'export function f() { const a = (\n{}) / /[{]/.test("x"); }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "newline operator continuation keeps object operand",
        "body": 'export function f() { const a = 1 +\n{} / /[{]/.test("x"); }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression ESM: class",
        "body": 'export function f() { const C = class\n{} / /[{]/.test("x"); }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression expression: class",
        "body": '{(() => { const C = class\n{} / /[{]/.test("x"); })()}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression attribute: class",
        "body":
          '<Component value={(() => { const C = class\n{} / /[{]/.test("x"); })()} />\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression template: class",
        "body":
          'export const s = `${(() => { const C = class\n{} / /[{]/.test("x"); })()}`\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression ESM: class C",
        "body": 'export function f() { const C = class C\n{} / /[{]/.test("x"); }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression expression: class C",
        "body": '{(() => { const C = class C\n{} / /[{]/.test("x"); })()}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression attribute: class C",
        "body":
          '<Component value={(() => { const C = class C\n{} / /[{]/.test("x"); })()} />\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression template: class C",
        "body":
          'export const s = `${(() => { const C = class C\n{} / /[{]/.test("x"); })()}`\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression ESM: class extends Object",
        "body":
          'export function f() { const C = class extends Object\n{} / /[{]/.test("x"); }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression expression: class extends Object",
        "body":
          '{(() => { const C = class extends Object\n{} / /[{]/.test("x"); })()}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression attribute: class extends Object",
        "body":
          '<Component value={(() => { const C = class extends Object\n{} / /[{]/.test("x"); })()} />\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression template: class extends Object",
        "body":
          'export const s = `${(() => { const C = class extends Object\n{} / /[{]/.test("x"); })()}`\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression ESM: class C extends Object",
        "body":
          'export function f() { const C = class C extends Object\n{} / /[{]/.test("x"); }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression expression: class C extends Object",
        "body":
          '{(() => { const C = class C extends Object\n{} / /[{]/.test("x"); })()}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression attribute: class C extends Object",
        "body":
          '<Component value={(() => { const C = class C extends Object\n{} / /[{]/.test("x"); })()} />\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "multiline class expression template: class C extends Object",
        "body":
          'export const s = `${(() => { const C = class C extends Object\n{} / /[{]/.test("x"); })()}`\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "ASI declaration in ESM",
        "body":
          'export function f() {\nconst x = 1\nfunction helper() {}\n/[{]/.test("x")\n}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "ASI declaration in expression",
        "body":
          '{(() => {\nconst x = 1\nfunction helper() {}\n/[{]/.test("x")\n})()}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "ASI declaration in JSX attribute",
        "body":
          '<Component value={(() => {\nconst x = 1\nfunction helper() {}\n/[{]/.test("x")\n})()} />\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "function expression retains division",
        "body": 'export const value =\nfunction helper() {} / /[{]/.test("x")\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "class after ASI is a declaration",
        "body":
          'export function f() { const x = 1\nclass Example {}\n/[{]/.test("x") }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "return ASI before declaration",
        "body":
          'export function f() { return\nfunction helper() {}\n/[{]/.test("x") }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "quoted empty * retains paragraph",
        "body": "> Note\n> *\ncontinued\n===\n# Real title",
        "formats": ["md", "mdx", "pdf", "html", "docx"],
      },
      {
        "name": "quoted empty + retains paragraph",
        "body": "> Note\n> +\ncontinued\n===\n# Real title",
        "formats": ["md", "mdx", "pdf", "html", "docx"],
      },
      {
        "name": "quoted empty 1. retains paragraph",
        "body": "> Note\n> 1.\ncontinued\n===\n# Real title",
        "formats": ["md", "mdx", "pdf", "html", "docx"],
      },
      {
        "name": "quoted empty 2. retains paragraph",
        "body": "> Note\n> 2.\ncontinued\n===\n# Real title",
        "formats": ["md", "mdx", "pdf", "html", "docx"],
      },
      {
        "name": "quote tab retains source column",
        "body": "> \tNote\ncontinued\n===\n# Real title",
        "formats": ["md", "mdx", "pdf", "html", "docx"],
      },
      {
        "name": "MDX quote has no indented code",
        "body": ">     Note\ncontinued\n===\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "nested quote starts its own empty item",
        "body": "> Note\n> > *\ncontinued\n===\n# Real title",
        "title": "continued",
        "slug": "continued",
        "formats": ["md", "pdf"],
      },
      {
        "name": "missing quote prefix ends ```",
        "body": "> ```\n\n> Note\n<span>\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        "name": "missing quote prefix ends ~~~",
        "body": "> ~~~\n\n> Note\n<span>\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        "name": "missing quote prefix ends <script>",
        "body": "> <script>\n\n> Note\n<span>\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        "name": "missing quote prefix ends <!--",
        "body": "> <!--\n\n> Note\n<span>\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        "name": "ESM numeric atom 1.",
        "body": "export const value = 1.\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "ESM numeric atom 1.e2",
        "body": "export const value = 1.e2\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "ESM numeric atom 0x10n",
        "body": "export const value = 0x10n\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "ESM numeric atom 1..\n\ntoString()",
        "body": "export const value = 1..\n\ntoString()\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "ESM requires void operand",
        "body":
          "export const example = void\n\n    <Component>\n      # Internal example\n    </Component>\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "expression requires void operand",
        "body":
          "{void\n\n    <Component>\n      # Internal example\n    </Component>}\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "JSX attribute requires void operand",
        "body":
          "<Outer value={void\n\n    <Component>\n      # Internal example\n    </Component>} />\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "ESM requires typeof operand",
        "body":
          "export const example = typeof\n\n    <Component>\n      # Internal example\n    </Component>\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "expression requires typeof operand",
        "body":
          "{typeof\n\n    <Component>\n      # Internal example\n    </Component>}\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "JSX attribute requires typeof operand",
        "body":
          "<Outer value={typeof\n\n    <Component>\n      # Internal example\n    </Component>} />\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "ESM requires new operand",
        "body":
          "export const example = new\n\n    <Component>\n      # Internal example\n    </Component>\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "expression requires new operand",
        "body":
          "{new\n\n    <Component>\n      # Internal example\n    </Component>}\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "JSX attribute requires new operand",
        "body":
          "<Outer value={new\n\n    <Component>\n      # Internal example\n    </Component>} />\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "ESM requires delete operand",
        "body":
          "export const example = delete\n\n    <Component>\n      # Internal example\n    </Component>\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "expression requires delete operand",
        "body":
          "{delete\n\n    <Component>\n      # Internal example\n    </Component>}\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "JSX attribute requires delete operand",
        "body":
          "<Outer value={delete\n\n    <Component>\n      # Internal example\n    </Component>} />\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "class property is not a declaration",
        "body": 'export const props = { class: "notice" }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "function property is not a declaration",
        "body": 'export const props = { function: "handler" }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "commented class property is not a declaration",
        "body": 'export const props = { class /* note */: "notice" }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "spread regex array",
        "body": 'export const match = [.../[{]/.exec("{")]\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "spread JSX operand",
        "body": "export const value = { ...<A>It's text</A> }\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "spread regex expression",
        "body": '{collect(.../[{]/.exec("{"))}\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "debugger ASI regex",
        "body": 'export function run() { debugger\n/[{]/.test("{"); }\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "debugger comment ASI regex attribute",
        "body":
          '<Component value={() => { debugger /* newline\n*/ /[{]/.test("{"); }} />\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "reference preserves inline HTML interruption context",
        "body": "[ref]: /url\n<span>\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        "name": "lazy quote Setext-like continuation",
        noHeading: true,
        "body": "> Note\ncontinued\n===\n<span>\n</span>\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        "name": "nested reference outdented empty sibling",
        "body": "- Outer\n  - Parent\n    - [ref]:\n    1.\n      Child\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "comparison regex ESM",
        "body": "export const matches = count > /[{]/.test(value)\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "less than regex expression",
        "body": "{count < /[{]/.test(value)}\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "shift regex attribute",
        "body": "<Component value={count >>> /[{]/.test(value)} />\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "break ASI regex",
        "body":
          "export function run() { while (true) { break\n/[{]/.test(value); } }\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "continue label ASI regex",
        "body":
          "{(() => { outer: while (true) { continue outer\n/[{]/.test(value); } })()}\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "continue comment ASI regex attribute",
        "body":
          "<Component value={() => { while (true) { continue /* newline\n*/ /[{]/.test(value); } }} />\n\n# Real title",
        "formats": ["mdx"],
      },
      {
        "name": "reference destination outdented empty sibling",
        "body": "- [ref]:\n1.\n  # Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "reference label outdented empty sibling",
        "body": "- [ref\n1.\n  # Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "reference title outdented empty sibling",
        "body": '- [ref]: /url "title\n1.\n  # Real title',
        "formats": ["md", "pdf"],
      },
      {
        "name": "completed reference before indented code",
        "body": "[ref]: /url\n    # Internal example\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "completed reference before empty list",
        "body": "[ref]: /url\n-\n  Internal example\n# Real title",
        "formats": ["md", "pdf"],
      },
      {
        "name": "named import keywords are not declarations",
        "body": 'import { class as themeClass, function as handler } from "theme"\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "named reexport keywords are not declarations",
        "body": 'export { class as themeClass, function as handler } from "theme"\n\n# Real title',
        "formats": ["mdx"],
      },
      {
        "name": "decreased quote depth retains lazy paragraph",
        "body": "> > Note\n>     Continued note\n<br>\n# Real title",
        "formats": ["md", "pdf", "html", "docx"],
      },
      {
        name: "class heritage expression retains keyword position",
        body:
          'export class Outer extends class Inner {} { static { label: {} /[{]/.test("x"); } }\n\n# Real title',
        formats: ["mdx"],
      },
      { name: "MDX indented heading", body: "    # Real title", formats: ["mdx"] },
      { name: "MDX tab heading", body: "\t# Real title", formats: ["mdx"] },
      {
        name: "MDX indented fence",
        body: "    ```md\n# Internal example\n```\n\n# Real title",
        formats: ["mdx"],
      },
      {
        name: "indented reference title",
        body: '[ref]: /url\n    "optional title"\n===\n<span>\n# Real title',
        formats: ["md", "pdf", "html", "docx"],
      },
      {
        name: "indented successive definition",
        body: "[ref]: /url\n    [other]: /other\n===\n<span>\n# Real title",
        formats: ["md", "pdf", "html", "docx"],
      },
      {
        name: "quoted bullet paragraph",
        body: "> - item\n<span>\n# Real title",
        formats: ["md", "pdf", "html"],
      },
      {
        name: "quoted ordered paragraph",
        body: "> 1. item\n<span>\n# Real title",
        formats: ["md", "pdf", "html"],
      },
      {
        name: "nested quoted fence closure",
        body: "> > ```\n> > ```\n> Text\n<span>\n# Real title",
        formats: ["md", "pdf", "html"],
      },
      {
        name: "nested quoted HTML depth exit",
        body: "> > <div>\n> Text\n<span>\n# Real title",
        formats: ["md", "pdf", "html"],
      },
      {
        name: "does not parse definition-shaped text inside a paragraph",
        title: "Intro [ref]: https://example.com",
        slug: "intro-ref-https-example-com",
        body: "Intro\n[ref]: https://example.com\n===\n- -\nProse\n  # Real title",
        formats: ["md", "pdf"],
      },
      {
        name: "resets blockquote context after a blank line",
        body: "> Note\n\nIntroduction\n<span>\n</span>\n# Real title",
        formats: ["md", "pdf"],
      },
      {
        name: "recognizes setext headings after a closed blockquote",
        body: "> Note\n\nOverview\n-\n  # Real title",
        formats: ["md", "mdx", "pdf"],
      },
      {
        name: "consumes link reference titles as part of the definition",
        body: '[ref]: /url\n"reference title"\n===\n<span>\n# Real title',
        formats: ["md", "pdf"],
      },
      {
        name: "ends an empty nested list after a blockquote",
        body: "> Note\n- -\nIntroduction\n  # Real title",
        formats: ["md", "mdx", "pdf"],
      },
      {
        name: "keeps HTML-shaped lazy lines inside nested-list paragraphs",
        body: "   - - item\n    <span>\n</span>\n# Real title",
        formats: ["md", "pdf"],
      },
      {
        name: "retains nested blockquote paragraph context",
        body: "> > text\n<span>\n# Real title",
        formats: ["md", "pdf"],
      },
      {
        name: "recognizes a nested blockquote before outdented prose",
        body: "- item\n    >\nProse outside the list.\n  # Real title",
        formats: ["md", "mdx", "pdf"],
      },
      {
        name: "retains an outer list after an empty nested item",
        body: "- -\n\n  <span>\n# Real title",
        formats: ["md", "pdf"],
      },
      {
        name: "tracks an empty sibling after an implicitly closed block",
        body: "- <div>\n-\n\n  # Real title",
        formats: ["md", "pdf"],
      },
      {
        name: "tracks an empty sibling after an implicitly closed fence",
        body: "- ```\n-\n\n  # Real title",
        formats: ["md", "mdx", "pdf"],
      },
      {
        name: "does not treat multiline link destinations as setext headings",
        body: "[ref]:\nhttps://example.com\n===\n<span>\n# Real title",
        formats: ["md", "pdf"],
      },
    ];
    try {
      for (const [index, fixture] of fixtures.entries()) {
        for (const extension of fixture.formats) {
          const filePath = join(root, `source-${index}.${extension}`);
          await Deno.writeTextFile(filePath, fixture.body);
          const result = await runKnowledgeParser({
            filePath,
            outputDir: join(root, `out-${index}-${extension}`),
          }, { extractDocumentText: () => Promise.resolve(fixture.body) });
          assertEquals(
            result.title,
            fixture.noHeading ? `source-${index}` : fixture.title ?? "Real title",
            fixture.name,
          );
          assertEquals(
            result.slug,
            fixture.noHeading ? `source-${index}` : fixture.slug ?? "real-title",
            fixture.name,
          );
        }
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("matches rendered HTML block ownership after lazy container tags", async () => {
    const root = await makeTempDir({ prefix: "knowledge-lazy-tag-block-" });
    // The content renderer uses remark-parse 11, which turns complete lazy tags
    // into container-owned HTML blocks. A following dedent starts a root block.
    const fixtures = [
      { body: "- Item\n<custom>\n</custom>\n# Hidden\n\n# Actual title", title: "Actual title" },
      { body: "- Item\n<span>\n<span>\n# Hidden\n\n# Actual title", title: "Actual title" },
      { body: "- Item\n<span>\ntext\n===\n\n# Actual title", title: "text" },
      {
        body: "- Item\n<span>\n  text\n</span>\n# Hidden\n\n# Actual title",
        title: "Actual title",
      },
      { body: "> Item\n<custom>\n</custom>\n# Hidden\n\n# Actual title", title: "Actual title" },
      {
        body: "- Item\n  > Text\n<span>\n</span>\n# Hidden\n\n# Actual title",
        title: "Actual title",
      },
      { body: "- Item\n  <custom>\n</custom>\n# Hidden\n\n# Actual title", title: "Hidden" },
      { body: "> Item\n> <custom>\n</custom>\n# Hidden\n\n# Actual title", title: "Hidden" },
      { body: "- Item\ntext\n</custom>\n# Hidden\n\n# Actual title", title: "Hidden" },
      { body: "Intro\n<custom>\n</custom>\n# Hidden\n\n# Actual title", title: "Hidden" },
    ];
    try {
      for (const [index, fixture] of fixtures.entries()) {
        for (const extension of ["md", "pdf", "html", "docx"]) {
          const filePath = join(root, `source-${index}.${extension}`);
          await Deno.writeTextFile(filePath, fixture.body);
          const result = await runKnowledgeParser({
            filePath,
            outputDir: join(root, `out-${index}-${extension}`),
          }, {
            extractDocumentText: () => Promise.resolve(fixture.body),
          });
          assertEquals(result.title, fixture.title, fixture.body);
        }
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("retains lazy HTML owners when quote and list prefixes resume", async () => {
    const root = await makeTempDir({ prefix: "knowledge-html-owner-resumption-" });
    // Reference expectations were checked against the content renderer's remark-parse 11.
    const owners: [string, string[]][] = [
      ["> Quoted text", ["> continued", "> ===", ">", "> ## Section", "continued"]],
      ["> [a]: /url", ["> continued", "> ===", ">", "> ## Section"]],
      ["> ## Heading", ["> continued", "> ===", ">", "> ## Section"]],
      ["- Item", ["  continued", "  ===", "  ", "  ## Section", "continued"]],
      ["- [a]: /url", ["  continued", "  ===", "  ", "  ## Section"]],
      ["- > Quoted text", ["  > continued", "  > ===", "  >", "  > ## Section"]],
      ["> - Item", [">   continued", ">   ===", ">", ">   ## Section"]],
      ["> > Quoted text", ["> > continued", "> > ===", ">", "> continued"]],
    ];
    try {
      let index = 0;
      for (const [first, continuations] of owners) {
        for (const continuation of continuations) {
          for (const tag of ["<span>", "<custom>", "</custom>"]) {
            const body = `${first}\n${tag}\n${continuation}\n<span>\n# Example\n</span>\n\n# Guide`;
            // Plain text after the owner ends remains a paragraph; its inline tag
            // cannot hide the following heading. Partial nested-quote exit agrees.
            const title = continuation === "continued" ||
                (first === "> > Quoted text" && continuation === "> continued")
              ? "Example"
              : "Guide";
            for (const extension of ["md", "pdf", "html", "docx"]) {
              const filePath = join(root, `source-${index}.${extension}`);
              await Deno.writeTextFile(filePath, body);
              const result = await runKnowledgeParser({
                filePath,
                outputDir: join(root, `out-${index}-${extension}`),
              }, { extractDocumentText: () => Promise.resolve(body) });
              assertEquals(result.title, title, body);
            }
            index += 1;
          }
        }
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("keeps lazy HTML paragraph continuations separate from root HTML blocks", async () => {
    const root = await makeTempDir({ prefix: "veryfront-heading-lazy-html-" });
    // Expected titles follow the remark parser used by the content renderer.
    const fixtures = [
      { body: "> Note\n> > <span>\n<span>\n# Hidden\n\n# Real title", title: "Real title" },
      { body: "> Note\n> - <span>\n<span>\n# Hidden\n\n# Real title", title: "Real title" },
      { body: "> Note\n> - <span>\ntext\n===\n\n# Real title", title: "text" },
      { body: "> Note\n<span>\n</span>\n# Hidden\n\n# Real title", title: "Real title" },
      { body: "- Item\n<span>\n</span>\n# Hidden\n\n# Real title", title: "Real title" },
      { body: "> Note\n<br/>\n<span>\n# Hidden\n</span>\n\n# Real title", title: "Real title" },
      { body: "- Item\n<br/>\n<span>\n# Hidden\n</span>\n\n# Real title", title: "Real title" },
      { body: "> Note\n> <span>\n> </span>\n# Hidden\n\n# Real title", title: "Hidden" },
      { body: "- Item\n  <span>\n  </span>\n# Hidden\n\n# Real title", title: "Hidden" },
      { body: "Intro\n<span>\n</span>\n# Hidden\n\n# Real title", title: "Hidden" },
      { body: "> Note\n<br/>\n# Real title", title: "Real title" },
      { body: "- Item\n<br/>\n# Real title", title: "Real title" },
      { body: "> Note\n\n<span>\n# Hidden\n</span>\n\n# Real title", title: "Real title" },
      { body: "- Item\n\n<span>\n# Hidden\n</span>\n\n# Real title", title: "Real title" },
    ];
    try {
      for (const [index, fixture] of fixtures.entries()) {
        for (const extension of ["md", "pdf", "html", "docx"]) {
          const body = `${fixture.body}\n`;
          const filePath = join(root, `source-${index}.${extension}`);
          await Deno.writeTextFile(filePath, body);
          const result = await runKnowledgeParser({
            filePath,
            outputDir: join(root, `out-${index}-${extension}`),
          }, { extractDocumentText: () => Promise.resolve(body) });
          assertEquals(result.title, fixture.title, fixture.body);
          const output = await Deno.readTextFile(result.sandbox_output_path);
          assertEquals(output.endsWith(body), true);
        }
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("keeps heading selection aligned with paragraph and container boundaries", async () => {
    const root = await makeTempDir({ prefix: "veryfront-knowledge-heading-context-" });
    const cases = [
      {
        content: "- Item\n<span>\n  ~~~md\n# Example\n  ~~~\n</span>\n\n# Real title",
        title: "Example",
      },
      { content: "- Item\n<span>\n</span>\n\n  # Real title", title: "Real title" },
      { content: "> Note\n</span>\n<script>\n\n# Real title" },
      // CommonMark §5.2 permits an empty item after code; its fence closes on root dedent.
      { content: "    /url\n-\n  > text\n<widget>\n  ````\n# Real title", title: "Real title" },
      {
        content: "    <script>\n-\n  - ```\n  > text\n\n    - item\n<widget>\n  ```\n# Real title",
        title: "Real title",
      },
      { content: '    code\n\t\n- -\n[ref]: /url "\n  # Real title', title: "Real title" },
      { content: "    code\n2. item\n   # Nested title" },
      { content: "> ```\n> text\n<span>\n # Hidden" },
      { content: "> <div>\n\n  ```\n # Hidden" },
      {
        content: "- > text\n    > text\n    <div>\n  > text\n\\\n\\\n   # Real title",
        title: "Real title",
      },
      { content: '> \n    code\n\t\n- -\n[ref]: /url "\n  # Real title', title: "Real title" },
      { content: "1. - item\n    <widget>\ntext\n   # Real title", title: "Real title" },
      { content: "[ref]:\n```js\n# Hidden" },
      {
        "content": "- <!-- -->\n  - <div>\n  -\n  </script>\n# Real title",
        "title": "Real title",
      },
      {
        "content": "  - item\n  </widget>\n</widget>\n<script>\n\n# Real title",
        title: "Real title",
      },
      {
        "content": "[ref]:\n<widget>\n===\n  </script>\n# Real title",
        "title": "Real title",
      },
      {
        "content": "    ```\n> text\n<widget />\n  </widget>\n# Real title",
      },
      {
        "content": "    ```\n  - item\n<widget />\n  <widget>\n# Real title",
      },
      {
        "content": "  > text\n</widget>\n  <widget>\n- <!-- -->\n  ```\n# Real title",
      },
      {
        "content": "- item\n</script>\n<widget />\n  ````\n# Real title",
      },
      {
        "content": "> text\n  -->\n===\n  </widget>\n# Real title",
        "title": "Real title",
      },
      {
        "content": "  2. item\n    ---\n<widget>\n# Real title",
        "title": "Real title",
      },
      {
        "content": "  > text\n</widget>\n===\n</script>\n# Real title",
        "title": "Real title",
      },
      {
        "content": "- item\n===\n  <div>\n# Real title",
        "title": "Real title",
      },
    ];
    try {
      for (const [index, fixture] of cases.entries()) {
        const filePath = join(root, `source-${index}.md`);
        await Deno.writeTextFile(filePath, fixture.content);
        const result = await runKnowledgeParser({
          filePath,
          outputDir: join(root, `out-${index}`),
        });
        assertEquals(result.title, fixture.title ?? `source-${index}`, fixture.content);
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("preserves root Setext H1 titles without adding a duplicate heading", async () => {
    const root = await makeTempDir({ prefix: "veryfront-setext-heading-" });
    const fixtures = [
      { body: "Real title\n===\n", title: "Real title" },
      { "body": "> Note\n<Component />\nTitle\n===\n", "title": "Title", "formats": ["mdx"] },
      { "body": "> Note\n{1}\nTitle\n===\n", "title": "Title", "formats": ["mdx"] },

      { "body": "{1} Intro\n===\n", "title": "{1} Intro", "formats": ["mdx"] },
      { "body": "<Banner /> Intro\n===\n", "title": "<Banner /> Intro", "formats": ["mdx"] },
      {
        "body": "<Banner>Intro\nmore</Banner>\n===\n",
        "title": "<Banner>Intro more</Banner>",
        "formats": ["mdx"],
      },
      { "body": "{\n  1\n} Intro\n===\n", "title": "{ 1 } Intro", "formats": ["mdx"] },
      { "body": "<Banner /> {1}\n===\n# Real title\n", "title": "Real title", "formats": ["mdx"] },

      { body: "Foo\n-------------------------\n\nFoo\n=\n", title: "Foo" },
      { body: "   Foo\n---\n\n  Foo\n-----\n\n  Foo\n  ===\n", title: "Foo" },
      { body: "[foo]: /url\nbar\n===\n[foo]\n", title: "bar" },
      { body: "A multiline\nauthored title\n===\n", title: "A multiline authored title" },
      { body: '[ref]: /url\n"not a title" extra\n===\n', title: '"not a title" extra' },
    ];
    try {
      for (const [index, fixture] of fixtures.entries()) {
        for (const extension of fixture.formats ?? ["md", "mdx", "pdf", "html", "docx"]) {
          for (const sourceKind of ["local", "upload"] as const) {
            const filePath = join(root, `source-${index}.${extension}`);
            await Deno.writeTextFile(filePath, fixture.body);
            const result = await runKnowledgeParser({
              filePath,
              sourceKind,
              outputDir: join(root, `out-${index}-${extension}-${sourceKind}`),
            }, { extractDocumentText: () => Promise.resolve(fixture.body) });
            assertEquals(result.title, fixture.title);
            const output = await Deno.readTextFile(result.sandbox_output_path);
            assertEquals(output.endsWith(fixture.body), true);
            assertEquals(output.includes("# source-"), false);
          }
        }
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("keeps empty authored root H1s while using filename metadata", async () => {
    const root = await makeTempDir({ prefix: "veryfront-empty-heading-" });
    const fixtures = [
      { body: "#\n", rootHeading: true },
      { body: "#   \n\nBody\n", rootHeading: true },
      { body: "# ###\n", rootHeading: true },
      { body: "#\n\n# Later title\n", rootHeading: true },
      { body: "- #\n", rootHeading: false },
      { body: "> #\n", rootHeading: false },
      { body: "```md\n#\n```\n", rootHeading: false },
      { body: "<script>\n#\n</script>\n", rootHeading: false, formats: ["md", "pdf"] },
    ];
    try {
      for (const [index, fixture] of fixtures.entries()) {
        for (const extension of fixture.formats ?? ["md", "mdx", "pdf"]) {
          const filePath = join(root, `source-${index}.${extension}`);
          await Deno.writeTextFile(filePath, fixture.body);
          const result = await runKnowledgeParser({
            filePath,
            outputDir: join(root, `out-${index}-${extension}`),
          }, { extractDocumentText: () => Promise.resolve(fixture.body) });
          assertEquals(result.title, `source-${index}`);
          const output = await Deno.readTextFile(result.sandbox_output_path);
          assertEquals(output.endsWith(fixture.body), true, `${extension}: ${fixture.body}`);
          assertEquals(
            output.includes(`\n# source-${index}\n`),
            !fixture.rootHeading,
            fixture.body,
          );
        }
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("writes OKF Document frontmatter and titles a document without an H1 from its file name", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-parser-test-" });
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
      assertEquals(result.title, "q1-report");
      assertEquals(result.sandbox_output_path, join(outputDir, "q1-report.md"));

      const markdown = await Deno.readTextFile(result.sandbox_output_path);
      const frontmatter = markdown.split("\n---\n")[0]!;
      assertStringIncludes(frontmatter, 'type: "Document"');
      assertStringIncludes(frontmatter, 'title: "q1-report"');
      assertStringIncludes(frontmatter, 'description: "Quarterly performance summary"');
      assertStringIncludes(frontmatter, 'resource: "uploads/contracts/q1-report.txt"');
      assertStringIncludes(frontmatter, 'tags: ["upload","txt"]');
      assertStringIncludes(frontmatter, 'source: "q1-report.txt"');
      assertStringIncludes(frontmatter, 'source_type: "txt"');
      assertStringIncludes(frontmatter, `by: "veryfront/${VERSION}"`);
      const timestamp = frontmatter.match(/^timestamp: "([^"]+)"$/m)?.[1];
      const added = frontmatter.match(/^added: "([^"]+)"$/m)?.[1];
      assertEquals(new Date(timestamp ?? "").toISOString(), timestamp);
      assertEquals(added, timestamp);
      assertEquals(markdown.includes("Generated Document"), false);
      assertStringIncludes(markdown, "\n# q1-report\n");
      assertStringIncludes(markdown, "Quarterly revenue increased 12% year over year.");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("titles and names a Studio upload from its own H1 without a synthetic heading", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-parser-h1-" });
    const fileName = "20. Create an account, invite a member.md";
    const filePath = join(
      tempDir,
      "chat-11111111-2222-3333-4444-555555555555-1700000000000-xyz99-a.md",
    );
    const outputDir = join(tempDir, "knowledge-output");

    try {
      await Deno.writeTextFile(
        filePath,
        "```md\n```not-a-close\n# Not the title\n```\n\n# 20. Create a team account and invite a member\n\nOpen Settings.",
      );

      const result = await runKnowledgeParser({
        filePath,
        outputDir,
        sourceName: fileName,
        resource: fileName,
        sourceReference: `uploads/_knowledge-ingest/20261110201703921-e763c00b/${fileName}`,
      });

      assertEquals(result.title, "20. Create a team account and invite a member");
      assertEquals(result.slug, "create-a-team-account-and-invite-a-member");
      assertEquals(
        result.sandbox_output_path,
        join(outputDir, "create-a-team-account-and-invite-a-member.md"),
      );
      const markdown = await Deno.readTextFile(result.sandbox_output_path);
      assertStringIncludes(markdown, 'title: "20. Create a team account and invite a member"');
      assertStringIncludes(markdown, `resource: ${JSON.stringify(fileName)}`);
      assertStringIncludes(markdown, `source: ${JSON.stringify(fileName)}`);
      assertStringIncludes(markdown, `description: ${JSON.stringify(`Parsed from ${fileName}`)}`);
      assertEquals(markdown.includes("_knowledge-ingest"), false);
      assertEquals(markdown.match(/^# /gm)?.length, 2);
      assertEquals(markdown.includes("# 20. Create An Account"), false);
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("adds a short suffix when two documents in one run share a title", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-parser-collide-" });
    const outputDir = join(tempDir, "knowledge-output");

    try {
      const paths = [join(tempDir, "a.md"), join(tempDir, "b.md")];
      for (const path of paths) await Deno.writeTextFile(path, "# Overview\n\nText.");

      const results = await runKnowledgeParsers({
        files: paths.map((filePath) => ({ filePath })),
        outputDir,
      });

      assertEquals(results.map((result) => result.slug), ["overview", "overview-2"]);
      assertEquals(await Deno.readTextFile(join(outputDir, "overview.md")) !== "", true);
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("reuses the output name when the same source is parsed again", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-parser-repeat-" });
    const outputDir = join(tempDir, "knowledge-output");
    const filePath = join(tempDir, "a.md");

    try {
      await Deno.writeTextFile(filePath, "# Overview\n\nText.");
      const first = await runKnowledgeParser({ filePath, outputDir, resource: "a.md" });
      const second = await runKnowledgeParser({ filePath, outputDir, resource: "a.md" });

      assertEquals([first.slug, second.slug], ["overview", "overview"]);
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("preserves generated documents titled Index or Log through OKF bundle parsing", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-parser-reserved-" });
    const outputDir = join(tempDir, "knowledge-output");

    try {
      for (const title of ["Index", "Log"]) {
        const filePath = join(tempDir, `${title.toLowerCase()}.md`);
        await Deno.writeTextFile(filePath, `# ${title}\n\nText.`);
        const generated = await runKnowledgeParser({ filePath, outputDir });
        assertEquals(generated.title, title);
        assertEquals(generated.slug, `${title.toLowerCase()}-document`);

        const preserved = await runKnowledgeParser({
          filePath: generated.sandbox_output_path,
          outputDir: join(tempDir, "bundle"),
          okfRelativePath: `${generated.slug}.md`,
        });
        assertEquals(preserved.document_kind, "okf_concept");
        assertEquals(preserved.okf?.envelope_conforms, true);
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("keeps a slug from a long H1 within a short file name", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-parser-long-" });
    const outputDir = join(tempDir, "knowledge-output");
    const filePath = join(tempDir, "a.md");

    try {
      await Deno.writeTextFile(filePath, `# ${"long title ".repeat(30)}\n\nText.`);
      const result = await runKnowledgeParser({ filePath, outputDir });

      assert(result.slug.length <= 80, result.slug);
      assertEquals(result.slug.endsWith("-"), false);
      assertStringIncludes(await Deno.readTextFile(result.sandbox_output_path), "Text.");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("ignores a comment in leading YAML frontmatter when finding the title", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-parser-frontmatter-" });
    const outputDir = join(tempDir, "knowledge-output");
    const filePath = join(tempDir, "a.md");

    try {
      await Deno.writeTextFile(filePath, "---\n# generated by a tool\nk: v\n---\n\n# Real title\n");
      const result = await runKnowledgeParser({ filePath, outputDir });

      assertEquals(result.title, "Real title");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("titles a code file from its file name, not a leading comment", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-parser-code-" });
    const outputDir = join(tempDir, "knowledge-output");
    const filePath = join(tempDir, "run_benchmark.py");

    try {
      await Deno.writeTextFile(filePath, "# Copyright notice\nprint('hi')\n");
      const result = await runKnowledgeParser({ filePath, outputDir });

      assertEquals(result.title, "run_benchmark");
      assertEquals(result.slug, "run-benchmark");
      assertStringIncludes(
        await Deno.readTextFile(result.sandbox_output_path),
        "\n# run_benchmark\n",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("uses an absolute URL source as the OKF resource", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-parser-url-" });
    const filePath = join(tempDir, "source.txt");
    const outputDir = join(tempDir, "knowledge-output");

    try {
      await Deno.writeTextFile(filePath, "Source text.");

      const result = await runKnowledgeParser({
        filePath,
        outputDir,
        slug: "source",
        sourceReference: "https://example.com/source.txt",
      });

      const markdown = await Deno.readTextFile(result.sandbox_output_path);
      assertStringIncludes(markdown, 'resource: "https://example.com/source.txt"');
      assertStringIncludes(markdown, 'tags: ["txt"]');
      assertEquals(markdown.includes("sources:"), false);
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("delegates PDF extraction to the Kreuzberg document extractor contract", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-parser-kreuzberg-" });
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
      assertStringIncludes(markdown, 'resource: "uploads/offers/offer.pdf"');
      assertStringIncludes(markdown, 'source: "offer.pdf"');
      assertStringIncludes(markdown, 'description: "Offer PDF"');
      assertStringIncludes(markdown, "\n# offer\n");
      assertStringIncludes(markdown, "Kreuzberg PDF text");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("preserves markdown returned by rich document extraction without inferring headings", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-parser-headings-" });
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
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-parser-progress-" });
    const filePath = join(tempDir, "manual.pdf");
    const outputDir = join(tempDir, "knowledge-output");
    const progressEvents: unknown[] = [];

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
      assertStringIncludes(markdown, "\n# manual\n");
      assertStringIncludes(markdown, "Page one text");
      assertStringIncludes(markdown, "Page two text");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });
});

describe("concurrent local knowledge allocation", () => {
  it("preserves a dangling output symlink without writing its target", async () => {
    const root = await makeTempDir({ prefix: "veryfront-knowledge-dangling-output-" });
    try {
      const filePath = join(root, "source.md");
      const outputDir = join(root, "out");
      const missingTarget = join(root, "missing.md");
      const danglingPath = join(outputDir, "shared-heading.md");
      await Deno.writeTextFile(filePath, "# Shared heading\n\nOriginal source.\n");
      await Deno.mkdir(outputDir);
      await Deno.symlink(missingTarget, danglingPath);
      try {
        const result = await runKnowledgeParser({ filePath, outputDir });
        assertEquals(result.sandbox_output_path, join(outputDir, "shared-heading-2.md"));
        assertStringIncludes(
          await Deno.readTextFile(result.sandbox_output_path),
          "Original source.",
        );
      } catch (error) {
        // Older runtimes reject the initial symlink read; preserve that noncollision error.
        assert(error instanceof Error);
        assertStringIncludes(error.message, "Too many levels of symbolic links");
        await assertRejects(
          () => Deno.lstat(join(outputDir, "shared-heading-2.md")),
          Deno.errors.NotFound,
        );
      }
      assertEquals((await Deno.lstat(danglingPath)).isSymlink, true);
      await assertRejects(() => Deno.lstat(missingTarget), Deno.errors.NotFound);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("preserves every distinct source sharing one title and output directory", async () => {
    const root = await makeTempDir({ prefix: "veryfront-knowledge-concurrent-output-" });
    try {
      const outputDir = join(root, "out");
      const files = ["a", "b", "c", "d"].map((name) => join(root, `${name}.md`));
      await Promise.all(
        files.map((path, index) =>
          Deno.writeTextFile(path, `# Shared heading\n\nBody ${index}.\n`)
        ),
      );
      const results = await Promise.allSettled(
        files.map((filePath) => runKnowledgeParser({ filePath, outputDir })),
      );
      assertEquals(results.filter((result) => result.status === "fulfilled").length, files.length);
      const outputs = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      );
      assertEquals(new Set(outputs.map((result) => result.sandbox_output_path)).size, files.length);
      for (const [index, path] of files.entries()) {
        const matches = await Promise.all(
          outputs.map(async (result) =>
            (await Deno.readTextFile(result.sandbox_output_path)).includes(`Body ${index}.`)
          ),
        );
        assertEquals(matches.filter(Boolean).length, 1, path);
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});

describe("runKnowledgeParsers", () => {
  it("uses Kreuzberg for multiple supported rich documents", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-parser-batch-" });
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

it("preserves referenced computation executor and attester UTF-8 companions byte for byte", async () => {
  const root = await makeTempDir({ prefix: "veryfront-okf-companions-" });
  const outputDir = join(root, "output");
  const bundle = join(root, "bundle");
  const files = new Map([
    [
      "topic.md",
      "---\ntype: Attested Computation\ncomputation: scripts/revenue.js\nexecutor: bin/run\nresource: references/schema.json\nsources:\n  - resource: references/raw.json\n    id: scripts/orphan.js\n    label: viz.html\n    description: viz.html\nattester:\n  resource: references/check.json\n  id: scripts/orphan.js\n  description: viz.html\n---\nRevenue\n",
    ],
    ["scripts/revenue.js", "export const revenue = 42;\r\n"],
    ["bin/run", "#!/bin/sh\necho run\n"],
    ["references/check.json", '{"ok":true}\n'],
    ["references/schema.json", '{"type":"object"}\n'],
    ["references/raw.json", '{"value":42}\n'],
  ]);
  try {
    for (const [path, content] of files) {
      await Deno.mkdir(dirname(join(bundle, path)), { recursive: true });
      await Deno.writeTextFile(join(bundle, path), content);
    }
    await Deno.writeTextFile(join(bundle, "viz.html"), "<html>viewer</html>");
    await Deno.writeTextFile(join(bundle, "scripts", "orphan.js"), "export {};\n");
    const options = createKnowledgeCommandArgs({ path: bundle, all: true, okfBundle: true });
    const collection = await collectKnowledgeSources(options, {
      client: createMockClient(),
      projectSlug: "my-project",
      downloadUploads: async () => [],
    });
    assertEquals(
      collection.sources.map((source) => source.localPath.slice(bundle.length + 1)).sort(),
      [
        "bin/run",
        "references/check.json",
        "references/raw.json",
        "references/schema.json",
        "scripts/revenue.js",
        "topic.md",
      ],
    );
    assertEquals(
      collection.skipped.map((skipped) => skipped.source.slice(bundle.length + 1)).sort(),
      ["scripts/orphan.js", "viz.html"],
    );
    const uploaded = new Map<string, string>();
    const result = await ingestResolvedSources(collection.sources, options, {
      client: createMockClient(),
      projectSlug: "my-project",
      outputDir,
      runParser: runKnowledgeParser,
      indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
      uploadKnowledgeFile: async (remotePath, localPath) => {
        uploaded.set(remotePath, await Deno.readTextFile(localPath));
        return { path: remotePath };
      },
    });
    assertEquals(result.failed, []);
    assertEquals(
      [...uploaded].sort(),
      [...files].map(([path, content]) => [`knowledge/${path}`, content]).sort(),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("preserves structured UTF-8 companions at custom destinations and preflights protected bytes", async () => {
  const root = await makeTempDir({ prefix: "veryfront-okf-companions-" });
  const outputDir = join(root, "output");
  const bundle = join(root, "bundle");
  const files = new Map([
    [
      "topic.md",
      "---\ntype: Attested Computation\ncomputation: scripts/revenue.js\nexecutor: bin/run\nresource: references/schema.json\nsources:\n  - resource: notes.csv\n  - resource: script.py\n  - resource: query.sql\n  - resource: run.sh\n  - resource: data.yaml\n  - resource: references/raw.json\n    id: scripts/orphan.js\n    label: viz.html\n    description: viz.html\nattester:\n  resource: references/check.json\n  id: scripts/orphan.js\n  description: viz.html\n---\nRevenue\n[CSV](notes.csv) [Python](script.py) [SQL](query.sql) [Shell](run.sh) [YAML](data.yaml)\n",
    ],
    ["scripts/revenue.js", "export const revenue = 42;\r\n"],
    ["bin/run", "#!/bin/sh\necho run\n"],
    ["references/check.json", '{"ok":true}\n'],
    ["references/schema.json", '\ufeff{"type":"object"}\r\n'],
    ["references/raw.json", '{"value":42}\n'],
    ["notes.csv", "key,value\r\na,1\r\n"],
    ["script.py", "print(42)\n"],
    ["query.sql", "SELECT 42;\n"],
    ["run.sh", "echo ok\n"],
    ["data.yaml", "value: 42\n"],
  ]);
  try {
    for (const [path, content] of files) {
      await Deno.mkdir(dirname(join(bundle, path)), { recursive: true });
      await Deno.writeTextFile(join(bundle, path), content);
    }
    await Deno.writeTextFile(join(bundle, "viz.html"), "<html>viewer</html>");
    await Deno.writeTextFile(join(bundle, "scripts", "orphan.js"), "export {};\n");
    const options = createKnowledgeCommandArgs({
      path: bundle,
      all: true,
      okfBundle: true,
      knowledgePath: "docs/imports/acme",
    });
    const collection = await collectKnowledgeSources(options, {
      client: createMockClient(),
      projectSlug: "my-project",
      downloadUploads: async () => [],
    });
    assertEquals(
      collection.sources.map((source) => source.localPath.slice(bundle.length + 1)).sort(),
      [
        "bin/run",
        "notes.csv",
        "script.py",
        "query.sql",
        "run.sh",
        "data.yaml",
        "references/check.json",
        "references/raw.json",
        "references/schema.json",
        "scripts/revenue.js",
        "topic.md",
      ].sort(),
    );
    assertEquals(
      collection.skipped.map((skipped) => skipped.source.slice(bundle.length + 1)).sort(),
      ["scripts/orphan.js", "viz.html"],
    );
    const uploaded = new Map<string, string>();
    const result = await ingestResolvedSources(collection.sources, options, {
      client: createMockClient(),
      projectSlug: "my-project",
      outputDir,
      runParser: runKnowledgeParser,
      indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
      uploadKnowledgeFile: async (remotePath, localPath, _metadata, storageKind) => {
        assertEquals(storageKind, undefined);
        uploaded.set(remotePath, await Deno.readTextFile(localPath));
        return { path: remotePath };
      },
    });
    assertEquals(result.failed, []);
    assertEquals(
      [...uploaded].sort(),
      [...files].map(([path, content]) => [`docs/imports/acme/${path}`, content]).sort(),
    );
    await Deno.writeFile(join(bundle, "references/schema.json"), new Uint8Array([255]));
    let writes = 0;
    await assertRejects(
      () =>
        ingestResolvedSources(collection.sources, options, {
          client: createMockClient(),
          projectSlug: "my-project",
          outputDir,
          runParser: runKnowledgeParser,
          uploadKnowledgeFile: async () => {
            writes++;
            return { path: "unexpected" };
          },
        }),
      Error,
      "UTF-8",
    );
    assertEquals(writes, 0);
    await Deno.writeTextFile(join(bundle, "references/schema.json"), '{"valid":true}');
    await Deno.writeFile(join(bundle, "image.bin"), new Uint8Array([255, 0]));
    await Deno.writeTextFile(
      join(bundle, "topic.md"),
      "---\ntype: Concept\nresource: image.bin\n---\nBinary asset\n",
    );
    await Deno.writeTextFile(join(bundle, "bad.md"), "---\ntype: [\n---\ninvalid\n");
    const withBinary = await collectKnowledgeSources(options, {
      client: createMockClient(),
      projectSlug: "my-project",
      downloadUploads: async () => [],
    });
    await assertRejects(() =>
      ingestResolvedSources(withBinary.sources, options, {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir,
        runParser: runKnowledgeParser,
        uploadKnowledgeFile: async () => {
          writes++;
          return { path: "unexpected" };
        },
      })
    );
    assertEquals(writes, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("preserves root-relative attester resources referenced from nested computations", async () => {
  const root = await makeTempDir({ prefix: "veryfront-okf-root-attester-" });
  const bundle = join(root, "bundle");
  try {
    const files = new Map([
      ["index.md", "---\nokf_version: 0.2\n---\n# Bundle\n"],
      [
        "computations/revenue-ytd.md",
        "---\ntype: Attested Computation\nattester:\n  resource: attesters/sql_equality.py\n---\nRevenue\n",
      ],
      [
        "computations/gross-margin-period.md",
        "---\ntype: Attested Computation\nattester:\n  resource: attesters/sql_equality.py\n---\nMargin\n",
      ],
      ["attesters/index.md", "# Attesters\n[SQL equality](sql_equality.py)\n"],
      ["attesters/sql_equality.py", "def attest():\n    return True\n"],
      ["viz.html", "<html>viewer</html>\n"],
    ]);
    for (const [path, content] of files) {
      await Deno.mkdir(dirname(join(bundle, path)), { recursive: true });
      await Deno.writeTextFile(join(bundle, path), content);
    }

    const options = createKnowledgeCommandArgs({ path: bundle, all: true, okfBundle: true });
    const collection = await collectKnowledgeSources(options, {
      client: createMockClient(),
      projectSlug: "my-project",
      downloadUploads: async () => [],
    });

    assertEquals(
      collection.sources.map((source) => source.localPath.slice(bundle.length + 1)).sort(),
      [
        "attesters/index.md",
        "attesters/sql_equality.py",
        "computations/gross-margin-period.md",
        "computations/revenue-ytd.md",
        "index.md",
      ],
    );
    assertEquals(
      collection.skipped.map((skipped) => skipped.source.slice(bundle.length + 1)).sort(),
      ["viz.html"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("prefers document-relative OKF companions when root and nested paths both exist", async () => {
  const root = await makeTempDir({ prefix: "veryfront-okf-relative-attester-" });
  const bundle = join(root, "bundle");
  try {
    const files = new Map([
      ["index.md", "---\nokf_version: 0.2\n---\n# Bundle\n"],
      [
        "computations/revenue-ytd.md",
        "---\ntype: Attested Computation\nattester:\n  resource: attesters/sql_equality.py\n---\nRevenue\n",
      ],
      ["computations/attesters/sql_equality.py", "def attest_nested():\n    return True\n"],
      ["attesters/sql_equality.py", "def attest_root():\n    return True\n"],
    ]);
    for (const [path, content] of files) {
      await Deno.mkdir(dirname(join(bundle, path)), { recursive: true });
      await Deno.writeTextFile(join(bundle, path), content);
    }

    const options = createKnowledgeCommandArgs({ path: bundle, all: true, okfBundle: true });
    const collection = await collectKnowledgeSources(options, {
      client: createMockClient(),
      projectSlug: "my-project",
      downloadUploads: async () => [],
    });

    assertEquals(
      collection.sources.map((source) => source.localPath.slice(bundle.length + 1)).sort(),
      [
        "computations/attesters/sql_equality.py",
        "computations/revenue-ytd.md",
        "index.md",
      ],
    );
    assertEquals(
      collection.skipped.map((skipped) => skipped.source.slice(bundle.length + 1)).sort(),
      ["attesters/sql_equality.py"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("treats leading-slash OKF companion references as bundle-root paths", async () => {
  const root = await makeTempDir({ prefix: "veryfront-okf-root-slash-" });
  const bundle = join(root, "bundle");
  try {
    const files = new Map([
      ["index.md", "---\nokf_version: 0.2\n---\n# Bundle\n"],
      [
        "computations/revenue-ytd.md",
        "---\ntype: Attested Computation\nattester:\n  resource: /attesters/sql_equality.py\n---\nRevenue\n",
      ],
      ["computations/attesters/sql_equality.py", "def attest_nested():\n    return True\n"],
      ["attesters/sql_equality.py", "def attest_root():\n    return True\n"],
    ]);
    for (const [path, content] of files) {
      await Deno.mkdir(dirname(join(bundle, path)), { recursive: true });
      await Deno.writeTextFile(join(bundle, path), content);
    }

    const options = createKnowledgeCommandArgs({ path: bundle, all: true, okfBundle: true });
    const collection = await collectKnowledgeSources(options, {
      client: createMockClient(),
      projectSlug: "my-project",
      downloadUploads: async () => [],
    });

    assertEquals(
      collection.sources.map((source) => source.localPath.slice(bundle.length + 1)).sort(),
      [
        "attesters/sql_equality.py",
        "computations/revenue-ytd.md",
        "index.md",
      ],
    );
    assertEquals(
      collection.skipped.map((skipped) => skipped.source.slice(bundle.length + 1)).sort(),
      ["computations/attesters/sql_equality.py"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("ignores escaping and external OKF companion references", async () => {
  const root = await makeTempDir({ prefix: "veryfront-okf-ignored-reference-" });
  const bundle = join(root, "bundle");
  try {
    const files = new Map([
      ["index.md", "---\nokf_version: 0.2\n---\n# Bundle\n"],
      [
        "computations/revenue-ytd.md",
        "---\ntype: Attested Computation\nexecutor: ../../bin/run\nsources:\n  - resource: https://example.com/raw.json\nattester:\n  resource: #inline\n---\nRevenue\n",
      ],
      ["bin/run", "#!/bin/sh\necho run\n"],
    ]);
    for (const [path, content] of files) {
      await Deno.mkdir(dirname(join(bundle, path)), { recursive: true });
      await Deno.writeTextFile(join(bundle, path), content);
    }

    const options = createKnowledgeCommandArgs({ path: bundle, all: true, okfBundle: true });
    const collection = await collectKnowledgeSources(options, {
      client: createMockClient(),
      projectSlug: "my-project",
      downloadUploads: async () => [],
    });

    assertEquals(
      collection.sources.map((source) => source.localPath.slice(bundle.length + 1)).sort(),
      ["computations/revenue-ytd.md", "index.md"],
    );
    assertEquals(
      collection.skipped.map((skipped) => skipped.source.slice(bundle.length + 1)).sort(),
      ["bin/run"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("preserves referenced binary OKF companion assets without UTF-8 decoding", async () => {
  const root = await makeTempDir({ prefix: "veryfront-okf-binary-companion-" });
  const outputDir = join(root, "output");
  const bundle = join(root, "bundle");
  try {
    await Deno.mkdir(join(bundle, "bin"), { recursive: true });
    await Deno.writeTextFile(
      join(bundle, "topic.md"),
      "---\ntype: Attested Computation\nexecutor: bin/run.wasm\n---\nRevenue\n",
    );
    await Deno.writeFile(join(bundle, "bin", "run.wasm"), new Uint8Array([0xff, 0xfe, 0xfd]));

    const options = createKnowledgeCommandArgs({ path: bundle, all: true, okfBundle: true });
    const collection = await collectKnowledgeSources(options, {
      client: createMockClient(),
      projectSlug: "my-project",
      downloadUploads: async () => [],
    });
    assertEquals(
      collection.sources.map((source) => source.localPath.slice(bundle.length + 1)).sort(),
      ["bin/run.wasm", "topic.md"],
    );
    assertEquals(collection.skipped, []);

    const result = await ingestResolvedSources(collection.sources, options, {
      client: createMockClient(),
      projectSlug: "my-project",
      outputDir,
      runParser: runKnowledgeParser,
      indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
      uploadKnowledgeFile: async (remotePath) => ({ path: remotePath }),
    });
    assertEquals(result.ingested.map((item) => item.remotePath).sort(), [
      "knowledge/bin/run.wasm",
      "knowledge/topic.md",
    ]);
    assertEquals(result.failed, []);
    assertEquals(
      await Deno.readFile(join(outputDir, "bin", "run.wasm")),
      new Uint8Array([0xff, 0xfe, 0xfd]),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("rejects invalid UTF-8 Markdown instead of replacing authored bytes", async () => {
  const root = await makeTempDir({ prefix: "veryfront-okf-invalid-markdown-" });
  const filePath = join(root, "topic.md");
  try {
    const prefix = new TextEncoder().encode("---\ntype: Topic\n---\n");
    await Deno.writeFile(filePath, new Uint8Array([...prefix, 255]));
    await assertRejects(
      () =>
        runKnowledgeParser({
          filePath,
          outputDir: join(root, "output"),
          okfRelativePath: "topic.md",
        }),
      Error,
      "UTF-8",
    );
    assertEquals([...await Deno.readFile(filePath)], [...prefix, 255]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("prunes ignored remote dependency files while retaining hidden OKF documents", async () => {
  const paths = [
    "uploads/.bundle/.catalog/topic.md",
    "uploads/.bundle/node_modules/package/topic.md",
    "uploads/.bundle/node_modules/package/companion.py",
  ];
  const calls: string[][] = [];
  const collection = await collectKnowledgeSources(
    { sources: [], path: "uploads/.bundle", all: true, recursive: true, okfBundle: true },
    {
      client: createMockClient({
        get: () =>
          Promise.resolve({
            data: paths.map((path) => ({ type: "file", path })),
            page_info: { next: null },
          }),
      }),
      projectSlug: "my-project",
      downloadUploads: createDownloadUploadsStub(calls),
    },
  );
  assertEquals(calls, [[paths[0]!]]);
  assertEquals(collection.sources.map((source) => source.localPath), [`/workspace/${paths[0]}`]);
  assertEquals(collection.skipped.map((source) => source.reason), [
    "ignored_directory",
    "ignored_directory",
  ]);
});

it("excludes dependency directories from OKF bundle walks", async () => {
  const root = await makeTempDir({ prefix: "veryfront-okf-ignored-" });
  try {
    await Deno.mkdir(join(root, "node_modules", "package"), { recursive: true });
    await Deno.writeTextFile(join(root, "index.md"), "# Bundle\n");
    await Deno.writeTextFile(join(root, "node_modules", "package", "index.md"), "# Dependency\n");
    const collection = await collectKnowledgeSources(
      { sources: [], path: root, all: true, recursive: true, okfBundle: true },
      { client: createMockClient(), projectSlug: "my-project", downloadUploads: async () => [] },
    );
    assertEquals(collection.sources.map((source) => source.localPath), [join(root, "index.md")]);
    assertEquals(collection.skipped.map((source) => source.reason), ["ignored_directory"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("prunes only reserved output claims from local and remote OKF bundles", async () => {
  const root = await makeTempDir({ prefix: "veryfront-okf-claims-" });
  try {
    const retained = [".catalog/topic.md", ".veryfront/authored.md"];
    const reserved = ".veryfront/knowledge-output-claims/v1/claim.json";
    for (const path of [...retained, reserved]) {
      await Deno.mkdir(dirname(join(root, path)), { recursive: true });
      await Deno.writeTextFile(join(root, path), "# Authored or internal\n");
    }
    const local = await collectKnowledgeSources(
      { sources: [], path: root, all: true, recursive: true, okfBundle: true },
      { client: createMockClient(), projectSlug: "my-project", downloadUploads: async () => [] },
    );
    assertEquals(
      local.sources.map(({ localPath }) => localPath).sort(),
      retained.map((path) => join(root, path)).sort(),
    );
    const calls: string[][] = [];
    await collectKnowledgeSources(
      { sources: [], path: "uploads/.bundle", all: true, recursive: true, okfBundle: true },
      {
        client: createMockClient({
          get: () =>
            Promise.resolve({
              data: [...retained, reserved].map((path) => ({
                type: "file",
                path: `uploads/.bundle/${path}`,
              })),
              page_info: { next: null },
            }),
        }),
        projectSlug: "my-project",
        downloadUploads: createDownloadUploadsStub(calls),
      },
    );
    assertEquals(calls.flat().sort(), retained.map((path) => `uploads/.bundle/${path}`).sort());
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("prunes VCS metadata from local and remote OKF bundles", async () => {
  const root = await makeTempDir({ prefix: "veryfront-okf-vcs-" });
  const directories = [".git", ".hg", ".svn", ".bzr"];
  try {
    await Deno.writeTextFile(join(root, "index.md"), "# Bundle\n");
    for (const directory of directories) {
      await Deno.mkdir(join(root, directory, "objects"), { recursive: true });
      await Deno.writeTextFile(join(root, directory, "objects", "topic.md"), "# VCS metadata\n");
    }
    const local = await collectKnowledgeSources(
      { sources: [], path: root, all: true, recursive: true, okfBundle: true },
      { client: createMockClient(), projectSlug: "my-project", downloadUploads: async () => [] },
    );
    assertEquals(local.sources.map((source) => source.localPath), [join(root, "index.md")]);
    assertEquals(
      local.skipped.map((source) => source.reason),
      directories.map(() => "ignored_directory"),
    );
    const paths = [
      "uploads/.bundle/.catalog/topic.md",
      ...directories.map((directory) => `uploads/.bundle/${directory}/objects/topic.md`),
    ];
    const calls: string[][] = [];
    const remote = await collectKnowledgeSources(
      { sources: [], path: "uploads/.bundle", all: true, recursive: true, okfBundle: true },
      {
        client: createMockClient({
          get: () =>
            Promise.resolve({
              data: paths.map((path) => ({ type: "file", path })),
              page_info: { next: null },
            }),
        }),
        projectSlug: "my-project",
        downloadUploads: createDownloadUploadsStub(calls),
      },
    );
    assertEquals(calls, [[paths[0]!]]);
    assertEquals(
      remote.skipped.map((source) => source.reason),
      directories.map(() => "ignored_directory"),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("preserves a UTF-8 BOM-prefixed OKF document byte-for-byte", async () => {
  const tempDir = await makeTempDir({ prefix: "veryfront-okf-bom-" });
  const bundleDir = join(tempDir, "bundle");
  const outputDir = join(tempDir, "out");
  const source = "﻿---\ntype: Topic\ntitle: BOM document\n---\nBody\n";
  try {
    await Deno.mkdir(bundleDir, { recursive: true });
    await Deno.writeTextFile(join(bundleDir, "concept.md"), source);
    const collection = await collectKnowledgeSources(
      createKnowledgeCommandArgs({ path: bundleDir, all: true, recursive: true, okfBundle: true }),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        downloadUploads: async () => [],
      },
    );
    const uploads: Array<{ remotePath: string; bytes: Uint8Array }> = [];
    const results = await ingestResolvedSources(
      collection.sources,
      createKnowledgeCommandArgs({ path: bundleDir, all: true, outputDir, okfBundle: true }),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir,
        runParser: runKnowledgeParser,
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath, localPath) => {
          uploads.push({ remotePath, bytes: await Deno.readFile(localPath) });
          return { path: remotePath };
        },
      },
    );

    assertEquals(results.failed, []);
    assertEquals(results.ingested[0]?.documentKind, "okf_concept");
    assertEquals(uploads.map((upload) => upload.remotePath), ["knowledge/concept.md"]);
    assertEquals(uploads[0]?.bytes, new TextEncoder().encode(source));
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
  }
});

for (const sourceKind of ["local", "upload"] as const) {
  it(`preserves referenced plain Markdown companions through ${sourceKind} discovery and real parsing`, async () => {
    const root = await makeTempDir({ prefix: "veryfront-okf-markdown-companions-" });
    const bundle = join(root, "bundle");
    const files = new Map([
      [
        "topic.md",
        "---\ntype: Attested Computation\nresource: assets/resource.md\ncomputation: assets/computation.md\nexecutor: assets/executor.md\nsources:\n  - resource: assets/source.md\n  - resource: concept.md\n  - resource: invalid-concept.md\n  - resource: malformed-concept.md\n  - resource: malformed-version.md\n  - resource: malformed-flow.md\n  - resource: malformed-indented.md\n  - resource: malformed-companion.md\n  - resource: future.md\n  - resource: index.md\n  - resource: log.md\nattester:\n  resource: assets/attester.md\n---\nTopic\n",
      ],
      [
        "assets/resource.md",
        "---\r\ntitle: Raw companion\r\ncustom: yes\r\n---\r\n# Resource café\r\nPlain Markdown\r\n",
      ],
      ["assets/source.md", "# Source 日本語\nRaw source\n"],
      ["assets/computation.md", "# Computation\nPlain instructions\n"],
      ["assets/executor.md", "# Executor\nPlain instructions\n"],
      ["assets/attester.md", "# Attester\nPlain instructions\n"],
      ["concept.md", "---\ntype: concept\ntitle: Referenced concept\n---\nConcept\n"],
      ["invalid-concept.md", "---\ntype: []\n---\nInvalid referenced concept\n"],
      ["invalid-document.md", "No frontmatter, but not a referenced companion\n"],
      ["malformed-concept.md", "---\ntype: [\n---\nMalformed referenced concept\n"],
      ["malformed-version.md", "---\nokf_version: [\n---\nMalformed reserved version\n"],
      ["malformed-flow.md", "---\n{type: [}\n---\nMalformed flow mapping\n"],
      ["malformed-indented.md", "---\n  type: [\n---\nMalformed indented mapping\n"],
      ["malformed-companion.md", "---\ntitle: [\n---\nMalformed ordinary metadata\n"],
      ["future.md", "---\ntype: Custom Future Concept\n---\nUnknown explicit type\n"],
      ["index.md", "[Topic](topic.md)\n"],
      ["log.md", "Authored log\n"],
    ]);
    // The same malformed bytes remain errors when selected as canonical documents.
    for (const [path, content] of [...files]) {
      if (path.startsWith("malformed-")) files.set(`unreferenced-${path}`, content);
    }
    try {
      for (const [path, content] of files) {
        await Deno.mkdir(dirname(join(bundle, path)), { recursive: true });
        await Deno.writeTextFile(join(bundle, path), content);
      }
      const remoteRoot = "uploads/bundle";
      const client = createMockClient({
        get: () =>
          Promise.resolve({
            data: [...files.keys()].map((path) => ({
              type: "file",
              path: `${remoteRoot}/${path}`,
            })),
            page_info: { next: null },
          }),
      });
      const options = createKnowledgeCommandArgs({
        path: sourceKind === "local" ? bundle : remoteRoot,
        all: true,
        okfBundle: true,
      });
      const collection = await collectKnowledgeSources(options, {
        client,
        projectSlug: "my-project",
        downloadUploads: async (paths) =>
          paths.map((uploadPath) => ({
            uploadPath,
            localPath: join(bundle, uploadPath.slice(remoteRoot.length + 1)),
          })),
      });
      const uploaded = new Map<string, Uint8Array>();
      const result = await ingestResolvedSources(collection.sources, options, {
        client,
        projectSlug: "my-project",
        outputDir: join(root, "output"),
        runParser: runKnowledgeParser,
        indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
        uploadKnowledgeFile: async (remotePath, localPath) => {
          uploaded.set(remotePath, await Deno.readFile(localPath));
          return { path: remotePath };
        },
      });
      assertEquals(result.failed.length, 7);
      assertEquals(
        result.failed.every((item) => item.message.includes("OKF document failed diagnostics")),
        true,
      );
      for (const [path, content] of files) {
        if (path.startsWith("invalid-") || path.startsWith("unreferenced-")) {
          assertEquals(uploaded.has(`knowledge/${path}`), false);
        } else {
          assertEquals(uploaded.get(`knowledge/${path}`), new TextEncoder().encode(content));
        }
      }
      assertEquals(
        result.ingested.find((item) => item.remotePath === "knowledge/concept.md")?.documentKind,
        "okf_concept",
      );
      assertEquals(
        result.ingested.find((item) => item.remotePath === "knowledge/future.md")?.documentKind,
        "okf_concept",
      );
      assertEquals(
        result.ingested.find((item) => item.remotePath === "knowledge/index.md")?.documentKind,
        "okf_index",
      );
      assertEquals(
        result.ingested.find((item) => item.remotePath === "knowledge/log.md")?.documentKind,
        "okf_log",
      );
      assertEquals(
        result.ingested.filter((item) => item.remotePath.startsWith("knowledge/assets/")).length,
        5,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
}

it("keeps title-derived filenames portable without rewriting safe near matches", async () => {
  const root = await makeTempDir({ prefix: "knowledge-portable-title-" });
  try {
    const reserved = [
      "con",
      "prn",
      "aux",
      "nul",
      ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
      ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
    ];
    const safe = ["com0", "com10", "lpt0", "lpt10", "console", "nul-value", "auxiliary"];
    let index = 0;
    for (const name of [...reserved, ...safe]) {
      for (
        const title of [name, name.toUpperCase(), name.charAt(0).toUpperCase() + name.slice(1)]
      ) {
        const filePath = join(root, `source-${index}.md`);
        await Deno.writeTextFile(filePath, `# ${title}\n\nBody`);
        const result = await runKnowledgeParser({
          filePath,
          outputDir: join(root, `out-${index}`),
        });
        assertEquals(result.title, title);
        assertEquals(result.slug, reserved.includes(name) ? `${name}-document` : name);
        index++;
      }
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("allocates 102 nested local sources sharing a basename at custom destinations", async () => {
  const remote = new Map<string, { content: string; versionId: string }>();
  let continuationRequests = 0;
  const client = createMockClient({
    get: async (_url, params) => {
      const pattern = params?.pattern;
      assert(pattern);
      const matcher = new RegExp(`^${pattern.replaceAll(".", "\\.").replaceAll("*", ".*")}$`);
      const paths = [...remote.keys()].filter((path) => matcher.test(path));
      const offset = params?.cursor ? Number(params.cursor) : 0;
      if (offset) continuationRequests++;
      const data = paths.slice(offset, offset + 100).map((path) => ({ path }));
      return {
        data,
        page_info: {
          next: offset + data.length < paths.length ? String(offset + data.length) : null,
        },
      };
    },
  });
  for (let index = 0; index < 102; index++) {
    const source = createLocalSource(`sections/part-${index}/guide.md`);
    const identity = buildKnowledgeIngestIdentity(source);
    const claimed = await claimGeneratedKnowledgePath({
      remotePath: `docs/imports/${await buildCustomKnowledgeSlug(source)}.md`,
      ...identity,
      sourceKind: "local",
      legacySource: source.localPath,
      customSource: source,
      scanSuffixGaps: true,
      absenceConflicts: new Map(),
      listSuffixPaths: (stem) =>
        listRemoteKnowledgeSuffixPaths({ client, projectSlug: "test", stem }),
      readRemoteFile: async (path) => remote.get(path),
    });
    remote.set(claimed.remotePath, {
      content: `---\nresource: ${
        JSON.stringify(identity.resource)
      }\ngenerated: {by: "veryfront/0.1.0",source_key: ${
        JSON.stringify(identity.sourceKey)
      }}\n---\nBody.`,
      versionId: "fixture-version",
    });
  }
  assertEquals(remote.size, 102);
  assert(continuationRequests > 0);
});

it("refuses incomplete cyclic and over-budget remote path listings", async () => {
  for (const mode of ["missing", "cycle", "unending"]) {
    let calls = 0;
    const client = createMockClient({
      get: async (_url, params) => {
        calls++;
        assertEquals(params?.ref, "branch:selected");
        assertEquals(params?.fields, "(path)");
        assertEquals(params?.limit, "100");
        return {
          data: [{ path: `docs/imports/guide-${calls}.md` }],
          ...(mode === "missing"
            ? {}
            : { page_info: { next: mode === "cycle" ? "same" : `cursor-${calls}` } }),
        };
      },
    });
    assertEquals(
      await listRemoteKnowledgeSuffixPaths({
        client,
        projectSlug: "test",
        branch: "selected",
        stem: "docs/imports/guide",
      }),
      undefined,
    );
    assertEquals(calls, mode === "missing" ? 1 : mode === "cycle" ? 2 : 100);
  }
});
