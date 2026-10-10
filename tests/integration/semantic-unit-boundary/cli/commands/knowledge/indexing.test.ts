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
const published = {
  path: "knowledge/topic.md",
  file_id: fileId,
  version_id: versionId,
  checksum: "fixture-checksum",
};

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
    const client = createMockClient({
      post: async (path, body) => {
        committedPath = path;
        committedBody = body;
        return {
          ...published,
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
          return published;
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
    let payload: unknown;
    const client = createMockClient({
      post: async (_path, body) => {
        payload = body;
        return {
          ...published,
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
          published,
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
    const input = { client, projectSlug: "project", branch: "preview", published, localPath };
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
    await assertRejects(
      () =>
        indexKnowledgeDocument({
          ...input,
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

it("cancellation during provider work settles before returning and never commits", async () => {
  const root = await makeTempDir();
  try {
    const localPath = `${root}/topic.md`;
    await Deno.writeTextFile(localPath, "Text to index");
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
          published,
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
    let starts: number[] = [];
    const client = createMockClient({
      post: async (_path, payload) => {
        const body = JSON.parse(JSON.stringify(payload));
        starts = body.chunks.map((item: { start_offset: number }) => item.start_offset);
        return { ...published, indexed_chunk_count: starts.length, model: body.model };
      },
    });
    await indexKnowledgeDocument({
      client,
      projectSlug: "project",
      branch: "preview",
      published,
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
        return { ...published, indexed_chunk_count: chunkCount, model: body.model };
      },
    });
    await indexKnowledgeDocument({
      client,
      projectSlug: "project",
      branch: "preview",
      published,
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
