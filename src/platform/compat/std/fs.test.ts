import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove, writeTextFile } from "../fs.ts";
import { basename, fromFileUrl, join, relative, toFileUrl } from "../path/index.ts";
import { ensureDir, exists, existsSync, walk, type WalkOptions } from "./fs.ts";

describe("platform/compat/std/fs", () => {
  let root = "";
  let filePath = "";
  let nestedDirectory = "";
  let nestedFile = "";

  beforeAll(async () => {
    root = await makeTempDir({ prefix: "veryfront-std-fs-" });
    filePath = join(root, "root.txt");
    nestedDirectory = join(root, "nested");
    nestedFile = join(nestedDirectory, "nested.ts");

    await ensureDir(nestedDirectory);
    await writeTextFile(filePath, "root");
    await writeTextFile(join(root, "root.js"), "javascript");
    await writeTextFile(nestedFile, "nested");
  });

  afterAll(async () => {
    await remove(root, { recursive: true });
  });

  it("ensures directories but rejects an existing file path", async () => {
    const directory = join(root, "new", "deep");
    await ensureDir(directory);

    assertEquals(await exists(directory, { isDirectory: true }), true);
    await assertRejects(
      () => ensureDir(filePath),
      Error,
      "expected 'dir', got 'file'",
    );
  });

  it("classifies files and directories without hiding invalid options", async () => {
    assertEquals(await exists(filePath), true);
    assertEquals(await exists(filePath, { isFile: true }), true);
    assertEquals(await exists(filePath, { isDirectory: true }), false);
    assertEquals(await exists(nestedDirectory, { isDirectory: true }), true);
    assertEquals(await exists(join(root, "missing")), false);
    assertEquals(existsSync(toFileUrl(filePath), { isFile: true }), true);

    await assertRejects(
      () => exists(filePath, { isDirectory: true, isFile: true }),
      TypeError,
    );
  });

  it("honors readable checks without hiding the path itself", async () => {
    if (Deno.build.os === "windows") return;

    await Deno.chmod(filePath, 0o000);
    try {
      assertEquals(await exists(filePath), true);
      assertEquals(await exists(filePath, { isReadable: true }), false);
      assertEquals(existsSync(filePath, { isReadable: true }), false);
    } finally {
      await Deno.chmod(filePath, 0o600);
    }
  });

  it("fails closed when the runtime has not granted read permission", async () => {
    const moduleUrl = new URL("./fs.ts", import.meta.url).href;
    const configPath = fromFileUrl(new URL("../../../../deno.json", import.meta.url));
    const source = `
      import { exists, existsSync } from ${JSON.stringify(moduleUrl)};
      let asyncRejected = false;
      let syncRejected = false;
      try { await exists("deno.json"); } catch { asyncRejected = true; }
      try { existsSync("deno.json"); } catch { syncRejected = true; }
      if (!asyncRejected || !syncRejected) {
        throw new Error(\`Denied read permission was hidden: \${asyncRejected}/\${syncRejected}\`);
      }
    `;
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--cached-only",
        "--no-prompt",
        "--deny-read",
        "--config",
        configPath,
        "-",
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(source));
    await writer.close();
    const output = await child.output();

    assertEquals(
      output.success,
      true,
      new TextDecoder().decode(output.stderr),
    );
  });

  it("includes the walk root and applies maxDepth from that root", async () => {
    const rootOnly = await Array.fromAsync(walk(root, { maxDepth: 0 }));
    assertEquals(rootOnly.map((entry) => entry.path), [root]);

    const oneLevel = await Array.fromAsync(walk(root, { maxDepth: 1 }));
    assertEquals(oneLevel.some((entry) => entry.path === nestedFile), false);
    assertEquals(oneLevel.some((entry) => entry.path === nestedDirectory), true);
    assertEquals(oneLevel.some((entry) => entry.path === filePath), true);

    const fractionalDepth = await Array.fromAsync(walk(root, { maxDepth: 1.5 }));
    assertEquals(fractionalDepth.some((entry) => entry.path === nestedFile), false);

    const relativeRoot = relative(Deno.cwd(), root);
    const normalizedRoot = await Array.fromAsync(
      walk(`./${relativeRoot}`, { maxDepth: 0 }),
    );
    assertEquals(normalizedRoot.map((entry) => entry.path), [relativeRoot]);
  });

  it("walks every directory in stable lexical order", async () => {
    const entries = await Array.fromAsync(walk(root, { maxDepth: 1 }));
    assertEquals(entries[0]?.name, basename(root));
    const childNames = entries.slice(1).map((entry) => entry.name);
    assertEquals(childNames, [...childNames].sort());
  });

  it("preserves POSIX filenames containing a literal backslash", async () => {
    if (Deno.build.os === "windows") return;

    const backslashPath = `${root}/literal\\name.css`;
    const backslashRoot = `${root}/literal\\directory`;
    await Deno.writeTextFile(backslashPath, "body {}");
    try {
      const entries = await Array.fromAsync(
        walk(root, { includeDirs: false, exts: ["css"] }),
      );
      assertEquals(entries.map((entry) => entry.path), [backslashPath]);
      assertEquals(entries[0]?.name, "literal\\name.css");

      await Deno.mkdir(backslashRoot);
      await Deno.writeTextFile(`${backslashRoot}/nested.css`, "main {}");
      const urlEntries = await Array.fromAsync(walk(toFileUrl(backslashRoot)));
      assertEquals(urlEntries.map((entry) => entry.path), [
        backslashRoot,
        `${backslashRoot}/nested.css`,
      ]);
    } finally {
      await Deno.remove(backslashPath);
      await Deno.remove(backslashRoot, { recursive: true }).catch(() => undefined);
    }
  });

  it("normalizes extension filters and does not prune unmatched directories", async () => {
    const byExtension = await Array.fromAsync(
      walk(root, {
        exts: ["ts"],
        includeDirs: false,
      }),
    );
    assertEquals(byExtension.map((entry) => entry.path), [nestedFile]);

    const byMatch = await Array.fromAsync(
      walk(root, {
        includeDirs: false,
        match: [/nested\.ts$/],
      }),
    );
    assertEquals(byMatch.map((entry) => entry.path), [nestedFile]);
  });

  it("accepts file URLs and propagates a missing walk root", async () => {
    const entries = await Array.fromAsync(
      walk(toFileUrl(root), { maxDepth: 0 }),
    );
    assertEquals(entries.map((entry) => entry.path), [root]);

    const annotatedUrl = toFileUrl(root);
    annotatedUrl.search = "?ignored=1";
    annotatedUrl.hash = "#ignored";
    const annotatedEntries = await Array.fromAsync(
      walk(annotatedUrl, { maxDepth: 0 }),
    );
    assertEquals(annotatedEntries.map((entry) => entry.path), [root]);

    await assertRejects(() => Array.fromAsync(walk(join(root, "missing-directory"))));
    assertEquals(
      await Array.fromAsync(
        walk(join(root, "missing-directory"), {
          includeDirs: false,
          maxDepth: 0,
        }),
      ),
      [],
    );
  });

  it("rejects non-file URLs and encoded path separators", async () => {
    assertThrows(
      () => existsSync(new URL("file:///tmp/a%2fb")),
      TypeError,
      "File URL path must not contain encoded path separators",
      "a percent-encoded separator must not decode into a real one",
    );
    await assertRejects(
      () => Array.fromAsync(walk(new URL("https://example.com/tmp"))),
      TypeError,
      "Expected a file URL",
      "only file: URLs are accepted as paths",
    );
  });

  it("does not follow links by default and terminates followed link cycles", async () => {
    const alias = join(root, "alias");
    const loop = join(nestedDirectory, "loop");
    await Deno.symlink(nestedDirectory, alias, { type: "dir" });
    await Deno.symlink(root, loop, { type: "dir" });

    try {
      const withoutFollowing = await Array.fromAsync(
        walk(root, { includeDirs: false, followSymlinks: false }),
      );
      const aliasEntry = withoutFollowing.find((entry) => entry.path === alias);
      assertEquals(aliasEntry?.isSymlink, true);
      assertEquals(
        withoutFollowing.some((entry) => entry.path.startsWith(`${alias}/`)),
        false,
      );

      const followed = await Array.fromAsync(
        walk(root, { followSymlinks: true, canonicalize: false }),
      );
      assertEquals(followed.length < 20, true);
      assertEquals(followed.some((entry) => entry.isSymlink), true);
      assertEquals(followed.some((entry) => entry.name === "nested.ts"), true);
    } finally {
      await Deno.remove(alias);
      await Deno.remove(loop);
    }
  });

  it("requires explicit opt-in before following a symbolic-link root", async () => {
    const linkedRoot = join(root, "linked-root");
    await Deno.symlink(nestedDirectory, linkedRoot, { type: "dir" });

    try {
      await assertRejects(
        () => Array.fromAsync(walk(linkedRoot)),
        TypeError,
        "Walk root is a symbolic link",
      );

      const followed = await Array.fromAsync(
        walk(linkedRoot, { followSymlinks: true, maxDepth: 0 }),
      );
      assertEquals(followed.length, 1);
      assertEquals(followed[0]?.isDirectory, true);
      assertEquals(followed[0]?.isSymlink, true);
      assertEquals(followed[0]?.path, await Deno.realPath(nestedDirectory));
    } finally {
      await Deno.remove(linkedRoot);
    }
  });

  it("applies skip patterns to canonical symbolic-link targets", async () => {
    const external = await Deno.makeTempDir({ prefix: "veryfront-std-fs-skip-" });
    const linkedTarget = join(root, "linked-target");
    await Deno.writeTextFile(join(external, "must-not-appear.txt"), "outside");
    await Deno.symlink(external, linkedTarget, { type: "dir" });

    try {
      const entries = await Array.fromAsync(
        walk(root, {
          followSymlinks: true,
          canonicalize: false,
          skip: [/veryfront-std-fs-skip-/],
        }),
      );
      assertEquals(entries.some((entry) => entry.name === "must-not-appear.txt"), false);
      assertEquals(entries.some((entry) => entry.path === linkedTarget), false);
    } finally {
      await Deno.remove(linkedTarget);
      await Deno.remove(external, { recursive: true });
    }
  });

  it("preserves caller-owned regular expression state", async () => {
    const pattern = /nested/g;
    pattern.lastIndex = 2;

    const entries = await Array.fromAsync(
      walk(root, { includeDirs: false, match: [pattern] }),
    );

    assertEquals(entries.map((entry) => entry.path), [nestedFile]);
    assertEquals(pattern.lastIndex, 2);
  });

  it("rejects NaN depth before reading the walk root", async () => {
    await assertRejects(
      () => Array.fromAsync(walk(join(root, "missing-directory"), { maxDepth: Number.NaN })),
      RangeError,
      "maxDepth",
    );
  });

  it("rejects malformed runtime options before touching the filesystem", async () => {
    const invalidOptions: unknown[] = [
      null,
      { maxDepth: "1" },
      { includeFiles: 1 },
      { exts: ["ts", 1] },
      { match: ["nested"] },
      { skip: /nested/ },
    ];

    for (const options of invalidOptions) {
      await assertRejects(
        () =>
          Array.fromAsync(
            walk(join(root, "missing-directory"), options as WalkOptions),
          ),
        TypeError,
      );
    }
  });
});
