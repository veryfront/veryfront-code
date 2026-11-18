import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";
import { inspectOkfDocument } from "veryfront/knowledge";
import {
  ingestResolvedSources,
  runKnowledgeParser,
  runKnowledgeParsers,
} from "../../../cli/commands/knowledge/command.ts";
import { KnowledgeAllocationSession } from "../../../cli/commands/knowledge/parser.ts";
import {
  createIndexReceipt,
  createKnowledgeCommandArgs,
  createMockClient,
  createUploadSource,
} from "../../../cli/commands/knowledge/command.test-helpers.ts";

describe("local allocation sessions", () => {
  it("releases a failed exact writer and refreshes queued allocations", async () => {
    const root = await makeTempDir({ prefix: "knowledge-direct-failure-" });
    try {
      const filePath = join(root, "input.md");
      const outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      const allocationSession = new KnowledgeAllocationSession();
      const parse = (resource: string) =>
        runKnowledgeParser(
          { filePath, outputDir, resource },
          { allocationSession },
        );
      const first = await parse("a");
      const original = await Deno.readTextFile(first.sandbox_output_path);
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const failure = assertRejects(
        () =>
          allocationSession.directWrite(outputDir, async () => {
            entered.resolve();
            await release.promise;
            await Deno.writeTextFile(
              first.sandbox_output_path,
              original.replace('resource: "a"', 'resource: "b"'),
            );
            throw new Error("Exact write failed after changing identity");
          }),
        Error,
        "Exact write failed",
      );
      await entered.promise;
      const queued = parse("b");
      release.resolve();
      await failure;
      assertEquals((await queued).slug, "shared");
      assertEquals((await parse("b")).slug, "shared");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  for (const preserve of [false, true]) {
    it(`invalidates observations after ${preserve ? "canonical OKF preservation" : "an explicit slug overwrite"}`, async () => {
      const root = await makeTempDir({ prefix: "knowledge-direct-write-" });
      try {
        const filePath = join(root, "input.md");
        await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
        const canonical = await runKnowledgeParser({
          filePath,
          outputDir: join(root, "canonical"),
          resource: "b",
        });
        const results = await runKnowledgeParsers({
          outputDir: join(root, "output"),
          files: [
            { filePath, resource: "a" },
            preserve
              ? { filePath: canonical.sandbox_output_path, okfRelativePath: "shared.md" }
              : { filePath, resource: "b", slug: "shared" },
            { filePath, resource: "b" },
          ],
        });
        assertEquals(results.map(({ slug }) => slug), ["shared", "shared", "shared"]);
        const final = results[2];
        assert(final);
        assertEquals(
          inspectOkfDocument("shared.md", await Deno.readTextFile(final.sandbox_output_path))
            .metadata.resource,
          "b",
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }

  for (const ingestion of [false, true]) {
    it(`bounds output reads for ${ingestion ? "ingestResolvedSources" : "standalone batch"} same-title inputs`, async () => {
      const root = await makeTempDir({ prefix: "knowledge-allocation-" });
      const outputDir = join(root, "output");
      const read = Deno.readTextFile;
      let reads = 0;
      try {
        const files = [];
        for (let index = 0; index < 120; index += 1) {
          const filePath = join(root, `${index}.md`);
          await Deno.writeTextFile(filePath, "# Shared title\n\nBody.");
          files.push({ filePath, sourceReference: `uploads/${index}.md` });
        }
        Deno.readTextFile = (path, options) => {
          if (String(path).startsWith(`${outputDir}/`)) reads += 1;
          return read(path, options);
        };
        if (ingestion) {
          const result = await ingestResolvedSources(
            files.map((file) => createUploadSource(file.sourceReference, file.filePath)),
            createKnowledgeCommandArgs(),
            {
              client: createMockClient(),
              projectSlug: "my-project",
              outputDir,
              runParser: runKnowledgeParser,
              uploadKnowledgeFile: async (path) => ({ path }),
              indexKnowledgeDocument: async (input) => createIndexReceipt(input.published.path),
            },
          );
          assertEquals(result.failed, []);
          assertEquals(result.ingested.length, files.length);
        } else {
          const results = await runKnowledgeParsers({ files, outputDir });
          assertEquals(results.at(-1)?.slug, "shared-title-120");
        }
        assert(reads <= 240, `Expected linear output reads, received ${reads}`);
      } finally {
        Deno.readTextFile = read;
        await Deno.remove(root, { recursive: true });
      }
    });
  }

  it("reuses the first existing source when legacy outputs contain duplicate identities", async () => {
    const root = await makeTempDir({ prefix: "knowledge-allocation-first-owner-" });
    try {
      const filePath = join(root, "input.md");
      const outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      const first = await runKnowledgeParser({ filePath, outputDir, resource: "original" });
      await Deno.copyFile(first.sandbox_output_path, join(outputDir, "shared-2.md"));
      const allocationSession = new KnowledgeAllocationSession();
      const parse = (resource: string) =>
        runKnowledgeParser(
          { filePath, outputDir, resource },
          { allocationSession },
        );
      assertEquals((await parse("other")).slug, "shared-3");
      assertEquals((await parse("original")).slug, "shared");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("rechecks reuse identity, recovers a rejected queue, and resets observations for fresh batches", async () => {
    const root = await makeTempDir({ prefix: "knowledge-allocation-reuse-" });
    try {
      const filePath = join(root, "input.md");
      const outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      const allocationSession = new KnowledgeAllocationSession();
      const parse = (resource: string, signal?: AbortSignal) =>
        runKnowledgeParser(
          { filePath, outputDir, resource },
          { allocationSession, signal },
        );
      const results = await Promise.all([parse("a"), parse("b"), parse("a")]);
      assertEquals(results.map(({ slug }) => slug), ["shared", "shared-2", "shared"]);
      const original = await Deno.readTextFile(join(outputDir, "shared.md"));
      const retagged = original.replace('resource: "a"', 'resource: "other"');
      assert(retagged !== original);
      await Deno.writeTextFile(join(outputDir, "shared.md"), retagged);
      assertEquals((await parse("a")).slug, "shared-3");
      assertEquals(await Deno.readTextFile(join(outputDir, "shared.md")), retagged);
      const controller = new AbortController();
      const read = Deno.readTextFile;
      let cancelledDuringAllocation = false;
      Deno.readTextFile = (path, options) => {
        if (String(path) === join(outputDir, "shared-4.md")) {
          cancelledDuringAllocation = true;
          controller.abort();
        }
        return read(path, options);
      };
      try {
        await assertRejects(() => parse("c", controller.signal));
      } finally {
        Deno.readTextFile = read;
      }
      assert(cancelledDuringAllocation);
      assertEquals((await parse("c")).slug, "shared-4");
      await Deno.remove(join(outputDir, "shared.md"));
      assertEquals(
        (await runKnowledgeParser({ filePath, outputDir, resource: "new" })).slug,
        "shared",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
