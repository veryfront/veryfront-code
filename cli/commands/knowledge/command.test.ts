import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectKnowledgeSources,
  createKnowledgeIngestResult,
  deriveKnowledgeRemotePath,
  ingestResolvedSources,
  isLikelyLocalPath,
  normalizeKnowledgeInputPath,
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
      const sources = await collectKnowledgeSources(
        {
          source: localPath,
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

      assertEquals(sources, [{ kind: "local", input: localPath, localPath }]);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("downloads upload-path sources into the workspace", async () => {
    const calls: string[] = [];
    const sources = await collectKnowledgeSources(
      {
        source: "uploads/contracts/q1.pdf",
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
    assertEquals(sources, [
      {
        kind: "upload",
        input: "uploads/contracts/q1.pdf",
        uploadPath: "uploads/contracts/q1.pdf",
        localPath: "/workspace/uploads/contracts/q1.pdf",
      },
    ]);
  });

  it("treats uploads/ paths as remote even if a local uploads folder exists", async () => {
    const originalCwd = Deno.cwd();
    const tempDir = await Deno.makeTempDir();
    await Deno.mkdir(`${tempDir}/uploads/contracts`, { recursive: true });
    await Deno.writeTextFile(`${tempDir}/uploads/contracts/q1.pdf`, "local shadow copy");

    try {
      Deno.chdir(tempDir);
      const calls: string[] = [];
      const sources = await collectKnowledgeSources(
        {
          source: "uploads/contracts/q1.pdf",
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
      assertEquals(sources[0]?.kind, "upload");
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

    const sources = await collectKnowledgeSources(
      {
        source: undefined,
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
    assertEquals(downloadCalls, [["uploads/a.pdf", "uploads/b.pdf"]]);
    assertEquals(sources.length, 2);
    assert(sources.every((source) => source.kind === "upload"));
  });

  it("respects non-recursive upload prefix listing", async () => {
    const listCalls: Array<{ path: string; params?: Record<string, string> }> = [];
    const client = createMockClient({
      get: (path, params) => {
        listCalls.push({ path, params });
        return Promise.resolve({
          data: [],
          page_info: { next: null },
        });
      },
    });

    await assertRejects(
      () =>
        collectKnowledgeSources(
          {
            source: undefined,
            path: "uploads/contracts/",
            all: true,
            recursive: false,
          },
          {
            client,
            projectSlug: "my-project",
            downloadUploads: async () => [],
          },
        ),
      Error,
      "No supported uploads found under uploads/contracts",
    );

    assertEquals(listCalls.length, 1);
    assertEquals(listCalls[0]?.params?.recursive, "false");
  });
});

describe("ingestResolvedSources", () => {
  it("runs the parser and uploads knowledge markdown", async () => {
    const results = await ingestResolvedSources(
      [{
        kind: "upload",
        input: "uploads/contracts/q1.pdf",
        uploadPath: "uploads/contracts/q1.pdf",
        localPath: "/workspace/uploads/contracts/q1.pdf",
      }],
      {
        source: undefined,
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

    assertEquals(results, [{
      source: "uploads/contracts/q1.pdf",
      localSourcePath: "/workspace/uploads/contracts/q1.pdf",
      outputPath: "/workspace/knowledge/contracts-q1.md",
      remotePath: "knowledge/contracts-q1.md",
      slug: "contracts-q1",
      sourceType: "pdf",
      summary: "Extracted 4 page(s).",
      stats: { pages: 4 },
      warnings: [],
    }]);
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
        source: undefined,
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
});

describe("knowledgeIngestPythonSource", () => {
  it("avoids Python 3.10-only union type syntax", () => {
    assertEquals(knowledgeIngestPythonSource.includes(" | None"), false);
  });
});
