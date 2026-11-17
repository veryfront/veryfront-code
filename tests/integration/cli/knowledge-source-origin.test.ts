import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";
import { inspectOkfDocument } from "veryfront/knowledge";
import {
  collectKnowledgeSources,
  ingestResolvedSources,
  runKnowledgeParser,
} from "../../../cli/commands/knowledge/command.ts";
import {
  buildKnowledgeIngestIdentity,
  claimGeneratedKnowledgePath,
  collectLocalFiles,
  readKnowledgeIngestSourceKey,
} from "../../../cli/commands/knowledge/command-helpers.ts";
import {
  createIndexReceipt,
  createKnowledgeCommandArgs,
  createLocalSource,
  createMockClient,
  createUploadSource,
} from "../../../cli/commands/knowledge/command.test-helpers.ts";

describe("isolated knowledge source origins", () => {
  it("keeps local, remote, and staged sources separate when resource names overlap", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-local-upload-" });
    const cwd = Deno.cwd();
    try {
      await Deno.mkdir(join(tempDir, "uploads"));
      await Deno.writeTextFile(join(tempDir, "uploads/article.md"), "# Overview\n\nLocal article.");
      await Deno.writeTextFile(join(tempDir, "article.md"), "# Overview\n\nLocal article.");
      const downloadedPath = join(tempDir, "downloaded.md");
      await Deno.writeTextFile(downloadedPath, "# Overview\n\nRemote article.");
      Deno.chdir(tempDir);

      const cases = [
        {
          sources: ["uploads/article.md", "./uploads/article.md"],
          uploadKey: '["upload","uploads/article.md"]',
          localKey: '["local","uploads/article.md"]',
        },
        {
          sources: ["uploads/article.md", "./uploads"],
          uploadKey: '["upload","uploads/article.md"]',
          localKey: '["local","uploads/article.md"]',
        },
        {
          sources: ["uploads/_knowledge-ingest/first/article.md", "article.md"],
          uploadKey: '["staged-upload","article.md"]',
          localKey: '["local","article.md"]',
        },
      ];

      for (const [index, { sources, uploadKey, localKey }] of cases.entries()) {
        for (const knowledgePath of ["knowledge", "docs/imports"]) {
          const options = createKnowledgeCommandArgs({ knowledgePath, sources, recursive: true });
          const client = createMockClient();
          const collection = await collectKnowledgeSources(options, {
            client,
            projectSlug: "my-project",
            downloadUploads: async (paths) =>
              paths.map((uploadPath) => ({ uploadPath, localPath: downloadedPath })),
          });
          assertEquals(collection.sources.map(({ kind }) => kind), ["upload", "local"]);

          const remote = new Map<string, string>();
          const result = await ingestResolvedSources(collection.sources, options, {
            client,
            projectSlug: "my-project",
            outputDir: join(tempDir, `run-${index}`, knowledgePath),
            runParser: runKnowledgeParser,
            findRemoteKnowledgeSource: async ({ sourceKey }) => {
              for (const [path, content] of remote) {
                if (
                  readKnowledgeIngestSourceKey(inspectOkfDocument(path, content).metadata) ===
                    sourceKey
                ) {
                  return { path, versionId: path };
                }
              }
            },
            listRemoteKnowledgeSuffixPaths: async () => new Set(remote.keys()),
            readRemoteKnowledgeFile: async (path) => {
              const content = remote.get(path);
              return content === undefined ? undefined : { content, versionId: path };
            },
            indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
            uploadKnowledgeFile: async (path, file, _metadata, _kind, expected) => {
              assertEquals(expected, { absent: true });
              remote.set(path, await Deno.readTextFile(file));
              return { path };
            },
          });

          assertEquals(result.failed, []);
          assertEquals(remote.size, 2);
          assertEquals(new Set(result.ingested.map(({ outputPath }) => outputPath)).size, 2);
          const contentsByKey = new Map(
            [...remote].map(([path, content]) => [
              readKnowledgeIngestSourceKey(inspectOkfDocument(path, content).metadata),
              content,
            ]),
          );
          assertStringIncludes(contentsByKey.get(uploadKey) ?? "", "Remote article.");
          assertStringIncludes(contentsByKey.get(localKey) ?? "", "Local article.");
          const localContent = contentsByKey.get(localKey) ?? "";
          const localSource = collection.sources.find(({ kind }) => kind === "local");
          assert(localSource);
          assertEquals(
            inspectOkfDocument("article.md", localContent).metadata.resource,
            knowledgePath === "knowledge"
              ? buildKnowledgeIngestIdentity(localSource).resource
              : localSource.localPath,
          );
        }
      }
    } finally {
      Deno.chdir(cwd);
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("updates positively local generated documents from before typed identities", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-legacy-local-" });
    const cwd = Deno.cwd();
    try {
      await Deno.mkdir(join(tempDir, "uploads"));
      await Deno.writeTextFile(join(tempDir, "guide.md"), "# Guide\n\nOriginal guide.");
      await Deno.writeTextFile(join(tempDir, "uploads/guide.md"), "# Guide\n\nOriginal guide.");
      Deno.chdir(tempDir);
      for (const sourcePath of [join(tempDir, "guide.md"), "./guide.md", "./uploads/guide.md"]) {
        const source = createLocalSource(sourcePath);
        const old = await runKnowledgeParser({
          filePath: source.localPath,
          outputDir: join(tempDir, "old"),
          resource: sourcePath,
          sourceReference: sourcePath,
        });
        const content = await Deno.readTextFile(old.sandbox_output_path);
        assertEquals(
          readKnowledgeIngestSourceKey(inspectOkfDocument("guide.md", content).metadata),
          undefined,
        );
        const basename = sourcePath === "./uploads/guide.md" ? "uploads-guide" : "guide";
        const remotePath = `docs/imports/${basename}.md`;
        const remote = new Map([[remotePath, { content, versionId: "legacy-version" }]]);
        const writes: unknown[] = [];
        const result = await ingestResolvedSources(
          [source],
          createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
          {
            client: createMockClient(),
            projectSlug: "my-project",
            outputDir: join(tempDir, "generated"),
            runParser: runKnowledgeParser,
            listRemoteKnowledgeSuffixPaths: async () => new Set(),
            readRemoteKnowledgeFile: async (path) => remote.get(path),
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
        assertEquals(result.failed, [], sourcePath);
        assertEquals([...remote.keys()], [remotePath]);
        assertEquals(writes, [{ path: remotePath, expected: { versionId: "legacy-version" } }]);
      }
    } finally {
      Deno.chdir(cwd);
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("keeps walked local upload-shaped paths ambiguous without a typed origin", async () => {
    const cwd = Deno.cwd();
    const tempDir = await makeTempDir({ prefix: "veryfront-knowledge-legacy-walk-" });
    try {
      Deno.chdir(tempDir);
      for (const staged of [false, true]) {
        const directory = staged ? "uploads/_knowledge-ingest/old" : "uploads";
        await Deno.mkdir(directory, { recursive: true });
        await Deno.writeTextFile(`${directory}/article.md`, "# Local article\n\nLocal original.");
        const { sources } = await collectLocalFiles(`./${directory}`, false);
        assertEquals(sources.length, 1);
        const local = sources[0];
        assert(local && local.kind === "local");
        assertEquals(local.localPath, `${directory}/article.md`);
        // Exact source-only shape emitted by parser.ts before 48fb6ee1b3.
        // Directory walking removed the explicit ./ before the parser saw it.
        const content = `---\ntype: "Generated Document"\nsource: ${
          JSON.stringify(local.localPath)
        }\nsource_type: "md"\ngenerated: { by: "veryfront/0.1.0" }\n---\nLocal original.`;
        const source = createUploadSource(
          staged ? "uploads/_knowledge-ingest/new/article.md" : "uploads/article.md",
          "download.md",
        );
        const identity = buildKnowledgeIngestIdentity(source);
        const path = staged
          ? "docs/imports/knowledge-ingest-old-article.md"
          : "docs/imports/article.md";
        await assertRejects(
          () =>
            claimGeneratedKnowledgePath({
              remotePath: "docs/imports/article.md",
              ...identity,
              sourceKind: "upload",
              legacySource: source.uploadPath,
              customSource: source,
              scanSuffixGaps: true,
              absenceConflicts: new Map(),
              listSuffixPaths: async () => new Set([path]),
              readRemoteFile: async (candidate) =>
                candidate === path ? { content, versionId: "local-version" } : undefined,
            }),
          Error,
          "origin is ambiguous",
        );
      }
    } finally {
      Deno.chdir(cwd);
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});
