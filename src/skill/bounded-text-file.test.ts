import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  makeTempDir,
  mkdir,
  remove,
  symlink,
  writeFile,
  writeTextFile,
} from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import type { BoundedFileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { DenoFileSystemAdapter } from "#veryfront/platform/adapters/runtime/deno/filesystem-adapter.ts";
import { createSkillTestAdapter } from "./testing.ts";
import { readBoundedSkillTextFile, readValidatedSkillTextFile } from "./bounded-text-file.ts";

Deno.test("readBoundedSkillTextFile reads bounded local and adapter text", async () => {
  const tempDir = await makeTempDir({ prefix: "vf-skill-bounded-read-" });
  try {
    const localPath = join(tempDir, "SKILL.md");
    await writeTextFile(localPath, "hello");
    assertEquals(await readBoundedSkillTextFile(localPath), "hello");

    const adapterPath = "/project/skills/writer/SKILL.md";
    const adapter = createSkillTestAdapter({ [adapterPath]: "adapter" });
    assertEquals(
      await readBoundedSkillTextFile(adapterPath, adapter),
      "adapter",
    );
  } finally {
    await remove(tempDir, { recursive: true });
  }
});

Deno.test("readBoundedSkillTextFile rejects oversized and malformed UTF-8 files", async () => {
  const tempDir = await makeTempDir({ prefix: "vf-skill-bounded-read-" });
  try {
    const oversizedPath = join(tempDir, "oversized.md");
    await writeTextFile(oversizedPath, "12345");
    await assertRejects(
      () => readBoundedSkillTextFile(oversizedPath, undefined, 4),
      RangeError,
      "exceeds 4 bytes",
    );

    const invalidPath = join(tempDir, "invalid.md");
    await writeFile(invalidPath, new Uint8Array([0xc3, 0x28]));
    await assertRejects(
      () => readBoundedSkillTextFile(invalidPath),
      TypeError,
      "valid UTF-8",
    );
  } finally {
    await remove(tempDir, { recursive: true });
  }
});

Deno.test("readBoundedSkillTextFile rejects terminal symlinks and malformed adapter text", async () => {
  const tempDir = await makeTempDir({ prefix: "vf-skill-bounded-read-" });
  try {
    const targetPath = join(tempDir, "target.md");
    const linkedPath = join(tempDir, "linked.md");
    await writeTextFile(targetPath, "target");
    let symlinkCreated = true;
    try {
      await symlink(targetPath, linkedPath);
    } catch {
      symlinkCreated = false;
      // Some CI environments deny symlink creation.
      console.warn("[SKIP] symlink test: OS denied symlink creation");
    }
    if (symlinkCreated) {
      await assertRejects(
        () => readBoundedSkillTextFile(linkedPath),
        TypeError,
        "symlink",
      );
    }

    const adapterPath = "/project/skills/writer/SKILL.md";
    const adapter = createSkillTestAdapter({ [adapterPath]: "valid" });
    await assertRejects(
      () =>
        readBoundedSkillTextFile(adapterPath, {
          ...adapter,
          readFileBytes: undefined,
          async readFile() {
            return "\ud800";
          },
        }),
      TypeError,
      "valid Unicode",
    );
  } finally {
    await remove(tempDir, { recursive: true });
  }
});

Deno.test("readValidatedSkillTextFile rejects a parent replacement between validation and open", async () => {
  const tempDir = await makeTempDir({ prefix: "vf-skill-validated-read-" });
  const skillRoot = join(tempDir, "skill");
  const referencesDir = join(skillRoot, "references");
  const savedReferencesDir = join(skillRoot, "references-safe");
  const replacementDir = join(tempDir, "replacement");
  const requestedPath = "references/guide.md";
  const filePath = join(referencesDir, "guide.md");
  const originalOpen = Deno.open;
  let replaced = false;

  try {
    await mkdir(referencesDir, { recursive: true });
    await mkdir(replacementDir, { recursive: true });
    await writeTextFile(filePath, "trusted");
    await writeTextFile(join(replacementDir, "guide.md"), "outside");

    Deno.open = async (path, options) => {
      if (!replaced && String(path) === filePath) {
        replaced = true;
        await Deno.rename(referencesDir, savedReferencesDir);
        await Deno.rename(replacementDir, referencesDir);
      }
      return await originalOpen(path, options);
    };

    await assertRejects(
      () =>
        readValidatedSkillTextFile(
          skillRoot,
          requestedPath,
          ["references"],
        ),
      TypeError,
      "changed during validation",
    );
    assertEquals(replaced, true);
  } finally {
    Deno.open = originalOpen;
    if (replaced) {
      await Deno.rename(referencesDir, replacementDir);
      await Deno.rename(savedReferencesDir, referencesDir);
    }
    await remove(tempDir, { recursive: true });
  }
});

Deno.test("readValidatedSkillTextFile tolerates null file identifiers and rejects a differing swap-back", async () => {
  const tempDir = await makeTempDir({ prefix: "vf-skill-null-identity-" });
  const skillRoot = join(tempDir, "skill");
  const referencesDir = join(skillRoot, "references");
  const savedReferencesDir = join(skillRoot, "references-safe");
  const replacementDir = join(tempDir, "replacement");
  const filePath = join(referencesDir, "guide.md");
  const originalLstat = Deno.lstat;
  const originalOpen = Deno.open;
  let replaced = false;
  let restored = false;

  const withoutIdentity = (info: Deno.FileInfo): Deno.FileInfo =>
    ({
      ...info,
      dev: null,
      ino: null,
    }) as unknown as Deno.FileInfo;
  const wrapWithoutIdentity = (file: Deno.FsFile): Deno.FsFile =>
    ({
      close: () => file.close(),
      read: (buffer: Uint8Array) => file.read(buffer),
      stat: async () => withoutIdentity(await file.stat()),
    }) as unknown as Deno.FsFile;

  try {
    await mkdir(referencesDir, { recursive: true });
    await mkdir(replacementDir, { recursive: true });
    await writeTextFile(filePath, "trusted");
    await writeTextFile(join(replacementDir, "guide.md"), "outside");

    Deno.lstat = async (path) => withoutIdentity(await originalLstat(path));
    Deno.open = async (path, options) => {
      if (!replaced && String(path) === filePath) {
        replaced = true;
        await Deno.rename(referencesDir, savedReferencesDir);
        await Deno.rename(replacementDir, referencesDir);
        const file = await originalOpen(path, options);
        await Deno.rename(referencesDir, replacementDir);
        await Deno.rename(savedReferencesDir, referencesDir);
        restored = true;
        return wrapWithoutIdentity(file);
      }
      return wrapWithoutIdentity(await originalOpen(path, options));
    };

    await assertRejects(
      () =>
        readValidatedSkillTextFile(
          skillRoot,
          "references/guide.md",
          ["references"],
        ),
      TypeError,
      "changed during validation",
    );
    assertEquals(replaced, true);
    assertEquals(restored, true);
  } finally {
    Deno.lstat = originalLstat;
    Deno.open = originalOpen;
    if (replaced && !restored) {
      await Deno.rename(referencesDir, replacementDir);
      await Deno.rename(savedReferencesDir, referencesDir);
    }
    await remove(tempDir, { recursive: true });
  }
});

Deno.test("readBoundedSkillTextFile supports filesystems without device or inode metadata", async () => {
  const tempDir = await makeTempDir({ prefix: "vf-skill-null-identity-" });
  const path = join(tempDir, "SKILL.md");
  const originalLstat = Deno.lstat;
  const originalOpen = Deno.open;
  const withoutIdentity = (info: Deno.FileInfo): Deno.FileInfo =>
    ({
      ...info,
      dev: null,
      ino: null,
    }) as unknown as Deno.FileInfo;

  try {
    await writeTextFile(path, "portable");
    Deno.lstat = async (requestedPath) => withoutIdentity(await originalLstat(requestedPath));
    Deno.open = async (requestedPath, options) => {
      const file = await originalOpen(requestedPath, options);
      return {
        close: () => file.close(),
        read: (buffer: Uint8Array) => file.read(buffer),
        stat: async () => withoutIdentity(await file.stat()),
      } as unknown as Deno.FsFile;
    };

    assertEquals(await readBoundedSkillTextFile(path), "portable");
  } finally {
    Deno.lstat = originalLstat;
    Deno.open = originalOpen;
    await remove(tempDir, { recursive: true });
  }
});

Deno.test("readBoundedSkillTextFile prefers the adapter's bounded byte capability", async () => {
  const path = "/project/skills/writer/SKILL.md";
  const adapter = createSkillTestAdapter({ [path]: "safe" });
  let requestedLimit: number | undefined;
  let legacyReadCalled = false;
  const boundedAdapter: BoundedFileSystemAdapter = {
    ...adapter,
    async readFile() {
      legacyReadCalled = true;
      throw new Error("legacy read must not be used");
    },
    async readFileBytesBounded(requestedPath: string, byteLimit: number) {
      assertEquals(requestedPath, path);
      requestedLimit = byteLimit;
      return new TextEncoder().encode("safe");
    },
  };

  const content = await readBoundedSkillTextFile(
    path,
    boundedAdapter,
    4,
  );

  assertEquals(content, "safe");
  assertEquals(requestedLimit, 5);
  assertEquals(legacyReadCalled, false);
});

Deno.test("readBoundedSkillTextFile rejects an oversized bounded adapter prefix", async () => {
  const path = "/project/skills/writer/SKILL.md";
  const adapter = createSkillTestAdapter({ [path]: "safe" });
  const boundedAdapter: BoundedFileSystemAdapter = {
    ...adapter,
    async readFileBytesBounded(_requestedPath: string, byteLimit: number) {
      return new Uint8Array(byteLimit);
    },
  };

  await assertRejects(
    () =>
      readBoundedSkillTextFile(
        path,
        boundedAdapter,
        4,
      ),
    RangeError,
    "exceeds 4 bytes",
  );
});

Deno.test("readBoundedSkillTextFile binds direct built-in adapters before repeated swap-backs", async () => {
  const tempDir = await makeTempDir({ prefix: "vf-skill-adapter-swap-" });
  const path = join(tempDir, "SKILL.md");
  const safePath = join(tempDir, "SKILL.safe.md");
  const replacementPath = join(tempDir, "SKILL.replacement.md");
  const originalOpen = Deno.open;
  let swaps = 0;
  let swapPending = false;

  try {
    await writeTextFile(path, "trusted");
    await writeTextFile(replacementPath, "outside");

    Deno.open = async (requestedPath, options) => {
      if (String(requestedPath) === path) {
        swaps++;
        swapPending = true;
        await Deno.rename(path, safePath);
        await Deno.rename(replacementPath, path);
        const file = await originalOpen(requestedPath, options);
        await Deno.rename(path, replacementPath);
        await Deno.rename(safePath, path);
        swapPending = false;
        return file;
      }
      return await originalOpen(requestedPath, options);
    };

    await assertRejects(
      () =>
        readBoundedSkillTextFile(
          path,
          new DenoFileSystemAdapter(),
        ),
      TypeError,
      "changed during reading",
    );
    assertEquals(swaps, 1);
    assertEquals(swapPending, false);
  } finally {
    Deno.open = originalOpen;
    if (swapPending) {
      await Deno.rename(path, replacementPath);
      await Deno.rename(safePath, path);
    }
    await remove(tempDir, { recursive: true });
  }
});

Deno.test("readBoundedSkillTextFile preserves overridden namespaces on built-in subclasses", async () => {
  class VirtualDenoAdapter extends DenoFileSystemAdapter {
    boundedReads = 0;

    override readFile(_path: string): Promise<string> {
      return Promise.resolve("virtual");
    }

    override readFileBytes(_path: string): Promise<Uint8Array> {
      return Promise.resolve(new TextEncoder().encode("virtual"));
    }

    override readFileBytesBounded(
      _path: string,
      _byteLimit: number,
    ): Promise<Uint8Array> {
      this.boundedReads++;
      return Promise.resolve(new TextEncoder().encode("virtual"));
    }

    override stat(_path: string) {
      return Promise.resolve({
        size: 7,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        mtime: null,
      });
    }

    override lstat(path: string) {
      return this.stat(path);
    }
  }

  const adapter = new VirtualDenoAdapter();
  assertEquals(
    await readBoundedSkillTextFile("/virtual/SKILL.md", adapter, 10),
    "virtual",
  );
  assertEquals(adapter.boundedReads, 2);
});
