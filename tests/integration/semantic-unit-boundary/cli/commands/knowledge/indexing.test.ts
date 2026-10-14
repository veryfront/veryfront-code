import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import "#veryfront/schemas/_test-setup.ts";
import { ingestResolvedSources, runKnowledgeParser } from "#cli/commands/knowledge/command";
import { indexKnowledgeDocument } from "../../../../../../cli/commands/knowledge/indexing.ts";
import {
  createKnowledgeCommandArgs,
  createLocalSource,
  createMockClient,
} from "../../../../../../cli/commands/knowledge/command.test-helpers.ts";
import type { Embedding } from "#veryfront/embedding/types.ts";

const fileId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";
const published = {
  path: "knowledge/topic.md",
  file_id: fileId,
  version_id: versionId,
};

type PublishedFixture = typeof published & { checksum: string };

async function publishedForLocalPath(
  localPath: string,
  overrides: Partial<typeof published> = {},
): Promise<PublishedFixture> {
  return {
    ...published,
    checksum: await computeHash(await Deno.readTextFile(localPath)),
    ...overrides,
  };
}

function embedder(
  onEmbed: (texts: string[], signal?: AbortSignal) => void | Promise<void> = () => {},
): Embedding {
  return {
    model: "veryfront-cloud/openai/text-embedding-3-small",
    embed: async () => Array(1536).fill(0.25),
    embedMany: async (texts, options) => {
      await onEmbed(texts, options?.signal);
      return texts.map(() => Array(1536).fill(0.25));
    },
  };
}

