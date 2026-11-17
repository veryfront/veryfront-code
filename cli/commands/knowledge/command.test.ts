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
import { basename, dirname, join } from "veryfront/platform/path";
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
import type { Logger } from "#veryfront/utils";
import { VERSION } from "#cli/utils";
import {
  buildCustomKnowledgePath,
  buildCustomKnowledgeSlug,
  buildKnowledgeIngestIdentity,
  claimGeneratedKnowledgePath,
  findRemoteKnowledgeIngestSource,
  listRemoteKnowledgeSuffixPaths,
} from "./command-helpers.ts";
import type { KnowledgeParserInput } from "./parser.ts";

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

  it("reuses a canonical document stored with the previous local resource spelling", async () => {
    const writes: unknown[] = [];
    const lookups: unknown[] = [];
    const result = await ingestResolvedSources(
      [createLocalSource("./contracts/q1.txt")],
      createKnowledgeCommandArgs(),
      {
        client: createMockClient(),
        projectSlug: "my-project",
        outputDir: "/workspace/knowledge",
        runParser: async () => createParserSuccess(),
        findRemoteKnowledgeSource: async ({ resource, legacySource, sourceKey }) => {
          lookups.push({ resource, legacySource, sourceKey });
          return legacySource === "./contracts/q1.txt"
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
      resource: "contracts/q1.txt",
      legacySource: "./contracts/q1.txt",
      sourceKey: '["local","contracts/q1.txt"]',
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
      { resource: "area/guide.md", sourceKey: '["local","area/guide.md"]' },
    );
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
      assertEquals(reads, 12);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("updates a retained custom suffix across gaps without probing missing paths", async () => {
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
      const result = await claimGeneratedKnowledgePath({
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
      assertEquals(
        result,
        exists ? { remotePath: legacy, expected: { versionId: "legacy-version" } } : {
          remotePath: await buildCustomKnowledgePath(source, "docs/imports"),
          expected: { absent: true },
        },
      );
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
    const filePath = join(tempDir, "notes.md");

    try {
      for (const title of ["Index", "Log"]) {
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
  it("rejects a guarded dangling output symlink without writing its target", async () => {
    const root = await makeTempDir({ prefix: "veryfront-knowledge-dangling-output-" });
    try {
      const filePath = join(root, "source.md");
      const outputDir = join(root, "out");
      const missingTarget = join(root, "missing.md");
      const danglingPath = join(outputDir, "shared-heading.md");
      await Deno.writeTextFile(filePath, "# Shared heading\n\nOriginal source.\n");
      await Deno.mkdir(outputDir);
      await Deno.symlink(missingTarget, danglingPath);
      await assertRejects(() => runKnowledgeParser({ filePath, outputDir }), Error);
      await assertRejects(
        () => Deno.lstat(join(outputDir, "shared-heading-2.md")),
        Deno.errors.NotFound,
      );
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
