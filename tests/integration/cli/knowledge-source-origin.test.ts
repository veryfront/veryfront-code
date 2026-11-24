import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { computeHash } from "veryfront/utils";
import { join, relative, resolve } from "veryfront/platform/path";
import { inspectOkfDocument } from "veryfront/knowledge";
import {
  collectKnowledgeSources,
  ingestResolvedSources,
  runKnowledgeParser,
} from "../../../cli/commands/knowledge/command.ts";
import {
  buildCustomKnowledgePath,
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
  it("shares one local source key across relative and absolute input paths", async () => {
    const root = await makeTempDir({ prefix: "veryfront-local-source-identity-" });
    try {
      const absolute = join(root, "guide.md");
      const relativePath = relative(Deno.cwd(), absolute);
      assertEquals(
        buildKnowledgeIngestIdentity(createLocalSource(relativePath)).sourceKey,
        buildKnowledgeIngestIdentity(createLocalSource(absolute)).sourceKey,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("shares one automatic custom destination across local path spellings", async () => {
    const root = await makeTempDir({ prefix: "veryfront-local-custom-identity-" });
    try {
      const absolute = join(root, "contracts", "guide.md");
      assertEquals(
        await buildCustomKnowledgePath(
          createLocalSource(relative(Deno.cwd(), absolute)),
          "docs/imports",
        ),
        await buildCustomKnowledgePath(createLocalSource(absolute), "docs/imports"),
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("reuses a local output across input path spelling and title changes", async () => {
    const root = await makeTempDir({ prefix: "veryfront-local-source-output-" });
    try {
      const absolute = join(root, "guide.md");
      const outputDir = join(root, "output");
      const spellings = [relative(Deno.cwd(), absolute), absolute];
      const outputPaths: string[] = [];
      for (const [index, filePath] of spellings.entries()) {
        await Deno.writeTextFile(absolute, `# Version ${index}\n\nSynthetic document.`);
        const identity = buildKnowledgeIngestIdentity(createLocalSource(filePath));
        const result = await runKnowledgeParser({
          filePath,
          outputDir,
          ...identity,
          sourceReference: filePath,
          sourceKind: "local",
        });
        outputPaths.push(result.sandbox_output_path);
      }
      assertEquals(outputPaths[0], outputPaths[1]);
      const documents = [];
      for await (const entry of Deno.readDir(outputDir)) {
        if (entry.isFile && entry.name.endsWith(".md")) documents.push(entry.name);
      }
      assertEquals(documents.length, 1);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("keeps the same relative input in different working directories distinct", async () => {
    const root = await makeTempDir({ prefix: "veryfront-local-source-cwd-" });
    const originalDirectory = Deno.cwd();
    try {
      await Deno.mkdir(join(root, "first"));
      await Deno.mkdir(join(root, "second"));
      Deno.chdir(join(root, "first"));
      const first = buildKnowledgeIngestIdentity(createLocalSource("guide.md"));
      Deno.chdir(join(root, "second"));
      const second = buildKnowledgeIngestIdentity(createLocalSource("guide.md"));
      assert(first.sourceKey !== second.sourceKey);
    } finally {
      Deno.chdir(originalDirectory);
      await Deno.remove(root, { recursive: true });
    }
  });

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
          localKey: JSON.stringify(["local", resolve("uploads/article.md")]),
        },
        {
          sources: ["uploads/article.md", "./uploads"],
          uploadKey: '["upload","uploads/article.md"]',
          localKey: JSON.stringify(["local", resolve("uploads/article.md")]),
        },
        {
          sources: ["uploads/_knowledge-ingest/first/article.md", "article.md"],
          uploadKey: '["staged-upload","article.md"]',
          localKey: JSON.stringify(["local", resolve("article.md")]),
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
          assertEquals(inspectOkfDocument("article.md", localContent).metadata.tags, ["md"]);
          assertEquals(
            inspectOkfDocument("article.md", contentsByKey.get(uploadKey) ?? "").metadata.tags,
            ["upload", "md"],
          );
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
          resource: resolve(sourcePath),
          sourceReference: resolve(sourcePath),
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

  it("rejects relative legacy custom owners from another working directory", async () => {
    const root = await Deno.realPath(await makeTempDir({ prefix: "knowledge-relative-owner-" }));
    const cwd = Deno.cwd();
    try {
      for (const directory of ["original", "incoming"]) {
        await Deno.mkdir(join(root, directory, "nested"), { recursive: true });
        await Deno.writeTextFile(join(root, directory, "nested/guide.md"), `# ${directory} guide`);
      }
      for (const field of ["source", "resource"]) {
        Deno.chdir(join(root, "original"));
        const original =
          `---\n${field}: "./nested/guide.md"\ngenerated: { by: "veryfront/0.1.0" }\n---\n# Original guide`;
        const remotePath = "docs/imports/nested-guide.md";
        const remote = new Map([[remotePath, {
          content: original,
          versionId: "original-version",
        }]]);
        const writes: unknown[] = [];
        Deno.chdir(join(root, "incoming"));
        const result = await ingestResolvedSources(
          [createLocalSource("./nested/guide.md")],
          createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
          {
            client: createMockClient(),
            projectSlug: "test",
            outputDir: join(root, `fresh-${field}`),
            runParser: runKnowledgeParser,
            listRemoteKnowledgeSuffixPaths: async () => new Set(),
            readRemoteKnowledgeFile: async (path) => remote.get(path),
            uploadKnowledgeFile: async (path, file, _metadata, _kind, expected) => {
              writes.push({ path, expected });
              remote.set(path, { content: await Deno.readTextFile(file), versionId: "changed" });
              return { path };
            },
          },
        );
        assertEquals(result.failed.length, 1, field);
        const failure = result.failed[0];
        assert(failure);
        assertStringIncludes(failure.message, "source origin is ambiguous");
        assertEquals(writes, [], field);
        assertEquals([...remote], [[remotePath, {
          content: original,
          versionId: "original-version",
        }]]);
      }
    } finally {
      Deno.chdir(cwd);
      await Deno.remove(root, { recursive: true });
    }
  });

  it("retains an absolute source-only custom owner for a relative local input", async () => {
    const root = await Deno.realPath(await makeTempDir({ prefix: "knowledge-source-only-alias-" }));
    const cwd = Deno.cwd();
    try {
      Deno.chdir(root);
      const absolute = join(root, "guide.md");
      await Deno.writeTextFile(absolute, "# Updated guide\n\nCurrent local body.");
      const remotePath = "docs/imports/guide.md";
      const original = `---\nsource: ${
        JSON.stringify(absolute)
      }\ngenerated: { by: "veryfront/0.1.0" }\n---\n# Old guide\n\nLegacy local body.`;
      const remote = new Map([[remotePath, { content: original, versionId: "legacy-version" }]]);
      const writes: unknown[] = [];
      const result = await ingestResolvedSources(
        [createLocalSource("./guide.md")],
        createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
        {
          client: createMockClient(),
          projectSlug: "test",
          outputDir: join(root, "fresh-output"),
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
      assertEquals(result.failed, []);
      assertEquals(result.ingested[0]?.remotePath, remotePath);
      assertEquals([...remote.keys()], [remotePath]);
      assertEquals(writes, [{ path: remotePath, expected: { versionId: "legacy-version" } }]);
      const updated = remote.get(remotePath);
      assert(updated);
      assertStringIncludes(updated.content, "Current local body.");
      assertEquals(
        readKnowledgeIngestSourceKey(inspectOkfDocument(remotePath, updated.content).metadata),
        JSON.stringify(["local", absolute]),
      );
    } finally {
      Deno.chdir(cwd);
      await Deno.remove(root, { recursive: true });
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
  it("retains an explicitly migrated old typed custom destination", async () => {
    const root = await Deno.realPath(await makeTempDir({ prefix: "veryfront-migrated-origin-" }));
    const cwd = Deno.cwd();
    try {
      Deno.chdir(root);
      await Deno.mkdir("area");
      await Deno.writeTextFile("area/guide.md", "# Guide\n\nCurrent body.");
      const source = createLocalSource("./area/guide.md");
      const oldKey = JSON.stringify(["local", "area/guide.md"]);
      const oldSlug = `area-guide-source-${await computeHash(oldKey)}`;
      const oldPath = `docs/imports/${oldSlug}.md`;
      const remote = new Map([[oldPath, {
        content: `---\nresource: "./area/guide.md"\ngenerated: {by: "veryfront/0.1.0",source_key: ${
          JSON.stringify(oldKey)
        }}\n---\nOld body.`,
        versionId: "old-version",
      }]]);
      const deps = {
        client: createMockClient(),
        projectSlug: "test",
        outputDir: join(root, "output"),
        runParser: runKnowledgeParser,
        listRemoteKnowledgeSuffixPaths: async (stem: string) =>
          new Set([...remote.keys()].filter((path) => path.startsWith(stem + "-"))),
        readRemoteKnowledgeFile: async (path: string) => remote.get(path),
        uploadKnowledgeFile: async (path: string, file: string) => {
          remote.set(path, { content: await Deno.readTextFile(file), versionId: "new-version" });
          return { path };
        },
      };
      const migrated = await ingestResolvedSources(
        [source],
        createKnowledgeCommandArgs({ knowledgePath: "docs/imports", slug: oldSlug }),
        deps,
      );
      assertEquals(migrated.failed, []);
      for (const localPath of ["./area/guide.md", join(root, "area/guide.md")]) {
        const automatic = await ingestResolvedSources(
          [createLocalSource(localPath)],
          createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
          deps,
        );
        assertEquals(automatic.failed, []);
        assertEquals(automatic.ingested[0]?.remotePath, oldPath);
        assertEquals(remote.size, 1);
      }
      Deno.chdir(cwd);
      const moved = await ingestResolvedSources(
        [createLocalSource(join(root, "area/guide.md"))],
        createKnowledgeCommandArgs({ knowledgePath: "docs/imports" }),
        deps,
      );
      assertEquals(moved.failed, []);
      assertEquals(moved.ingested[0]?.remotePath, oldPath);
      assertEquals(remote.size, 1);
    } finally {
      Deno.chdir(cwd);
      await Deno.remove(root, { recursive: true });
    }
  });
});
