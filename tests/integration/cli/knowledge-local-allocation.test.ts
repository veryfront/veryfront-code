import { fileURLToPath, pathToFileURL } from "node:url";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";
import { computeHash } from "veryfront/utils";
import { inspectOkfDocument } from "veryfront/knowledge";
import {
  ingestResolvedSources,
  runKnowledgeParser,
  runKnowledgeParsers,
} from "../../../cli/commands/knowledge/command.ts";
import { readKnowledgeIngestSourceKey } from "../../../cli/commands/knowledge/command-helpers.ts";
import { KnowledgeAllocationSession } from "../../../cli/commands/knowledge/parser.ts";
import {
  createIndexReceipt,
  createKnowledgeCommandArgs,
  createMockClient,
  createUploadSource,
} from "../../../cli/commands/knowledge/command.test-helpers.ts";

describe("local allocation sessions", () => {
  for (const discovered of [false, true]) {
    it(`registers automatic writes in a ${discovered ? "discovered" : "new"} parent family`, async () => {
      const root = await makeTempDir({ prefix: "knowledge-family-write-" });
      try {
        const outputDir = join(root, "output"),
          filePath = join(root, "input.md"),
          other = join(root, "other.md");
        await Deno.writeTextFile(filePath, "# Shared\n\nLegacy.");
        await runKnowledgeParser({ filePath, outputDir, resource: "same" });
        const session = new KnowledgeAllocationSession();
        if (discovered) {
          await runKnowledgeParser({
            filePath,
            outputDir,
            resource: "same",
            sourceKey: "first-key",
          }, { allocationSession: session });
        }
        await Deno.writeTextFile(other, discovered ? "# Shared 3\n\nBody." : "# Shared 2\n\nBody.");
        const first = await runKnowledgeParser({
          filePath: other,
          outputDir,
          resource: "same",
          sourceKey: "key",
        }, { allocationSession: session });
        const next = await runKnowledgeParser({
          filePath,
          outputDir,
          resource: "same",
          sourceKey: "key",
        }, { allocationSession: session });
        assertEquals(next.slug, first.slug);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }
  it("does not reserve a positively identified foreign output while scanning", async () => {
    const root = await makeTempDir({ prefix: "knowledge-foreign-reservation-" }), link = Deno.link;
    try {
      const filePath = join(root, "input.md"),
        outputDir = join(root, "output"),
        owner = { filePath, outputDir, resource: "a", sourceKey: "a-key" };
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      await runKnowledgeParser(owner);
      const claim = `${await computeHash("shared")}.lock`;
      let intercepted = false;
      Deno.link = async (oldPath, newPath) => {
        await link(oldPath, newPath);
        if (String(newPath).endsWith(claim) && !intercepted) {
          intercepted = true;
          assertEquals((await runKnowledgeParser(owner)).slug, "shared");
        }
      };
      assertEquals(
        (await runKnowledgeParser({ ...owner, resource: "b", sourceKey: "b-key" })).slug,
        "shared-2",
      );
      assertEquals(intercepted, false);
    } finally {
      Deno.link = link;
      await Deno.remove(root, { recursive: true });
    }
  });
  for (const shape of ["directory", "cyclic symlink", "directory symlink"]) {
    it(`skips a selected ${shape} collision under its reservation`, async () => {
      const root = await makeTempDir({ prefix: "knowledge-selected-shape-" });
      try {
        const filePath = join(root, "input.md"),
          outputDir = join(root, "output"),
          target = join(outputDir, "shared.md");
        await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
        await Deno.mkdir(outputDir);
        if (shape === "directory") await Deno.mkdir(target);
        else if (shape === "cyclic symlink") await Deno.symlink("shared.md", target);
        else {
          const directory = join(root, "directory");
          await Deno.mkdir(directory);
          await Deno.symlink(directory, target);
        }
        assertEquals(
          (await runKnowledgeParser({ filePath, outputDir, resource: "a", sourceKey: "key" })).slug,
          "shared-2",
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }
  it("reselects a legacy hint after the selected typed owner changes", async () => {
    const root = await makeTempDir({ prefix: "knowledge-selected-retag-" });
    try {
      const filePath = join(root, "input.md"),
        outputDir = join(root, "output"),
        input = { filePath, outputDir, resource: "a", sourceKey: "a-key" };
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      await runKnowledgeParser({ ...input, sourceKey: undefined, slug: "shared" });
      await runKnowledgeParser({ ...input, slug: "shared-2" });
      const allocationSession = new KnowledgeAllocationSession();
      assertEquals((await runKnowledgeParser(input, { allocationSession })).slug, "shared-2");
      await runKnowledgeParser({ ...input, resource: "b", sourceKey: "b-key", slug: "shared-2" });
      assertEquals((await runKnowledgeParser(input, { allocationSession })).slug, "shared");
      const preserved = await Deno.readTextFile(join(outputDir, "shared-2.md"));
      assertEquals(
        readKnowledgeIngestSourceKey(inspectOkfDocument("shared-2.md", preserved).metadata),
        "b-key",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
  it("keeps a concurrent keyless refresh separate from a typed legacy upgrade", async () => {
    const root = await makeTempDir({ prefix: "knowledge-keyless-contention-" }),
      write = Deno.writeTextFile;
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let pending: Promise<unknown> | undefined;
    try {
      const filePath = join(root, "input.md"),
        other = join(root, "other.md"),
        outputDir = join(root, "output"),
        target = join(outputDir, "shared.md");
      await write(filePath, "# Shared\n\nOriginal.");
      await runKnowledgeParser({ filePath, outputDir, resource: "same" });
      await write(filePath, "# Shared\n\nTyped body.");
      await write(other, "# Shared\n\nKeyless body.");
      let paused = false;
      Deno.writeTextFile = async (path, data, options) => {
        if (String(path) === target && !paused) {
          paused = true;
          entered.resolve();
          await release.promise;
        }
        await write(path, data, options);
      };
      pending = runKnowledgeParser({ filePath, outputDir, resource: "same", sourceKey: "key" });
      await entered.promise;
      const result = await runKnowledgeParser({ filePath: other, outputDir, resource: "same" });
      assertEquals(result.slug, "shared-2");
      release.resolve();
      await pending;
      assert((await Deno.readTextFile(target)).includes("Typed body."));
      assert((await Deno.readTextFile(result.sandbox_output_path)).includes("Keyless body."));
    } finally {
      release.resolve();
      await pending?.catch(() => undefined);
      Deno.writeTextFile = write;
      await Deno.remove(root, { recursive: true });
    }
  });
  for (const keyed of [false, true]) {
    it(`discovers an existing ${keyed ? "typed" : "legacy"} suffix when the base slot is absent`, async () => {
      const root = await makeTempDir({ prefix: "knowledge-suffix-gap-" });
      try {
        const filePath = join(root, "input.md"), outputDir = join(root, "output");
        await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
        const input = {
          filePath,
          outputDir,
          resource: "same",
          sourceKey: keyed ? "key" : undefined,
        };
        await runKnowledgeParser({ ...input, slug: "shared-2" });
        assertEquals((await runKnowledgeParser({ ...input, sourceKey: "key" })).slug, "shared-2");
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }
  for (
    const mode of [
      "new empty",
      "suffix empty",
      "legacy empty",
      "legacy truncated",
      "legacy header",
      "typed header",
    ]
  ) {
    const existing = mode !== "new empty" && mode !== "suffix empty";
    it(`rejects a same-key retry during a ${mode} write`, async () => {
      const root = await makeTempDir({ prefix: "knowledge-empty-output-" }),
        write = Deno.writeTextFile;
      const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      let pending: Promise<unknown> | undefined;
      try {
        const filePath = join(root, "input.md"), outputDir = join(root, "output");
        await write(filePath, "# Shared\n\nComplete body.");
        const input = { filePath, outputDir, resource: "same", sourceKey: "key" };
        const target = join(outputDir, mode === "suffix empty" ? "shared-2.md" : "shared.md");
        if (existing) {
          await runKnowledgeParser({
            ...input,
            sourceKey: mode === "typed header" ? "key" : undefined,
          });
        }
        let paused = false;
        Deno.writeTextFile = async (path, data, options) => {
          if (String(path) === target && !paused) {
            paused = true;
            const partial = mode === "legacy truncated" && typeof data === "string"
              ? data.slice(0, 8)
              : mode.endsWith("header")
              ? await Deno.readTextFile(path)
              : "";
            await write(path, partial, options);
            entered.resolve();
            await release.promise;
            await write(path, data, { ...options, createNew: false });
          } else await write(path, data, options);
        };
        if (mode === "suffix empty") await write(filePath, "# Shared 2\n\nComplete body.");
        pending = runKnowledgeParser(input);
        await entered.promise;
        if (mode === "suffix empty") await write(filePath, "# Shared\n\nComplete body.");
        await assertRejects(() => runKnowledgeParser(input), Error, "busy or reserved");
        release.resolve();
        await pending;
        const content = await Deno.readTextFile(target);
        assert(content.includes("Complete body."));
        assertEquals(
          readKnowledgeIngestSourceKey(inspectOkfDocument("shared.md", content).metadata),
          "key",
        );
      } finally {
        release.resolve();
        await pending?.catch(() => undefined);
        Deno.writeTextFile = write;
        await Deno.remove(root, { recursive: true });
      }
    });
  }
  for (const count of [50, 100, 200]) {
    it(`bounds metadata probes while migrating ${count} stable legacy siblings`, async () => {
      const root = await makeTempDir({ prefix: "knowledge-epoch-metadata-" }), lstat = Deno.lstat;
      try {
        const filePath = join(root, "input.md"), outputDir = join(root, "output");
        await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
        const files = [];
        for (let i = 0; i < count; i++) {
          const resource = `resource-${i}`;
          await runKnowledgeParser({
            filePath,
            outputDir,
            resource,
            slug: i ? `shared-${i + 1}` : "shared",
          });
          files.push({ filePath, resource, sourceKey: `key-${i}` });
        }
        let probes = 0;
        Deno.lstat = async (path) => {
          if (String(path).startsWith(outputDir)) probes++;
          return await lstat(path);
        };
        const results = await runKnowledgeParsers({ files, outputDir });
        assertEquals(
          results.map(({ slug }) => slug),
          files.map((_, i) => i ? `shared-${i + 1}` : "shared"),
        );
        assert(probes <= count * 8, `Expected linear metadata probes, received ${probes}`);
      } finally {
        Deno.lstat = lstat;
        await Deno.remove(root, { recursive: true });
      }
    });
  }
  it("shares one directory snapshot across interleaved new and legacy titles", async () => {
    const root = await makeTempDir({ prefix: "knowledge-mixed-listing-" }), readDir = Deno.readDir;
    try {
      const outputDir = join(root, "output"), files = [];
      for (let i = 0; i < 20; i++) {
        const legacy = join(root, `legacy-${i}.md`), fresh = join(root, `fresh-${i}.md`);
        await Deno.writeTextFile(legacy, `# Legacy ${i}\n\nBody.`);
        await Deno.writeTextFile(fresh, `# Fresh ${i}\n\nBody.`);
        await runKnowledgeParser({ filePath: legacy, outputDir, resource: `legacy-${i}` });
        files.push({ filePath: fresh, resource: `fresh-${i}`, sourceKey: `fresh-key-${i}` });
        files.push({ filePath: legacy, resource: `legacy-${i}`, sourceKey: `legacy-key-${i}` });
      }
      let scans = 0;
      Deno.readDir = (path) => {
        if (String(path) === outputDir) scans++;
        return readDir(path);
      };
      const results = await runKnowledgeParsers({ files, outputDir });
      assertEquals(results.length, files.length);
      assertEquals(scans, 1);
    } finally {
      Deno.readDir = readDir;
      await Deno.remove(root, { recursive: true });
    }
  });
  it("keeps a matching typed owner despite an unreadable unrelated sibling", async () => {
    const root = await makeTempDir({ prefix: "knowledge-unreadable-sibling-" }),
      read = Deno.readTextFile;
    try {
      const filePath = join(root, "input.md"), outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      await runKnowledgeParser({ filePath, outputDir, resource: "a", slug: "shared" });
      await runKnowledgeParser({
        filePath,
        outputDir,
        resource: "a",
        sourceKey: "key",
        slug: "shared-2",
      });
      await runKnowledgeParser({ filePath, outputDir, resource: "other", slug: "shared-3" });
      Deno.readTextFile = (path, options) => {
        if (String(path) === join(outputDir, "shared-3.md")) {
          throw new Deno.errors.PermissionDenied("unreadable");
        }
        return read(path, options);
      };
      assertEquals(
        (await runKnowledgeParser({ filePath, outputDir, resource: "a", sourceKey: "key" })).slug,
        "shared-2",
      );
    } finally {
      Deno.readTextFile = read;
      await Deno.remove(root, { recursive: true });
    }
  });
  it("passes space-containing config paths to an actual child as filesystem paths", async () => {
    const root = await makeTempDir({ prefix: "knowledge checkout with spaces " });
    try {
      const config = join(root, "deno.json");
      await Deno.writeTextFile(config, "{}");
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "eval",
          "--config",
          fileURLToPath(pathToFileURL(config)),
          'console.log("child ready")',
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(output.success, new TextDecoder().decode(output.stderr));
      assertEquals(new TextDecoder().decode(output.stdout).trim(), "child ready");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
  it("recreates a missing cached keyed output without losing later duplicate preference", async () => {
    const root = await makeTempDir({ prefix: "knowledge-missing-known-" });
    try {
      const filePath = join(root, "input.md"), outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      const input = { filePath, outputDir, resource: "a", sourceKey: "a-key" };
      const allocationSession = new KnowledgeAllocationSession();
      assertEquals((await runKnowledgeParser(input, { allocationSession })).slug, "shared");
      await Deno.remove(join(outputDir, "shared.md"));
      assertEquals((await runKnowledgeParser(input, { allocationSession })).slug, "shared");
      await runKnowledgeParser({ ...input, slug: "shared-2" });
      await runKnowledgeParser({ ...input, slug: "shared-3" });
      await runKnowledgeParser({ filePath, outputDir, resource: "a", slug: "shared" });
      const fresh = new KnowledgeAllocationSession();
      assertEquals(
        (await runKnowledgeParser(input, { allocationSession: fresh })).slug,
        "shared-2",
      );
      await Deno.remove(join(outputDir, "shared-2.md"));
      assertEquals(
        (await runKnowledgeParser(input, { allocationSession: fresh })).slug,
        "shared-3",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
  it("rediscovers a deleted sibling in a new ingestion run", async () => {
    const root = await makeTempDir({ prefix: "knowledge-missing-discovered-" });
    try {
      const filePath = join(root, "input.md"), outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      await runKnowledgeParser({ filePath, outputDir, resource: "b", slug: "shared" });
      await runKnowledgeParser({
        filePath,
        outputDir,
        resource: "b",
        sourceKey: "b-key",
        slug: "shared-2",
      });
      await runKnowledgeParser({
        filePath,
        outputDir,
        resource: "c",
        sourceKey: "c-key",
        slug: "shared-3",
      });
      const allocationSession = new KnowledgeAllocationSession();
      await runKnowledgeParser({ filePath, outputDir, resource: "b", sourceKey: "b-key" }, {
        allocationSession,
      });
      await Deno.remove(join(outputDir, "shared-3.md"));
      assertEquals(
        (await runKnowledgeParser({ filePath, outputDir, resource: "d", sourceKey: "d-key" }, {
          allocationSession: new KnowledgeAllocationSession(),
        })).slug,
        "shared-3",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
  it("discovers an external keyless upgrade in a new ingestion run", async () => {
    const root = await makeTempDir({ prefix: "knowledge-external-legacy-upgrade-" });
    try {
      const filePath = join(root, "input.md"), outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      await runKnowledgeParser({ filePath, outputDir, resource: "a", slug: "shared" });
      await runKnowledgeParser({ filePath, outputDir, resource: "b", slug: "shared-2" });
      const typed = await runKnowledgeParser({
        filePath,
        outputDir,
        resource: "a",
        sourceKey: "a-key",
        slug: "shared-3",
      });
      const upgraded = await Deno.readTextFile(typed.sandbox_output_path);
      await runKnowledgeParser({
        filePath,
        outputDir,
        resource: "c",
        sourceKey: "c-key",
        slug: "shared-3",
      });
      const session = new KnowledgeAllocationSession();
      assertEquals(
        (await runKnowledgeParser({ filePath, outputDir, resource: "c", sourceKey: "c-key" }, {
          allocationSession: session,
        })).slug,
        "shared-3",
      );
      const legacy = await Deno.readTextFile(join(outputDir, "shared.md"));
      await Deno.writeTextFile(join(outputDir, "shared-2.md"), upgraded);
      assertEquals(
        (await runKnowledgeParser({ filePath, outputDir, resource: "a", sourceKey: "a-key" }, {
          allocationSession: new KnowledgeAllocationSession(),
        })).slug,
        "shared-2",
      );
      assertEquals(await Deno.readTextFile(join(outputDir, "shared.md")), legacy);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
  it("reuses regular outputs through portable link metadata", async () => {
    const root = await makeTempDir({ prefix: "knowledge-portable-links-" });
    try {
      const filePath = join(root, "input.md"), outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      const input = { filePath, outputDir, resource: "same", sourceKey: "same-key" };
      const original = await runKnowledgeParser(input);
      assertEquals(
        (await runKnowledgeParser(input)).sandbox_output_path,
        original.sandbox_output_path,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
  it("ignores a cyclic symlink while discovering an existing typed owner", async () => {
    const root = await makeTempDir({ prefix: "knowledge-cyclic-sibling-" });
    try {
      const filePath = join(root, "input.md"), outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      await runKnowledgeParser({ filePath, outputDir, resource: "same" });
      await runKnowledgeParser({
        filePath,
        outputDir,
        resource: "same",
        sourceKey: "key",
        slug: "shared-2",
      });
      await Deno.symlink("shared-3.md", join(outputDir, "shared-3.md"));
      assertEquals(
        (await runKnowledgeParser({ filePath, outputDir, resource: "same", sourceKey: "key" }))
          .slug,
        "shared-2",
      );
      assert((await Deno.lstat(join(outputDir, "shared-3.md"))).isSymlink);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
  it("ignores unsafe numeric siblings without blocking allocation", async () => {
    const root = await makeTempDir({ prefix: "knowledge-unsafe-suffix-" });
    try {
      const outputDir = join(root, "output"), filePath = join(root, "input.md");
      await Deno.writeTextFile(filePath, "# Shared\n\nRequested body.");
      await runKnowledgeParser({ filePath, outputDir, resource: "same" });
      for (
        const [suffix, sourceKey] of [["9007199254740992", "other"], [
          "9007199254740994",
          "requested",
        ]]
      ) {
        await runKnowledgeParser({
          filePath,
          outputDir,
          resource: "same",
          sourceKey,
          slug: `shared-${suffix}`,
        });
      }
      const worker = join(root, "worker.ts");
      await Deno.writeTextFile(
        worker,
        `
import { runKnowledgeParser } from ${
          JSON.stringify(new URL("../../../cli/commands/knowledge/parser.ts", import.meta.url).href)
        };
console.error("Numeric allocation child ready Deno " + Deno.version.deno);
console.log(JSON.stringify(await runKnowledgeParser({filePath:Deno.args[0],outputDir:Deno.args[1],resource:"same",sourceKey:"requested"})));
`,
      );
      const child = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--no-check",
          "--cached-only",
          "--deny-net",
          "--allow-read",
          "--allow-write",
          "--allow-env",
          "--config",
          fileURLToPath(new URL("../../../scripts/test.deno.json", import.meta.url)),
          worker,
          filePath,
          outputDir,
        ],
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch { /* Already exited. */ }
      }, 10000);
      let output;
      try {
        output = await child.output();
      } finally {
        clearTimeout(timer);
      }
      const stderr = new TextDecoder().decode(output.stderr);
      assert(
        stderr.includes("Numeric allocation child ready Deno"),
        `Child startup failed: ${stderr}`,
      );
      assert(output.success, `Allocation child failed after startup: ${stderr}`);
      const result = JSON.parse(new TextDecoder().decode(output.stdout));
      assertEquals(result.sandbox_output_path, join(outputDir, "shared.md"));
      const content = await Deno.readTextFile(result.sandbox_output_path);
      assert(content.includes("Requested body."));
      assertEquals(
        readKnowledgeIngestSourceKey(inspectOkfDocument("shared.md", content).metadata),
        "requested",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
  for (const alias of ["symlink", "hardlink"]) {
    it(`preserves independent owners when legacy outputs share a ${alias}`, async () => {
      const root = await makeTempDir({ prefix: "knowledge-alias-reuse-" }),
        write = Deno.writeTextFile;
      const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      let pending: Promise<unknown> | undefined;
      try {
        const outputDir = join(root, "output"),
          a = join(root, "a.md"),
          b = join(root, "b.md"),
          legacy = join(root, "legacy.md");
        await write(a, "# Shared\n\nA_BODY");
        await write(b, "# Shared\n\nB_BODY");
        await write(legacy, "# Shared\n\nLegacy.");
        await runKnowledgeParser({ filePath: legacy, outputDir, resource: "same" });
        const original = await Deno.readTextFile(join(outputDir, "shared.md"));
        if (alias === "symlink") await Deno.symlink("shared.md", join(outputDir, "shared-2.md"));
        else await Deno.link(join(outputDir, "shared.md"), join(outputDir, "shared-2.md"));
        let paused = false;
        Deno.writeTextFile = async (path, data, options) => {
          if (
            String(path).startsWith(outputDir) && String(path).endsWith(".md") &&
            typeof data === "string" && data.includes("A_BODY") && !paused
          ) {
            paused = true;
            entered.resolve();
            await release.promise;
          }
          await write(path, data, options);
        };
        pending = runKnowledgeParser({
          filePath: a,
          outputDir,
          resource: "same",
          sourceKey: "a-key",
        });
        await entered.promise;
        const second = await runKnowledgeParser({
          filePath: b,
          outputDir,
          resource: "same",
          sourceKey: "b-key",
        });
        release.resolve();
        await pending;
        const content = await Deno.readTextFile(second.sandbox_output_path);
        assert(content.includes("B_BODY"));
        assertEquals(
          readKnowledgeIngestSourceKey(inspectOkfDocument("shared.md", content).metadata),
          "b-key",
        );
        // Symlink targets may themselves remain eligible; hard-linked originals must remain untouched.
        if (alias === "hardlink") {
          assertEquals(await Deno.readTextFile(join(outputDir, "shared.md")), original);
        }
      } finally {
        release.resolve();
        await pending?.catch(() => undefined);
        Deno.writeTextFile = write;
        await Deno.remove(root, { recursive: true });
      }
    });
  }
  it("bounds metadata probes for repeated known typed owners after legacy discovery", async () => {
    const root = await makeTempDir({ prefix: "knowledge-known-owner-stats-" }),
      stat = Deno.stat,
      lstat = Deno.lstat;
    try {
      const filePath = join(root, "input.md"), outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      await runKnowledgeParser({ filePath, outputDir, resource: "legacy", slug: "shared" });
      const files = [];
      for (let i = 0; i < 120; i++) {
        const input = { filePath, resource: `source-${i}`, sourceKey: `key-${i}` };
        await runKnowledgeParser({ ...input, outputDir, slug: `shared-${i + 2}` });
        files.push(input);
      }
      const session = new KnowledgeAllocationSession();
      await runKnowledgeParser({ ...files[0], filePath, outputDir }, {
        allocationSession: session,
      });
      let probes = 0;
      Deno.stat = async (path) => {
        if (String(path).startsWith(outputDir)) probes++;
        return await stat(path);
      };
      Deno.lstat = async (path) => {
        if (String(path).startsWith(outputDir)) probes++;
        return await lstat(path);
      };
      for (const input of files) {
        await runKnowledgeParser({ ...input, outputDir }, { allocationSession: session });
      }
      assert(probes <= 120 * 10, `Expected bounded metadata probes, received ${probes}`);
    } finally {
      Deno.stat = stat;
      Deno.lstat = lstat;
      await Deno.remove(root, { recursive: true });
    }
  });
  it("rediscovers an externally retagged sibling in a new ingestion run", async () => {
    const root = await makeTempDir({ prefix: "knowledge-discovered-retag-" });
    try {
      const filePath = join(root, "input.md"), outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      const parse = (
        resource: string,
        sourceKey?: string,
        slug?: string,
        allocationSession?: KnowledgeAllocationSession,
      ) =>
        runKnowledgeParser({ filePath, outputDir, resource, sourceKey, slug }, {
          allocationSession,
        });
      await parse("a", undefined, "shared");
      await parse("a", "a-key", "shared-2");
      await parse("b", "b-key", "shared-3");
      const session = new KnowledgeAllocationSession();
      assertEquals((await parse("a", "a-key", undefined, session)).slug, "shared-2");
      await parse("c", "c-key", "shared-3");
      assertEquals(
        (await parse("c", "c-key", undefined, new KnowledgeAllocationSession())).slug,
        "shared-3",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
  it("reads externally changed sibling ownership in a new ingestion run", async () => {
    const root = await makeTempDir({ prefix: "knowledge-file-cache-retag-" });
    try {
      const filePath = join(root, "input.md"), outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      await runKnowledgeParser({ filePath, outputDir, resource: "a", slug: "shared" });
      await runKnowledgeParser({ filePath, outputDir, resource: "b", slug: "shared-2" });
      const typed = await runKnowledgeParser({
        filePath,
        outputDir,
        resource: "c",
        sourceKey: "c-key",
        slug: "shared-3",
      });
      const allocationSession = new KnowledgeAllocationSession();
      assertEquals(
        (await runKnowledgeParser({ filePath, outputDir, resource: "b", sourceKey: "b-key" }, {
          allocationSession,
        })).slug,
        "shared-2",
      );
      const legacy = await Deno.readTextFile(join(outputDir, "shared.md"));
      const prior = await Deno.readTextFile(typed.sandbox_output_path);
      await Deno.writeTextFile(
        typed.sandbox_output_path,
        prior.replace('resource: "c"', 'resource: "a"').replace(
          'source_key: "c-key"',
          'source_key: "a-key"',
        ),
      );
      assertEquals(
        (await runKnowledgeParser({ filePath, outputDir, resource: "a", sourceKey: "a-key" }, {
          allocationSession: new KnowledgeAllocationSession(),
        })).slug,
        "shared-3",
      );
      assertEquals(await Deno.readTextFile(join(outputDir, "shared.md")), legacy);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
  for (const keyed of [false, true]) {
    it(`preserves sibling legacy ownership when refreshing ${keyed ? "typed" : "keyless"} inputs`, async () => {
      const root = await makeTempDir({ prefix: "knowledge-legacy-order-" });
      try {
        const filePath = join(root, "input.md"), outputDir = join(root, "output");
        await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
        await runKnowledgeParser({ filePath, outputDir, resource: "a", slug: "shared" });
        await runKnowledgeParser({ filePath, outputDir, resource: "b", slug: "shared-2" });
        const allocationSession = new KnowledgeAllocationSession();
        assertEquals(
          (await runKnowledgeParser({ filePath, outputDir, resource: "b", sourceKey: "b-key" }, {
            allocationSession,
          })).slug,
          "shared-2",
        );
        assertEquals(
          (await runKnowledgeParser({
            filePath,
            outputDir,
            resource: "a",
            sourceKey: keyed ? "a-key" : undefined,
          }, { allocationSession })).slug,
          "shared",
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }
  it("bounds full-document reads while migrating a same-title legacy family", async () => {
    const root = await makeTempDir({ prefix: "knowledge-family-read-bound-" }),
      read = Deno.readTextFile;
    try {
      const filePath = join(root, "input.md"), outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      const files = [];
      for (let i = 0; i < 60; i++) {
        const resource = `resource-${i}`;
        await runKnowledgeParser({
          filePath,
          outputDir,
          resource,
          slug: i ? `shared-${i + 1}` : "shared",
        });
        files.push({ filePath, resource, sourceKey: `key-${i}` });
      }
      let reads = 0;
      Deno.readTextFile = (path, options) => {
        if (String(path).startsWith(outputDir) && String(path).endsWith(".md")) reads++;
        return read(path, options);
      };
      const results = await runKnowledgeParsers({ files, outputDir });
      assertEquals(
        results.map(({ slug }) => slug),
        files.map((_, i) => i ? `shared-${i + 1}` : "shared"),
      );
      assert(reads <= 300, `Expected bounded full-document reads, received ${reads}`);
    } finally {
      Deno.readTextFile = read;
      await Deno.remove(root, { recursive: true });
    }
  });
  it("starts fresh discovery after another ingestion creates a sibling", async () => {
    const root = await makeTempDir({ prefix: "knowledge-refresh-owner-" });
    try {
      const filePath = join(root, "input.md"), outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nOriginal.");
      const parse = (
        resource: string,
        sourceKey?: string,
        slug?: string,
        allocationSession?: KnowledgeAllocationSession,
      ) =>
        runKnowledgeParser({ filePath, outputDir, resource, sourceKey, slug }, {
          allocationSession,
        });
      await parse("a", undefined, "shared");
      await parse("b", undefined, "shared-2");
      await parse("a", "a-key", "shared-3");
      const session = new KnowledgeAllocationSession();
      assertEquals((await parse("a", "a-key", undefined, session)).slug, "shared-3");
      const legacy = await Deno.readTextFile(join(outputDir, "shared-2.md"));
      await parse("b", "b-key", "shared-4");
      assertEquals(
        (await parse("b", "b-key", undefined, new KnowledgeAllocationSession())).slug,
        "shared-4",
      );
      assertEquals(await Deno.readTextFile(join(outputDir, "shared-2.md")), legacy);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("shares directory enumeration across distinct legacy titles", async () => {
    const root = await makeTempDir({ prefix: "knowledge-distinct-legacy-" });
    const readDir = Deno.readDir;
    try {
      const outputDir = join(root, "output"), files = [];
      for (let i = 0; i < 120; i++) {
        const filePath = join(root, `source-${i}.md`);
        await Deno.writeTextFile(filePath, `# Topic ${i}\n\nBody.`);
        await runKnowledgeParser({ filePath, outputDir, resource: `source-${i}` });
        files.push({ filePath, resource: `source-${i}`, sourceKey: `key-${i}` });
      }
      let scans = 0, entries = 0;
      Deno.readDir = async function* (path) {
        if (String(path) === outputDir) scans++;
        for await (const entry of readDir(path)) {
          if (String(path) === outputDir) entries++;
          yield entry;
        }
      };
      const results = await runKnowledgeParsers({ files, outputDir });
      assertEquals(results.length, 120);
      assert(scans <= 3, `Expected shared enumeration, received ${scans} scans`);
      assert(entries <= 363, `Expected linear enumeration, received ${entries} entries`);
    } finally {
      Deno.readDir = readDir;
      await Deno.remove(root, { recursive: true });
    }
  });

  for (const sameSource of [false, true]) {
    it(`retries a disappeared contended reservation for ${sameSource ? "the same" : "a distinct"} source`, async () => {
      const root = await makeTempDir({ prefix: "knowledge-released-reservation-" });
      const write = Deno.writeTextFile, link = Deno.link;
      const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      let first: Promise<unknown> | undefined;
      try {
        const outputDir = join(root, "output"),
          fileA = join(root, "a.md"),
          fileB = join(root, "b.md");
        await write(fileA, "# Shared\n\nA_COMPLETE_BODY");
        await write(fileB, "# Shared\n\nB_COMPLETE_BODY");
        let paused = false;
        Deno.writeTextFile = async (path, data, options) => {
          if (String(path) === join(outputDir, "shared.md") && !paused) {
            paused = true;
            entered.resolve();
            await release.promise;
          }
          await write(path, data, options);
        };
        first = runKnowledgeParser({
          filePath: fileA,
          outputDir,
          resource: "a",
          sourceKey: "a-key",
        });
        await entered.promise;
        const lockPath = join(
          outputDir,
          ".veryfront",
          "knowledge-output-claims",
          "v1",
          `${await computeHash("shared")}.lock`,
        );
        let injected = false;
        Deno.link = async (oldPath, newPath) => {
          try {
            await link(oldPath, newPath);
          } catch (error) {
            if (String(newPath) === lockPath && !injected) {
              injected = true;
              release.resolve();
              await first;
            }
            throw error;
          }
        };
        const result = await runKnowledgeParser({
          filePath: fileB,
          outputDir,
          resource: sameSource ? "a" : "b",
          sourceKey: sameSource ? "a-key" : "b-key",
        });
        assert(injected);
        assertEquals(result.slug, sameSource ? "shared" : "shared-2");
        const content = await Deno.readTextFile(result.sandbox_output_path);
        assert(content.includes("B_COMPLETE_BODY"));
        assertEquals(
          readKnowledgeIngestSourceKey(inspectOkfDocument("shared.md", content).metadata),
          sameSource ? "a-key" : "b-key",
        );
        if (!sameSource) {
          assert(
            (await Deno.readTextFile(join(outputDir, "shared.md"))).includes("A_COMPLETE_BODY"),
          );
        }
      } finally {
        release.resolve();
        await first?.catch(() => undefined);
        Deno.writeTextFile = write;
        Deno.link = link;
        await Deno.remove(root, { recursive: true });
      }
    });
  }

  it("ignores directory-shaped and non-file symlink siblings during keyed owner discovery", async () => {
    const root = await makeTempDir({ prefix: "knowledge-directory-sibling-" });
    try {
      const filePath = join(root, "input.md"), outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      await runKnowledgeParser({ filePath, outputDir, resource: "same" });
      await runKnowledgeParser({
        filePath,
        outputDir,
        resource: "same",
        sourceKey: "same-key",
        slug: "shared-2",
      });
      await Deno.mkdir(join(outputDir, "shared-3.md"));
      if (Deno.build.os !== "windows") {
        await Deno.symlink(join(outputDir, "shared-3.md"), join(outputDir, "shared-4.md"));
      }
      const result = await runKnowledgeParser({
        filePath,
        outputDir,
        resource: "same",
        sourceKey: "same-key",
      });
      assertEquals(result.slug, "shared-2");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("preserves authored keyless resources without parser provenance", async () => {
    const root = await makeTempDir({ prefix: "knowledge-authored-owner-" });
    try {
      const filePath = join(root, "input.md");
      const outputDir = join(root, "output");
      await Deno.mkdir(outputDir);
      await Deno.writeTextFile(filePath, "# Shared\n\nReplacement.");
      const authored = '---\ntype: "Document"\nresource: "same"\n---\n# Shared\n\nAuthored body.\n';
      await Deno.writeTextFile(join(outputDir, "shared.md"), authored);
      const result = await runKnowledgeParser({
        filePath,
        outputDir,
        resource: "same",
        sourceKey: '["upload","same"]',
      });
      assertEquals(result.slug, "shared-2");
      assertEquals(await Deno.readTextFile(join(outputDir, "shared.md")), authored);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  for (const cached of [false, true]) {
    it(`prefers an existing typed owner over legacy adoption with ${cached ? "cached" : "uncached"} discovery`, async () => {
      const root = await makeTempDir({ prefix: "knowledge-owner-precedence-" });
      try {
        const filePath = join(root, "input.md");
        const outputDir = join(root, "output");
        const resource = "same", sourceKey = '["upload","same"]';
        await Deno.writeTextFile(filePath, "# Shared\n\nOriginal.");
        const legacy = await runKnowledgeParser({ filePath, outputDir, resource });
        const before = await Deno.readTextFile(legacy.sandbox_output_path);
        await runKnowledgeParser({ filePath, outputDir, resource, sourceKey, slug: "shared-2" });
        const allocationSession = new KnowledgeAllocationSession();
        if (cached) {
          await runKnowledgeParser({ filePath, outputDir, resource: "other", sourceKey: "other" }, {
            allocationSession,
          });
        }
        await Deno.writeTextFile(filePath, "# Shared\n\nUpdated typed owner.");
        const result = await runKnowledgeParser({ filePath, outputDir, resource, sourceKey }, {
          allocationSession,
        });
        assertEquals(result.slug, "shared-2");
        assert(
          (await Deno.readTextFile(result.sandbox_output_path)).includes("Updated typed owner."),
        );
        assertEquals(await Deno.readTextFile(legacy.sandbox_output_path), before);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }

  it("bounds discovery reads while preferring existing typed owners across a batch", async () => {
    const root = await makeTempDir({ prefix: "knowledge-existing-owners-" });
    const read = Deno.readTextFile;
    try {
      const filePath = join(root, "input.md");
      const outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      await runKnowledgeParser({ filePath, outputDir, resource: "source-0" });
      const files = [];
      for (let index = 0; index < 120; index += 1) {
        const input = {
          filePath,
          resource: `source-${index}`,
          sourceKey: JSON.stringify(["upload", `source-${index}`]),
        };
        await runKnowledgeParser({ ...input, outputDir, slug: `shared-${index + 2}` });
        files.push(input);
      }
      let reads = 0;
      Deno.readTextFile = (path, options) => {
        if (String(path).startsWith(`${outputDir}/`) && String(path).endsWith(".md")) reads += 1;
        return read(path, options);
      };
      const results = await runKnowledgeParsers({ files, outputDir });
      assertEquals(results.map(({ slug }) => slug), files.map((_, index) => `shared-${index + 2}`));
      assert(reads <= files.length * 4, `Expected bounded discovery reads, received ${reads}`);
    } finally {
      Deno.readTextFile = read;
      await Deno.remove(root, { recursive: true });
    }
  });

  it("recognizes same-key reservations before the first output write", async () => {
    const root = await makeTempDir({ prefix: "knowledge-before-create-" });
    const write = Deno.writeTextFile;
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let pending: Promise<unknown> | undefined;
    try {
      const filePath = join(root, "input.md"), outputDir = join(root, "output");
      await write(filePath, "# Shared\n\nComplete body.");
      const input = { filePath, outputDir, resource: "same", sourceKey: '["upload","same"]' };
      let paused = false;
      Deno.writeTextFile = async (path, data, options) => {
        if (String(path) === join(outputDir, "shared.md") && !paused) {
          paused = true;
          entered.resolve();
          await release.promise;
        }
        await write(path, data, options);
      };
      pending = runKnowledgeParser(input);
      await entered.promise;
      const error = await assertRejects(() => runKnowledgeParser(input), Error, "busy or reserved");
      assert(!error.message.includes(root));
      release.resolve();
      await pending;
      assertEquals((await runKnowledgeParser(input)).slug, "shared");
      assert((await Deno.readTextFile(join(outputDir, "shared.md"))).includes("Complete body."));
    } finally {
      release.resolve();
      await pending?.catch(() => undefined);
      Deno.writeTextFile = write;
      await Deno.remove(root, { recursive: true });
    }
  });

  for (const sourceKey of [42, null]) {
    it(`preserves malformed present source key ${sourceKey} instead of treating it as legacy absence`, async () => {
      const root = await makeTempDir({ prefix: "knowledge-malformed-key-" });
      try {
        const filePath = join(root, "article.md");
        const outputDir = join(root, "output");
        const resource = "uploads/article.md";
        await Deno.mkdir(outputDir);
        await Deno.writeTextFile(filePath, "# Shared\n\nNew body.");
        const existing =
          `---\ntype: "Document"\nresource: "${resource}"\ngenerated:\n  by: "veryfront/0.1.0"\n  source_key: ${
            JSON.stringify(sourceKey)
          }\n---\n# Shared\n\nProtected body.\n`;
        const path = join(outputDir, "shared.md");
        await Deno.writeTextFile(path, existing);
        const allocationSession = new KnowledgeAllocationSession();
        const parse = (kind: string) =>
          runKnowledgeParser(
            { filePath, outputDir, resource, sourceKey: JSON.stringify([kind, resource]) },
            { allocationSession },
          );
        assertEquals((await parse("upload")).slug, "shared-2");
        assertEquals((await parse("local")).slug, "shared-3");
        assertEquals(await Deno.readTextFile(path), existing);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }

  for (const shared of [false, true]) {
    it(`keeps keyed legacy claimants separate across ${shared ? "a shared session" : "independent invocations"}`, async () => {
      const root = await makeTempDir({ prefix: "knowledge-legacy-claims-" });
      const read = Deno.readTextFile;
      try {
        const outputDir = join(root, "output");
        const resource = "uploads/article.md";
        const legacyPath = join(root, "legacy.md");
        await Deno.writeTextFile(legacyPath, "# Shared\n\nLegacy.");
        const legacy = await runKnowledgeParser({ filePath: legacyPath, outputDir, resource });
        const inputs = ["local", "upload"].map((kind) => ({
          filePath: join(root, `${kind}.md`),
          outputDir,
          resource,
          sourceKey: JSON.stringify([kind, resource]),
        }));
        for (const input of inputs) {
          await Deno.writeTextFile(input.filePath, `# Shared\n\nBody ${input.sourceKey}`);
        }
        if (!shared) {
          let reads = 0;
          const gate = Promise.withResolvers<void>();
          Deno.readTextFile = async (path, options) => {
            const content = await read(path, options);
            if (String(path) === legacy.sandbox_output_path) {
              if (++reads === 2) gate.resolve();
              await gate.promise;
            }
            return content;
          };
        }
        const allocationSession = shared ? new KnowledgeAllocationSession() : undefined;
        const results = await Promise.all(
          inputs.map((input) => runKnowledgeParser(input, { allocationSession })),
        );
        assertEquals(
          new Set(results.map(({ sandbox_output_path }) => sandbox_output_path)).size,
          2,
        );
        for (const [index, result] of results.entries()) {
          const input = inputs[index];
          assert(input);
          const content = await read(result.sandbox_output_path);
          assert(content.includes(`Body ${input.sourceKey}`));
          assertEquals(
            readKnowledgeIngestSourceKey(inspectOkfDocument("shared.md", content).metadata),
            input.sourceKey,
          );
        }
      } finally {
        Deno.readTextFile = read;
        await Deno.remove(root, { recursive: true });
      }
    });
  }

  it("releases its own mutex after cancellation without changing the legacy output", async () => {
    const root = await makeTempDir({ prefix: "knowledge-mutex-cancel-" });
    const link = Deno.link;
    try {
      const filePath = join(root, "input.md");
      const outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nLegacy.");
      const first = await runKnowledgeParser({ filePath, outputDir, resource: "same" });
      const before = await Deno.readTextFile(first.sandbox_output_path);
      const controller = new AbortController();
      let acquired = false;
      Deno.link = async (oldPath, newPath) => {
        await link(oldPath, newPath);
        acquired = true;
        controller.abort();
      };
      const allocationSession = new KnowledgeAllocationSession();
      const parse = (signal?: AbortSignal) =>
        runKnowledgeParser(
          { filePath, outputDir, resource: "same", sourceKey: '["upload","same"]' },
          { allocationSession, signal },
        );
      await assertRejects(() => parse(controller.signal));
      assert(acquired);
      assertEquals(await Deno.readTextFile(first.sandbox_output_path), before);
      Deno.link = link;
      assertEquals((await parse()).slug, "shared");
    } finally {
      Deno.link = link;
      await Deno.remove(root, { recursive: true });
    }
  });

  for (const keyed of [false, true]) {
    it(`preserves an abandoned mutex for ${keyed ? "a known typed owner" : "a legacy owner"}`, async () => {
      const root = await makeTempDir({ prefix: "knowledge-abandoned-mutex-" });
      try {
        const filePath = join(root, "input.md");
        const outputDir = join(root, "output");
        await Deno.writeTextFile(filePath, "# Shared\n\nLegacy.");
        const input = {
          filePath,
          outputDir,
          resource: "same",
          ...(keyed ? { sourceKey: '["upload","same"]' } : {}),
        };
        const first = await runKnowledgeParser(input);
        const before = await Deno.readTextFile(first.sandbox_output_path);
        const lock = join(
          outputDir,
          ".veryfront",
          "knowledge-output-claims",
          "v1",
          `${await computeHash("shared")}.lock`,
        );
        const reservation = await computeHash(
          keyed ? JSON.stringify(["sourceKey", '["upload","same"]']) : "different-source",
        );
        await Deno.writeTextFile(lock, reservation);
        const parse = () => runKnowledgeParser({ ...input, sourceKey: '["upload","same"]' });
        if (keyed) {
          const error = await assertRejects(parse, Error, "busy or reserved");
          assert(!error.message.includes(root));
        } else assertEquals((await parse()).slug, "shared-2");
        assertEquals(await Deno.readTextFile(first.sandbox_output_path), before);
        assertEquals(await Deno.readTextFile(lock), reservation);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }

  for (
    const { existing, sourceKey } of [
      { existing: false, sourceKey: undefined },
      { existing: true, sourceKey: undefined },
      { existing: true, sourceKey: '["local","same"]' },
    ]
  ) {
    it(`protects ownership while ${existing ? "rewriting" : "creating"} a partial ${sourceKey ? "typed upgrade" : "keyless output"}`, async () => {
      const root = await makeTempDir({ prefix: "knowledge-partial-write-" });
      const write = Deno.writeTextFile;
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let pending: Promise<unknown> | undefined;
      try {
        const outputDir = join(root, "output");
        const filePath = join(root, "legacy.md");
        const resource = "same";
        await write(filePath, "# Shared\n\nOriginal.");
        if (existing) await runKnowledgeParser({ filePath, outputDir, resource });
        await write(filePath, "# Shared\n\nA_BODY_LEGACY_REFRESH");
        const other = join(root, "typed.md");
        await write(other, "# Shared\n\nB_TYPED_BODY");
        const target = join(outputDir, "shared.md");
        let intercepted = false;
        Deno.writeTextFile = async (path, data, options) => {
          if (
            String(path) === target && typeof data === "string" && data.includes("A_BODY") &&
            !intercepted
          ) {
            intercepted = true;
            await write(path, data.slice(0, data.indexOf("A_BODY") + 3), options);
            entered.resolve();
            await release.promise;
            await write(path, data, { ...options, createNew: false });
            return;
          }
          await write(path, data, options);
        };
        const parse = () => runKnowledgeParser({ filePath, outputDir, resource, sourceKey });
        pending = parse();
        await entered.promise;
        if (sourceKey) await assertRejects(parse, Error, "busy or reserved");
        const typed = await runKnowledgeParser({
          filePath: other,
          outputDir,
          resource,
          sourceKey: '["upload","same"]',
        });
        assertEquals(typed.slug, "shared-2");
        release.resolve();
        await pending;
        if (sourceKey) assertEquals((await parse()).slug, "shared");
        const legacy = await Deno.readTextFile(target);
        const current = await Deno.readTextFile(typed.sandbox_output_path);
        assert(legacy.includes("A_BODY_LEGACY_REFRESH"));
        assert(current.includes("B_TYPED_BODY"));
        assertEquals(
          readKnowledgeIngestSourceKey(inspectOkfDocument("shared.md", current).metadata),
          '["upload","same"]',
        );
        assertEquals(
          readKnowledgeIngestSourceKey(inspectOkfDocument("shared.md", legacy).metadata),
          sourceKey,
        );
      } finally {
        release.resolve();
        await pending?.catch(() => undefined);
        Deno.writeTextFile = write;
        await Deno.remove(root, { recursive: true });
      }
    });
  }

  it("coordinates legacy ownership across independent processes", async () => {
    const root = await makeTempDir({ prefix: "knowledge-process-claims-" });
    const children: Deno.ChildProcess[] = [];
    const outputs: Promise<Deno.CommandOutput>[] = [];
    const completed = new Map<number, Deno.CommandOutput>();
    console.log(`Ownership barrier parent Deno ${Deno.version.deno}`);
    try {
      const outputDir = join(root, "output");
      const resource = "uploads/article.md";
      const filePath = join(root, "legacy.md");
      await Deno.writeTextFile(filePath, "# Shared\n\nLegacy.");
      const legacy = await runKnowledgeParser({ filePath, outputDir, resource });
      const worker = join(root, "worker.ts");
      const parserUrl = new URL("../../../cli/commands/knowledge/parser.ts", import.meta.url).href;
      await Deno.writeTextFile(
        worker,
        `
import { runKnowledgeParser } from ${JSON.stringify(parserUrl)};
const [filePath,outputDir,resource,sourceKey,target,ready,release]=Deno.args;
console.error("Ownership barrier child Deno " + Deno.version.deno);
const read=Deno.readTextFile;
Deno.readTextFile=async(path,options)=>{
 const content=await read(path,options);
 if(String(path)===target){
  await Deno.writeTextFile(ready,"ready");
  for(;;){try{await Deno.stat(release);break;}catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}
   await new Promise(resolve=>setTimeout(resolve,10));}
 }
 return content;
};
console.log(JSON.stringify(await runKnowledgeParser({filePath,outputDir,resource,sourceKey})));
`,
      );
      const inputs = ["local", "upload"].map((kind) => ({
        filePath: join(root, `${kind}.md`),
        sourceKey: JSON.stringify([kind, resource]),
        ready: join(root, `${kind}.ready`),
      }));
      const release = join(root, "release");
      for (const input of inputs) {
        await Deno.writeTextFile(input.filePath, `# Shared\n\nBody ${input.sourceKey}`);
        const child = new Deno.Command(Deno.execPath(), {
          args: [
            "run",
            "--no-check",
            "--cached-only",
            "--deny-net",
            "--allow-read",
            "--allow-write",
            "--allow-env",
            "--config",
            fileURLToPath(new URL("../../../scripts/test.deno.json", import.meta.url)),
            worker,
            input.filePath,
            outputDir,
            resource,
            input.sourceKey,
            legacy.sandbox_output_path,
            input.ready,
            release,
          ],
          stdout: "piped",
          stderr: "piped",
        }).spawn();
        children.push(child);
        const childIndex = outputs.length;
        outputs.push(
          child.output().then((output) => {
            completed.set(childIndex, output);
            return output;
          }),
        );
      }
      const deadline = Date.now() + 30_000;
      for (const [inputIndex, input] of inputs.entries()) {
        for (;;) {
          const exited = completed.get(inputIndex);
          assert(
            !exited,
            `Child exited before ownership barrier: ${
              exited ? new TextDecoder().decode(exited.stderr) : ""
            }`,
          );
          try {
            await Deno.stat(input.ready);
            break;
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
          }
          assert(Date.now() < deadline, "Child did not reach ownership barrier");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      await Deno.writeTextFile(release, "release");
      const paths = [];
      for (const [index, output] of (await Promise.all(outputs)).entries()) {
        console.log(new TextDecoder().decode(output.stderr).trim());
        assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
        const result: unknown = JSON.parse(new TextDecoder().decode(output.stdout));
        assert(
          result && typeof result === "object" && "sandbox_output_path" in result &&
            typeof result.sandbox_output_path === "string",
        );
        paths.push(result.sandbox_output_path);
        const content = await Deno.readTextFile(result.sandbox_output_path);
        const input = inputs[index];
        assert(input);
        assert(content.includes(`Body ${input.sourceKey}`));
        assertEquals(
          readKnowledgeIngestSourceKey(inspectOkfDocument("shared.md", content).metadata),
          input.sourceKey,
        );
      }
      assertEquals(new Set(paths).size, 2);
    } finally {
      for (const child of children) {
        try {
          child.kill();
        } catch { /* Already exited. */ }
      }
      await Promise.allSettled(outputs);
      await Deno.remove(root, { recursive: true });
    }
  });

  it("upgrades a pre-key generated output in place during ingestion", async () => {
    const root = await makeTempDir({ prefix: "knowledge-legacy-upgrade-" });
    try {
      const filePath = join(root, "article.md");
      const outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      await runKnowledgeParser({ filePath, outputDir, resource: "uploads/article.md" });
      const result = await ingestResolvedSources(
        [createUploadSource("uploads/article.md", filePath)],
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
      assertEquals(result.ingested.map(({ slug }) => slug), ["shared"]);
      const metadata =
        inspectOkfDocument("shared.md", await Deno.readTextFile(join(outputDir, "shared.md")))
          .metadata;
      assertEquals(
        metadata.generated && typeof metadata.generated === "object" &&
          "source_key" in metadata.generated
          ? metadata.generated.source_key
          : undefined,
        '["upload","uploads/article.md"]',
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("finds cached legacy owners, upgrades the first duplicate, and respects authoritative scope keys", async () => {
    const root = await makeTempDir({ prefix: "knowledge-cached-legacy-" });
    try {
      const filePath = join(root, "article.md");
      const outputDir = join(root, "output");
      await Deno.writeTextFile(filePath, "# Shared\n\nBody.");
      const resource = "uploads/article.md";
      const first = await runKnowledgeParser({ filePath, outputDir, resource });
      await Deno.copyFile(first.sandbox_output_path, join(outputDir, "shared-2.md"));
      const allocationSession = new KnowledgeAllocationSession();
      const parse = (resource: string, sourceKey?: string) =>
        runKnowledgeParser(
          { filePath, outputDir, resource, sourceKey },
          { allocationSession },
        );
      assertEquals((await parse("other", '["upload","other"]')).slug, "shared-3");
      assertEquals((await parse(resource, '["upload","uploads/article.md"]')).slug, "shared");
      assertEquals((await parse(resource, '["upload","uploads/article.md"]')).slug, "shared");
      // An explicit conflicting key cannot use the upgraded upload document.
      assertEquals((await parse(resource, '["local","uploads/article.md"]')).slug, "shared-2");
      assertEquals((await parse(resource, '["upload","uploads/article.md"]')).slug, "shared");
      // Keyless standalone calls also must not overwrite either keyed document.
      assertEquals((await parse(resource)).slug, "shared-4");
      await runKnowledgeParser({
        filePath,
        outputDir,
        resource,
        slug: "shared",
        sourceKey: '["staged-upload","uploads/article.md"]',
      });
      const retagged = await Deno.readTextFile(first.sandbox_output_path);
      assertEquals((await parse(resource, '["upload","uploads/article.md"]')).slug, "shared-4");
      assertEquals(await Deno.readTextFile(first.sandbox_output_path), retagged);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

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
      await parse("a");
      const results = await Promise.all([parse("a"), parse("b"), parse("a")]);
      assertEquals(results.map(({ slug }) => slug), ["shared", "shared-2", "shared"]);
      const original = await Deno.readTextFile(join(outputDir, "shared.md"));
      const retagged = original.replace('resource: "a"', 'resource: "other"');
      assert(retagged !== original);
      await Deno.writeTextFile(join(outputDir, "shared.md"), retagged);
      assertEquals((await parse("a")).slug, "shared-3");
      assertEquals(await Deno.readTextFile(join(outputDir, "shared.md")), retagged);
      const controller = new AbortController();
      const link = Deno.link;
      let cancelledDuringAllocation = false;
      const targetClaim = `${await computeHash("shared-4")}.lock`;
      Deno.link = async (oldPath, newPath) => {
        await link(oldPath, newPath);
        if (String(newPath).endsWith(targetClaim)) {
          cancelledDuringAllocation = true;
          controller.abort();
        }
      };
      try {
        await assertRejects(() => parse("c", controller.signal));
      } finally {
        Deno.link = link;
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
