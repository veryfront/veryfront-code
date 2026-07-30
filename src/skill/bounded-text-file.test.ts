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
import { createSkillOperationBudget } from "./operation-budget.ts";

async function settlesWithin<T>(promise: Promise<T>, timeoutMs = 50): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

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

Deno.test("readBoundedSkillTextFile uses the captured UTF-8 decoder primitive", async () => {
  const path = "/project/skills/writer/SKILL.md";
  const adapter = createSkillTestAdapter({ [path]: "trusted" });
  const originalDecode = Object.getOwnPropertyDescriptor(
    TextDecoder.prototype,
    "decode",
  );
  let poisonedDecodeCalls = 0;
  Object.defineProperty(TextDecoder.prototype, "decode", {
    configurable: true,
    value() {
      poisonedDecodeCalls += 1;
      return "attacker-controlled";
    },
    writable: true,
  });

  try {
    assertEquals(await readBoundedSkillTextFile(path, adapter), "trusted");
    assertEquals(poisonedDecodeCalls, 0);
  } finally {
    if (originalDecode) {
      Object.defineProperty(TextDecoder.prototype, "decode", originalDecode);
    }
  }
});

Deno.test("readBoundedSkillTextFile uses captured string primitives for legacy adapter byte limits", async () => {
  const path = "/project/skills/writer/SKILL.md";
  const adapter = createSkillTestAdapter({ [path]: "é" });
  const reported = { ...await adapter.stat(path), size: 1 };
  const originalCharCodeAt = Object.getOwnPropertyDescriptor(
    String.prototype,
    "charCodeAt",
  );
  let poisonedCharCodeCalls = 0;
  Object.defineProperty(String.prototype, "charCodeAt", {
    configurable: true,
    value() {
      poisonedCharCodeCalls += 1;
      return 0;
    },
    writable: true,
  });

  try {
    await assertRejects(
      () =>
        readBoundedSkillTextFile(
          path,
          {
            ...adapter,
            readFileBytesBounded: undefined,
            readFileBytes: undefined,
            async readFile() {
              return "é";
            },
            async stat() {
              return reported;
            },
            async lstat() {
              return reported;
            },
          },
          1,
        ),
      RangeError,
      "exceeds 1 bytes",
    );
    assertEquals(poisonedCharCodeCalls, 0);
  } finally {
    if (originalCharCodeAt) {
      Object.defineProperty(String.prototype, "charCodeAt", originalCharCodeAt);
    }
  }
});

Deno.test("readBoundedSkillTextFile uses the captured safe-integer validator", async () => {
  const path = "/project/skills/writer/SKILL.md";
  const adapter = createSkillTestAdapter({ [path]: "x" });
  const originalIsSafeInteger = Object.getOwnPropertyDescriptor(
    Number,
    "isSafeInteger",
  );
  let poisonedValidatorCalls = 0;
  Object.defineProperty(Number, "isSafeInteger", {
    configurable: true,
    value() {
      poisonedValidatorCalls += 1;
      return true;
    },
    writable: true,
  });

  try {
    await assertRejects(
      () => readBoundedSkillTextFile(path, adapter, 1.5),
      RangeError,
      "positive safe integer",
    );
    assertEquals(poisonedValidatorCalls, 0);
  } finally {
    if (originalIsSafeInteger) {
      Object.defineProperty(Number, "isSafeInteger", originalIsSafeInteger);
    }
  }
});

Deno.test("readBoundedSkillTextFile does not consult Uint8Array hasInstance hooks", async () => {
  const path = "/project/skills/writer/SKILL.md";
  const adapter = createSkillTestAdapter({ [path]: "trusted" });
  const originalHasInstance = Object.getOwnPropertyDescriptor(
    Uint8Array,
    Symbol.hasInstance,
  );
  let hasInstanceCalls = 0;
  Object.defineProperty(Uint8Array, Symbol.hasInstance, {
    configurable: true,
    value() {
      hasInstanceCalls += 1;
      throw new Error("Uint8Array hasInstance hook must not run");
    },
  });

  try {
    assertEquals(await readBoundedSkillTextFile(path, adapter), "trusted");
    assertEquals(hasInstanceCalls, 0);
  } finally {
    if (originalHasInstance) {
      Object.defineProperty(Uint8Array, Symbol.hasInstance, originalHasInstance);
    } else {
      Reflect.deleteProperty(Uint8Array, Symbol.hasInstance);
    }
  }
});

Deno.test("readBoundedSkillTextFile measures adapter bytes through intrinsic slots", async () => {
  const path = "/project/skills/writer/SKILL.md";
  const bytes = new TextEncoder().encode("outside");
  let byteLengthHookCalls = 0;
  Object.defineProperty(bytes, "byteLength", {
    configurable: true,
    get() {
      byteLengthHookCalls += 1;
      return 1;
    },
  });
  const adapter: BoundedFileSystemAdapter = {
    ...createSkillTestAdapter({ [path]: "x" }),
    async readFileBytesBounded() {
      return bytes;
    },
  };

  await assertRejects(
    () => readBoundedSkillTextFile(path, adapter, 1),
    RangeError,
    "exceeds 1 bytes",
  );
  assertEquals(byteLengthHookCalls, 0);
});