it("ordinary ingestion automatically commits searchable canonical chunks on its destination branch", async () => {
  const root = await makeTempDir();
  try {
    const localPath = `${root}/topic.txt`;
    await Deno.writeTextFile(
      localPath,
      "A unique searchable ingestion marker with authored content.",
    );
    let committedPath = "";
    let committedBody: unknown;
    let embeddings = 0;
    let uploaded: PublishedFixture | undefined;
    const client = createMockClient({
      post: async (path, body) => {
        committedPath = path;
        committedBody = body;
        return {
          ...uploaded,
          indexed_chunk_count: 1,
          model: { name: "text-embedding-3-small", provider: "openai", dimension: 1536 },
        };
      },
    });
    const result = await ingestResolvedSources(
      [createLocalSource(localPath)],
      createKnowledgeCommandArgs({ outputDir: root }),
      {
        client,
        projectSlug: "project",
        outputDir: root,
        runParser: runKnowledgeParser,
        destinationBranch: "preview",
        uploadKnowledgeFile: async (_path, output) => {
          const bytes = await Deno.readTextFile(output);
          assertEquals(bytes.includes("A unique searchable ingestion marker"), true);
          uploaded = await publishedForLocalPath(output);
          return uploaded;
        },
        indexKnowledgeDocument: (input) =>
          indexKnowledgeDocument({
            ...input,
            embedder: embedder(() => {
              embeddings++;
            }),
          }),
      },
    );
    assertEquals(result.failed, []);
    assertEquals(embeddings, 1);
    assertEquals(
      committedPath,
      "/projects/project/branches/preview/files/knowledge%2Ftopic.md/index",
    );
    const payload = JSON.parse(JSON.stringify(committedBody));
    assertEquals(payload.expected_version_id, versionId);
    assertEquals(payload.chunks[0].metadata.source, published.path);
    assertEquals(payload.chunks[0].metadata.document_id, fileId);
    assertEquals(payload.chunks[0].metadata.file_version_id, versionId);
    assertEquals(payload.chunks[0].content.includes("A unique searchable ingestion marker"), true);
    assertEquals(payload.chunks[0].vector.length, 1536);
    assertEquals(result.ingested[0]?.canonicalIndex?.version_id, versionId);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("canonical indexing preserves imported bytes and links and rejects stale acknowledgements", async () => {
  const root = await makeTempDir();
  const source =
    "---\r\ntype: Topic\r\nrelated:\r\n  - other.md\r\ntitle: Cafè\r\n---\r\n# Cafè\r\nSee [other](other.md).\r\n";
  try {
    const localPath = `${root}/topic.md`;
    await Deno.writeTextFile(localPath, source);
    const currentPublished = await publishedForLocalPath(localPath);
    let payload: unknown;
    const client = createMockClient({
      post: async (_path, body) => {
        payload = body;
        return {
          ...currentPublished,
          version_id: fileId,
          indexed_chunk_count: 1,
          model: { name: "text-embedding-3-small", provider: "openai", dimension: 1536 },
        };
      },
    });
    await assertRejects(
      () =>
        indexKnowledgeDocument({
          client,
          projectSlug: "project",
          branch: "preview",
          published: currentPublished,
          localPath,
          embedder: embedder(),
        }),
      Error,
      "acknowledgement",
    );
    const body = JSON.parse(JSON.stringify(payload));
    assertEquals(body.chunks[0].metadata.okf_metadata.related, ["other.md"]);
    assertEquals(body.chunks[0].metadata.source, published.path);
    assertEquals(await Deno.readTextFile(localPath), source);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("missing publication receipt, oversized complete sets and provider failures never commit a partial index", async () => {
  const root = await makeTempDir();
  try {
    const localPath = `${root}/topic.md`;
    await Deno.writeTextFile(localPath, "Text to index");
    let commits = 0;
    const client = createMockClient({
      post: async () => {
        commits++;
        return {};
      },
    });
    const currentPublished = await publishedForLocalPath(localPath);
    const input = {
      client,
      projectSlug: "project",
      branch: "preview",
      published: currentPublished,
      localPath,
    };
    await assertRejects(
      () =>
        indexKnowledgeDocument({
          ...input,
          published: { path: published.path },
          embedder: embedder(),
        }),
      Error,
      "publication",
    );
    await assertRejects(
      () =>
        indexKnowledgeDocument({
          ...input,
          embedder: embedder(() => {
            throw new Error("Embedding credentials unavailable");
          }),
        }),
      Error,
      "credentials unavailable",
    );
    await Deno.writeTextFile(localPath, "a".repeat(1_100_000));
    const oversizedPublished = await publishedForLocalPath(localPath);
    await assertRejects(
      () =>
        indexKnowledgeDocument({
          ...input,
          published: oversizedPublished,
          embedder: embedder(() => {
            throw new Error("must not embed oversized source");
          }),
        }),
      Error,
      "atomic index limit",
    );
    assertEquals(commits, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("accepts empty canonical sources only after exact current index-status readiness", async () => {
  const root = await makeTempDir();
  try {
    const localPath = `${root}/empty.md`;
    await Deno.writeTextFile(localPath, "---\ntype: Topic\n---\n   \n");
    const checksum = await computeHash(await Deno.readTextFile(localPath));
    let statusPath = "";
    let statusBody: unknown;
    let commits = 0;
    let embeddings = 0;
    const receipt = await indexKnowledgeDocument({
      client: createMockClient({
        post: async (path, body) => {
          if (path.endsWith("/knowledge/index-status")) {
            statusPath = path;
            statusBody = body;
            return {
              data: [{
                path: published.path,
                file_id: fileId,
                file_version_id: versionId,
                index_ready: true,
              }],
            };
          }
          commits++;
          return {};
        },
      }),
      projectSlug: "project",
      branch: "main",
      published: { ...published, checksum },
      localPath,
      embedder: embedder(() => {
        embeddings++;
      }),
    });
    assertEquals(statusPath, "/projects/project/knowledge/index-status");
    assertEquals(statusBody, {
      paths: [published.path],
      lookup_target: { kind: "preview_branch", branch_id: null },
    });
    assertEquals(receipt, {
      file_id: fileId,
      version_id: versionId,
      path: published.path,
      checksum,
      indexed_chunk_count: 0,
      model: null,
    });
    assertEquals(commits, 0);
    assertEquals(embeddings, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("resolves named branches before accepting empty canonical source readiness", async () => {
  const root = await makeTempDir();
  try {
    const localPath = `${root}/empty.md`;
    await Deno.writeTextFile(localPath, "");
    const emptyChecksum = await computeHash(await Deno.readTextFile(localPath));
    let branchLookupPath = "";
    let branchLookupParams: Record<string, string> | undefined;
    let statusBody: unknown;
    const receipt = await indexKnowledgeDocument({
      client: createMockClient({
        get: async (path, params) => {
          branchLookupPath = path;
          branchLookupParams = params;
          return {
            data: [{ id: branchId, name: "preview", project_id: "project-id" }],
            page_info: {},
          };
        },
        post: async (_path, body) => {
          statusBody = body;
          return {
            data: [{
              path: published.path,
              file_id: fileId,
              file_version_id: versionId,
              index_ready: true,
            }],
          };
        },
      }),
      projectSlug: "project",
      branch: "preview",
      published: { ...published, checksum: emptyChecksum },
      localPath,
      embedder: embedder(() => {
        throw new Error("empty source must not embed");
      }),
    });
    assertEquals(branchLookupPath, "/projects/project/branches");
    assertEquals(branchLookupParams, { search: "preview", limit: "100" });
    assertEquals(statusBody, {
      paths: [published.path],
      lookup_target: { kind: "preview_branch", branch_id: branchId },
    });
    assertEquals(receipt.indexed_chunk_count, 0);
    assertEquals(receipt.model, null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("prefers UUID-shaped branch names before accepting empty canonical source readiness", async () => {
  const root = await makeTempDir();
  try {
    const localPath = `${root}/empty.md`;
    await Deno.writeTextFile(localPath, "");
    const emptyChecksum = await computeHash(await Deno.readTextFile(localPath));
    const uuidShapedBranchName = "44444444-4444-4444-8444-444444444444";
    let branchLookupParams: Record<string, string> | undefined;
    let statusBody: unknown;
    await indexKnowledgeDocument({
      client: createMockClient({
        get: async (_path, params) => {
          branchLookupParams = params;
          return {
            data: [{ id: branchId, name: uuidShapedBranchName }],
            page_info: {},
          };
        },
        post: async (_path, body) => {
          statusBody = body;
          return {
            data: [{
              path: published.path,
              file_id: fileId,
              file_version_id: versionId,
              index_ready: true,
            }],
          };
        },
      }),
      projectSlug: "project",
      branch: uuidShapedBranchName,
      published: { ...published, checksum: emptyChecksum },
      localPath,
      embedder: embedder(() => {
        throw new Error("empty source must not embed");
      }),
    });
    assertEquals(branchLookupParams, { search: uuidShapedBranchName, limit: "100" });
    assertEquals(statusBody, {
      paths: [published.path],
      lookup_target: { kind: "preview_branch", branch_id: branchId },
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("falls back to an explicit branch id when accepting empty canonical source readiness", async () => {
  const root = await makeTempDir();
  try {
    const localPath = `${root}/empty.md`;
    await Deno.writeTextFile(localPath, "");
    const emptyChecksum = await computeHash(await Deno.readTextFile(localPath));
    let lookups = 0;
    let statusBody: unknown;
    await indexKnowledgeDocument({
      client: createMockClient({
        get: async () => {
          lookups++;
          return { data: [] };
        },
        post: async (_path, body) => {
          statusBody = body;
          return {
            data: [{
              path: published.path,
              file_id: fileId,
              file_version_id: versionId,
              index_ready: true,
            }],
          };
        },
      }),
      projectSlug: "project",
      branch: branchId,
      published: { ...published, checksum: emptyChecksum },
      localPath,
      embedder: embedder(() => {
        throw new Error("empty source must not embed");
      }),
    });
    assertEquals(lookups, 1);
    assertEquals(statusBody, {
      paths: [published.path],
      lookup_target: { kind: "preview_branch", branch_id: branchId },
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("rejects empty canonical sources when status is denied, stale, or not ready", async () => {
  const root = await makeTempDir();
  try {
    const localPath = `${root}/empty.md`;
    await Deno.writeTextFile(localPath, "");
    const emptyPublished = await publishedForLocalPath(localPath);
    let embeddings = 0;
    const baseInput = {
      projectSlug: "project",
      branch: "main",
      published: emptyPublished,
      localPath,
      embedder: embedder(() => {
        embeddings++;
      }),
    };
    for (
      const data of [
        [],
        [{
          path: published.path,
          file_id: fileId,
          file_version_id: fileId,
          index_ready: true,
        }],
        [{
          path: published.path,
          file_id: fileId,
          file_version_id: versionId,
          index_ready: false,
        }],
      ]
    ) {
      await assertRejects(
        () =>
          indexKnowledgeDocument({
            ...baseInput,
            client: createMockClient({
              post: async () => ({ data }),
            }),
          }),
        Error,
        "readiness",
      );
    }
    assertEquals(embeddings, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("rejects empty canonical sources when named branch lookup is absent, ambiguous, or wrong-name only", async () => {
  const root = await makeTempDir();
  try {
    const localPath = `${root}/empty.md`;
    await Deno.writeTextFile(localPath, "");
    const emptyPublished = await publishedForLocalPath(localPath);
    const cases = [
      {
        name: "absent",
        pages: [{ data: [], page_info: {} }],
        message: "did not return the requested branch",
      },
      {
        name: "ambiguous",
        pages: [{
          data: [
            { id: branchId, name: "preview" },
            { id: "44444444-4444-4444-8444-444444444444", name: "preview" },
          ],
          page_info: {},
        }],
        message: "multiple exact matches",
      },
      {
        name: "wrong-name",
        pages: [{ data: [{ id: branchId, name: "preview-copy" }], page_info: {} }],
        message: "did not return the requested branch",
      },
      {
        name: "wrong-name-paginated",
        pages: [
          {
            data: [{ id: branchId, name: "preview-copy" }],
            page_info: { next: "cursor-2" },
          },
          { data: [{ id: branchId, name: "preview-old" }], page_info: {} },
        ],
        message: "did not return the requested branch",
      },
    ];
    for (const item of cases) {
      let call = 0;
      await assertRejects(
        () =>
          indexKnowledgeDocument({
            client: createMockClient({
              get: async () => item.pages[call++] ?? { data: [] },
              post: async () => {
                throw new Error(`status must not run for ${item.name}`);
              },
            }),
            projectSlug: "project",
            branch: "preview",
            published: emptyPublished,
            localPath,
            embedder: embedder(() => {
              throw new Error("empty source must not embed");
            }),
          }),
        Error,
        item.message,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("cancellation during provider work settles before returning and never commits", async () => {
  const root = await makeTempDir();
  try {
    const localPath = `${root}/topic.md`;
    await Deno.writeTextFile(localPath, "Text to index");
    const currentPublished = await publishedForLocalPath(localPath);
    const controller = new AbortController();
    let commits = 0;
    let settled = false;
    const client = createMockClient({
      post: async () => {
        commits++;
        return {};
      },
    });
    await assertRejects(
      () =>
        indexKnowledgeDocument({
          client,
          projectSlug: "project",
          branch: "preview",
          published: currentPublished,
          localPath,
          signal: controller.signal,
          embedder: embedder(async (_texts, signal) => {
            assertEquals(signal, controller.signal);
            controller.abort(new Error("cancel indexing"));
            await Promise.resolve();
            settled = true;
          }),
        }),
      Error,
      "cancel indexing",
    );
    assertEquals(settled, true);
    assertEquals(commits, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("index failure fails ordinary ingestion and retains the canonical publication receipt", async () => {
  const root = await makeTempDir();
  try {
    const localPath = `${root}/topic.txt`;
    await Deno.writeTextFile(localPath, "Text to index");
    const result = await ingestResolvedSources(
      [createLocalSource(localPath)],
      createKnowledgeCommandArgs({ outputDir: root }),
      {
        client: createMockClient(),
        projectSlug: "project",
        outputDir: root,
        runParser: runKnowledgeParser,
        uploadKnowledgeFile: async () => published,
        indexKnowledgeDocument: async () => {
          throw new Error("stale selected version");
        },
      },
    );
    assertEquals(result.ingested, []);
    assertEquals(result.failed[0]?.reason, "index_error");
    assertEquals(result.failed[0]?.published, published);
    assertEquals(result.failed[0]?.message, "stale selected version");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("repeated text chunks retain their actual canonical offsets", async () => {
  const root = await makeTempDir();
  try {
    const localPath = `${root}/topic.md`;
    await Deno.writeTextFile(localPath, "a".repeat(6_000));
    const currentPublished = await publishedForLocalPath(localPath);
    let starts: number[] = [];
    const client = createMockClient({
      post: async (_path, payload) => {
        const body = JSON.parse(JSON.stringify(payload));
        starts = body.chunks.map((item: { start_offset: number }) => item.start_offset);
        return { ...currentPublished, indexed_chunk_count: starts.length, model: body.model };
      },
    });
    await indexKnowledgeDocument({
      client,
      projectSlug: "project",
      branch: "preview",
      published: currentPublished,
      localPath,
      embedder: embedder(),
    });
    assertEquals(starts, [0, 1800, 3600, 5400]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("publishes more than one embedding batch as one complete canonical index with exact offsets", async () => {
  const root = await makeTempDir();
  try {
    const localPath = `${root}/topic.md`;
    const source = "---\ntype: Topic\n---\n" + "a".repeat(250_000);
    await Deno.writeTextFile(localPath, source);
    const currentPublished = await publishedForLocalPath(localPath);
    let commits = 0;
    let chunkCount = 0;
    const client = createMockClient({
      post: async (_path, payload) => {
        commits++;
        const body = JSON.parse(JSON.stringify(payload));
        chunkCount = body.chunks.length;
        for (const item of body.chunks) {
          assertEquals(source.slice(item.start_offset, item.end_offset), item.content);
          assertEquals(item.metadata.source, published.path);
        }
        return { ...currentPublished, indexed_chunk_count: chunkCount, model: body.model };
      },
    });
    await indexKnowledgeDocument({
      client,
      projectSlug: "project",
      branch: "preview",
      published: currentPublished,
      localPath,
      embedder: embedder(),
    });
    assertEquals(chunkCount > 100, true);
    assertEquals(commits, 1);
    assertEquals(await Deno.readTextFile(localPath), source);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("rejects noncanonical paths before reading source, embedding, or committing", async () => {
  let commits = 0;
  let embeddings = 0;
  for (
    const path of [
      "docs/topic.md",
      "Knowledge/topic.md",
      "knowledge-sibling/topic.md",
      "knowledge/topic.json",
    ]
  ) {
    await assertRejects(
      () =>
        indexKnowledgeDocument({
          client: createMockClient({
            post: async () => {
              commits++;
              return {};
            },
          }),
          projectSlug: "project",
          branch: "preview",
          published: { ...published, path },
          localPath: "/missing-canonical-source-must-not-be-read.md",
          embedder: embedder(() => {
            embeddings++;
          }),
        }),
      Error,
      "Canonical indexing requires a knowledge Markdown file.",
    );
  }
  assertEquals(commits, 0);
  assertEquals(embeddings, 0);
});

it("indexes accepted uppercase Markdown without changing its authored path", async () => {
  const root = await makeTempDir();
  try {
    const localPath = `${root}/Concept.MD`;
    const source = "---\ntype: Topic\n---\n# Uppercase concept\nAuthored content.\n";
    await Deno.writeTextFile(localPath, source);
    const uppercasePublished = await publishedForLocalPath(localPath, {
      path: "knowledge/Concept.MD",
    });
    let committedPath = "";
    const receipt = await indexKnowledgeDocument({
      client: createMockClient({
        post: async (path) => {
          committedPath = path;
          return {
            ...uppercasePublished,
            indexed_chunk_count: 1,
            model: { name: "text-embedding-3-small", provider: "openai", dimension: 1536 },
          };
        },
      }),
      projectSlug: "project",
      branch: "preview",
      published: uppercasePublished,
      localPath,
      embedder: embedder(),
    });
    assertEquals(
      committedPath,
      "/projects/project/branches/preview/files/knowledge%2FConcept.MD/index",
    );
    assertEquals(receipt.path, uppercasePublished.path);
    assertEquals(await Deno.readTextFile(localPath), source);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("legacy null index acknowledgements require verified existing-version eligibility", async () => {
  const root = await makeTempDir();
  try {
    const localPath = `${root}/topic.md`;
    const source = "\uFEFF---\r\ntype: Topic\r\nunknown: false\r\n---\r\nFull canonical body 🌱";
    await Deno.writeTextFile(localPath, source);
    const checksum = await computeHash(source);
    let replyChecksum: string | null = null;
    let providerCalls = 0;
    const client = createMockClient({
      post: async () => ({
        ...published,
        checksum: replyChecksum,
        indexed_chunk_count: 1,
        model: { name: "text-embedding-3-small", provider: "openai", dimension: 1536 },
      }),
    });
    const input = {
      client,
      projectSlug: "project",
      branch: "preview",
      localPath,
      published: { ...published, checksum },
      embedder: embedder(() => {
        providerCalls++;
      }),
    };
    await assertRejects(() => indexKnowledgeDocument(input), Error, "acknowledgement");
    const receipt = await indexKnowledgeDocument({
      ...input,
      checksumAcknowledgement: "legacy-null",
    });
    assertEquals(receipt.checksum, checksum);
    assertEquals(receipt.version_id, versionId);
    replyChecksum = "f".repeat(64);
    await assertRejects(
      () => indexKnowledgeDocument({ ...input, checksumAcknowledgement: "legacy-null" }),
      Error,
      "acknowledgement",
    );
    const before = providerCalls;
    await Deno.writeTextFile(localPath, source + " changed");
    await assertRejects(
      () => indexKnowledgeDocument({ ...input, checksumAcknowledgement: "legacy-null" }),
      Error,
      "verified complete source checksum",
    );
    assertEquals(providerCalls, before);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

it("rejects changed local bytes before embedding against a published checksum", async () => {
  const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-index-" });
  const localPath = `${tempDir}/doc.md`;
  try {
    await Deno.writeTextFile(localPath, "# Title\n\nChanged body.\n");

    let embedCalls = 0;
    let postCalls = 0;
    const publishedChecksum = await computeHash("# Title\n\nPublished body.\n");

    await assertRejects(
      () =>
        indexKnowledgeDocument({
          client: createMockClient({
            post: async () => {
              postCalls++;
              return {
                file_id: fileId,
                version_id: versionId,
                path: "knowledge/doc.md",
                checksum: publishedChecksum,
                indexed_chunk_count: 1,
                model: { provider: "test", name: "embedding", dimension: 768 },
              };
            },
          }),
          projectSlug: "project",
          branch: "main",
          published: {
            path: "knowledge/doc.md",
            file_id: fileId,
            version_id: versionId,
            checksum: publishedChecksum,
          },
          localPath,
          embedder: {
            model: "veryfront-cloud/test/embedding",
            embedMany: async () => {
              embedCalls++;
              return [Array.from({ length: 768 }, () => 0.1)];
            },
          },
        }),
      Error,
      "Canonical indexing requires the verified complete source checksum.",
    );

    assertEquals(embedCalls, 0);
    assertEquals(postCalls, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