Deno.test("readBoundedSkillTextFile uses captured Uint8Array allocation primitives", async () => {
  const tempDir = await makeTempDir({ prefix: "vf-skill-uint8-intrinsics-" });
  const path = join(tempDir, "SKILL.md");
  const originalConstructor = Object.getOwnPropertyDescriptor(
    globalThis,
    "Uint8Array",
  );
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  const originalByteLength = Object.getOwnPropertyDescriptor(
    typedArrayPrototype,
    "byteLength",
  );
  const originalSubarray = Object.getOwnPropertyDescriptor(
    typedArrayPrototype,
    "subarray",
  );
  let poisonedPrimitiveCalls = 0;

  try {
    await writeTextFile(path, "trusted");
    Object.defineProperty(globalThis, "Uint8Array", {
      configurable: true,
      value: class PoisonedUint8Array {
        constructor() {
          poisonedPrimitiveCalls += 1;
          throw new Error("mutated Uint8Array constructor must not run");
        }
      },
      writable: true,
    });
    Object.defineProperty(typedArrayPrototype, "byteLength", {
      configurable: true,
      get() {
        poisonedPrimitiveCalls += 1;
        throw new Error("mutated byteLength getter must not run");
      },
    });
    Object.defineProperty(typedArrayPrototype, "subarray", {
      configurable: true,
      value() {
        poisonedPrimitiveCalls += 1;
        throw new Error("mutated subarray method must not run");
      },
      writable: true,
    });

    assertEquals(await readBoundedSkillTextFile(path), "trusted");
    assertEquals(poisonedPrimitiveCalls, 0);
  } finally {
    if (originalConstructor) {
      Object.defineProperty(globalThis, "Uint8Array", originalConstructor);
    }
    if (originalByteLength) {
      Object.defineProperty(typedArrayPrototype, "byteLength", originalByteLength);
    }
    if (originalSubarray) {
      Object.defineProperty(typedArrayPrototype, "subarray", originalSubarray);
    }
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
          readFileBytesBounded: undefined,
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

Deno.test("readValidatedSkillTextFile requires a genuinely bounded adapter read", async () => {
  const root = "/project/skills/writer";
  const path = `${root}/SKILL.md`;
  const boundedAdapter = createSkillTestAdapter({ [path]: "safe" });
  const adapter = { ...boundedAdapter, readFileBytesBounded: undefined };

  await assertRejects(
    () => readValidatedSkillTextFile(root, "SKILL.md", [], adapter),
    TypeError,
    "bounded",
  );
});

Deno.test("readValidatedSkillTextFile redacts the absolute skill root from diagnostics", async () => {
  const root = "/private/workspaces/customer/skills/writer";
  const adapter = {
    ...createSkillTestAdapter({}),
    async exists() {
      throw new Error(`Storage failed below ${root}/references`);
    },
  };

  try {
    await readValidatedSkillTextFile(
      root,
      "references/guide.md",
      ["references"],
      adapter,
    );
    throw new Error("Expected the read to fail");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertEquals(message.includes(root), false);
    assertEquals(message.includes("<skill-root>"), true);
    assertEquals(error instanceof Error ? error.cause : undefined, undefined);
  }
});

Deno.test("readValidatedSkillTextFile detaches root-bearing nested diagnostics", async () => {
  const root = "/private/workspaces/customer/skills/writer";
  const original = new Error("Storage failed", {
    cause: new Error(`Private source: ${root}/SKILL.md`),
  });
  const adapter = {
    ...createSkillTestAdapter({}),
    async exists() {
      throw original;
    },
  };

  let failure: unknown;
  try {
    await readValidatedSkillTextFile(root, "SKILL.md", [], adapter);
  } catch (error) {
    failure = error;
  }

  assertEquals(failure instanceof Error, true);
  assertEquals(failure === original, false);
  assertEquals(failure instanceof Error ? failure.message : "", "Storage failed");
  assertEquals(failure instanceof Error ? failure.cause : undefined, undefined);
});

Deno.test("readValidatedSkillTextFile honors a shared cancellation budget", async () => {
  const root = "/project/skills/writer";
  const adapter = {
    ...createSkillTestAdapter({}),
    exists: () => new Promise<boolean>(() => {}),
  };
  const controller = new AbortController();
  const budget = createSkillOperationBudget({ abortSignal: controller.signal });
  const readWithOptions = readValidatedSkillTextFile as unknown as (
    skillRoot: string,
    requestedPath: string,
    allowedSubdirs: readonly string[],
    fsAdapter: typeof adapter,
    maxBytes: number | undefined,
    options: { budget: typeof budget },
  ) => Promise<{ content: string; path: string }>;

  const read = readWithOptions(
    root,
    "SKILL.md",
    [],
    adapter,
    undefined,
    { budget },
  );
  controller.abort(new Error("cancel strict skill read"));

  assertEquals(await settlesWithin(read), true);
});
