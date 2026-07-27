import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  discoveryFileExists,
  findTypeScriptFiles,
  listDiscoveryDirectoryEntries,
  readDiscoveryTextFile,
  resolveRuntimeDiscoveryRoot,
} from "./file-discovery.ts";
import type { FileDiscoveryContext } from "./types.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { isNativeFileSystemAdapter } from "#veryfront/platform/adapters/native-file-system-provenance.ts";
import { DenoFileSystemAdapter } from "#veryfront/platform/adapters/runtime/deno/filesystem-adapter.ts";

type FakeEntry = { name: string; isFile: boolean; isDirectory: boolean };

function fakeFsAdapter(tree: Record<string, FakeEntry[]>, files: Set<string>): FileSystemAdapter {
  return {
    exists: (path: string) => Promise.resolve(path in tree || files.has(path)),
    readDir: async function* (path: string) {
      for (const entry of tree[path] ?? []) {
        yield entry;
      }
    },
    readFile: (path: string) => Promise.resolve(`content:${path}`),
  } as unknown as FileSystemAdapter;
}

Deno.test("listDiscoveryDirectoryEntries reads top-level entries through an fsAdapter", async () => {
  const fsAdapter = fakeFsAdapter(
    {
      "/agents": [
        { name: "lead.md", isFile: true, isDirectory: false },
        { name: "writer", isFile: false, isDirectory: true },
      ],
    },
    new Set(),
  );
  const context: FileDiscoveryContext = { platform: "node", fsAdapter };

  const entries = await listDiscoveryDirectoryEntries("/agents", context);

  assertEquals(entries, [
    { name: "lead.md", isFile: true, isDirectory: false },
    { name: "writer", isFile: false, isDirectory: true },
  ]);
});

Deno.test("listDiscoveryDirectoryEntries returns empty for a missing dir via fsAdapter", async () => {
  const fsAdapter = fakeFsAdapter({}, new Set());
  const context: FileDiscoveryContext = { platform: "node", fsAdapter };

  assertEquals(await listDiscoveryDirectoryEntries("/missing", context), []);
});

Deno.test("listDiscoveryDirectoryEntries reads top-level entries through the Node fallback", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${root}/lead.md`, "Lead");
    await Deno.mkdir(`${root}/writer`);
    await Deno.writeTextFile(`${root}/writer/AGENT.md`, "Writer");
    const context: FileDiscoveryContext = { platform: "node" };

    const entries = (await listDiscoveryDirectoryEntries(root, context))
      .sort((a, b) => a.name.localeCompare(b.name));

    assertEquals(entries, [
      { name: "lead.md", isFile: true, isDirectory: false },
      { name: "writer", isFile: false, isDirectory: true },
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("discoveryFileExists resolves through an fsAdapter", async () => {
  const fsAdapter = fakeFsAdapter({}, new Set(["/agents/writer/AGENT.md"]));
  const context: FileDiscoveryContext = { platform: "node", fsAdapter };

  assertEquals(await discoveryFileExists("/agents/writer/AGENT.md", context), true);
  assertEquals(await discoveryFileExists("/agents/writer/SKILL.md", context), false);
});

Deno.test("native discovery emits valid file URLs and reads encoded paths", async () => {
  const parent = await Deno.makeTempDir();
  const root = `${parent}/veryfront discovery %20`;
  try {
    await Deno.mkdir(root);
    const file = `${root}/welcome prompt.ts`;
    await Deno.writeTextFile(file, "export default 'welcome';");
    const context: FileDiscoveryContext = { platform: "node" };

    const files = await findTypeScriptFiles(root, context);

    assertEquals(files.length, 1);
    assertEquals(new URL(files[0]!).protocol, "file:");
    assertEquals(await readDiscoveryTextFile(files[0]!, context), "export default 'welcome';");
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test("adapter discovery preserves raw relative and percent-containing paths", async () => {
  const fsAdapter = fakeFsAdapter(
    {
      "resources": [
        { name: "release%20notes.ts", isFile: true, isDirectory: false },
      ],
    },
    new Set(["resources/release%20notes.ts"]),
  );
  const context: FileDiscoveryContext = { platform: "node", fsAdapter };

  const files = await findTypeScriptFiles("resources", context);

  assertEquals(files, ["resources/release%20notes.ts"]);
  assertEquals(
    await readDiscoveryTextFile(files[0]!, context),
    "content:resources/release%20notes.ts",
  );
});

Deno.test("bounded adapter discovery rejects malformed UTF-8", async () => {
  const path = "resources/invalid.ts";
  const fsAdapter = {
    ...fakeFsAdapter({}, new Set([path])),
    readFileBytesBounded: () => Promise.resolve(new Uint8Array([0xc3, 0x28])),
    stat: () =>
      Promise.resolve({
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: 2,
        mtime: null,
      }),
  } as FileSystemAdapter;

  await assertRejects(
    () =>
      readDiscoveryTextFile(
        path,
        { platform: "node", fsAdapter },
        { maxBytes: 2 },
      ),
    TypeError,
    "valid UTF-8",
  );
});

Deno.test("legacy adapter discovery rejects malformed UTF-16 before byte counting", async () => {
  const path = "resources/invalid.ts";
  const fsAdapter = {
    ...fakeFsAdapter({}, new Set([path])),
    readFile: () => Promise.resolve("\ud800"),
    stat: () =>
      Promise.resolve({
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: 3,
        mtime: null,
      }),
  } as FileSystemAdapter;

  await assertRejects(
    () =>
      readDiscoveryTextFile(
        path,
        { platform: "node", fsAdapter },
        { maxBytes: 3 },
      ),
    TypeError,
    "valid Unicode text",
  );
});

Deno.test("bounded adapter discovery rejects terminal symlinks before reading", async () => {
  const path = "skills/demo/SKILL.md";
  let readCalled = false;
  const fsAdapter = {
    ...fakeFsAdapter({}, new Set([path])),
    readFileBytesBounded: () => {
      readCalled = true;
      return Promise.resolve(new TextEncoder().encode("safe"));
    },
    lstat: () =>
      Promise.resolve({
        isFile: true,
        isDirectory: false,
        isSymlink: true,
        size: 4,
        mtime: null,
      }),
  } as FileSystemAdapter;

  await assertRejects(
    () =>
      readDiscoveryTextFile(
        path,
        { platform: "node", fsAdapter },
        { maxBytes: 4 },
      ),
    TypeError,
    "symlink",
  );
  assertEquals(readCalled, false);
});

Deno.test("bounded adapter discovery rejects a differing swap-back snapshot", async () => {
  const path = "skills/demo/SKILL.md";
  let reads = 0;
  const fsAdapter = {
    ...fakeFsAdapter({}, new Set([path])),
    readFileBytesBounded: () => {
      reads++;
      return Promise.resolve(
        new TextEncoder().encode(reads === 1 ? "outside" : "trusted"),
      );
    },
    lstat: () =>
      Promise.resolve({
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: 7,
        mtime: null,
      }),
  } as FileSystemAdapter;

  await assertRejects(
    () =>
      readDiscoveryTextFile(
        path,
        { platform: "node", fsAdapter },
        { maxBytes: 7 },
      ),
    TypeError,
    "changed during reading",
  );
  assertEquals(reads, 2);
});

Deno.test("native bounded discovery rejects symlinks and malformed UTF-8", async () => {
  const root = await Deno.makeTempDir({ prefix: "vf-discovery-guard-" });
  const target = `${root}/target.md`;
  const link = `${root}/linked.md`;
  const invalid = `${root}/invalid.md`;
  try {
    await Deno.writeTextFile(target, "safe");
    await Deno.writeFile(invalid, new Uint8Array([0xc3, 0x28]));
    let symlinkCreated = true;
    try {
      await Deno.symlink(target, link);
    } catch {
      symlinkCreated = false;
      console.warn("[SKIP] discovery symlink test: OS denied symlink creation");
    }

    if (symlinkCreated) {
      await assertRejects(
        () =>
          readDiscoveryTextFile(
            link,
            { platform: "node" },
            { maxBytes: 4 },
          ),
        TypeError,
        "symlink",
      );
    }
    await assertRejects(
      () =>
        readDiscoveryTextFile(
          invalid,
          { platform: "node" },
          { maxBytes: 2 },
        ),
      TypeError,
      "valid UTF-8",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("native bounded discovery binds the opened file to its preflight identity", async () => {
  const root = await Deno.makeTempDir({ prefix: "vf-discovery-swap-" });
  const path = `${root}/SKILL.md`;
  const safePath = `${root}/SKILL.safe.md`;
  const replacementPath = `${root}/SKILL.replacement.md`;
  const nodeFs = await import("node:fs");
  const originalOpen = nodeFs.promises.open;
  const mutablePromises = nodeFs.promises as {
    open: typeof nodeFs.promises.open;
  };
  let swapped = false;
  let restored = false;

  try {
    await Deno.writeTextFile(path, "trusted");
    await Deno.writeTextFile(replacementPath, "outside");
    mutablePromises.open = (async (requestedPath, flags, mode) => {
      if (!swapped && String(requestedPath) === path) {
        swapped = true;
        await Deno.rename(path, safePath);
        await Deno.rename(replacementPath, path);
        const handle = await originalOpen(requestedPath, flags, mode);
        await Deno.rename(path, replacementPath);
        await Deno.rename(safePath, path);
        restored = true;
        return handle;
      }
      return await originalOpen(requestedPath, flags, mode);
    }) as typeof nodeFs.promises.open;

    await assertRejects(
      () =>
        readDiscoveryTextFile(
          path,
          {
            platform: "deno",
            fsAdapter: new DenoFileSystemAdapter(),
          },
          { maxBytes: 7 },
        ),
      TypeError,
      "changed during reading",
    );
    assertEquals(swapped, true);
    assertEquals(restored, true);
  } finally {
    mutablePromises.open = originalOpen;
    if (swapped && !restored) {
      await Deno.rename(path, replacementPath);
      await Deno.rename(safePath, path);
    }
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("runtime discovery roots preserve absolute adapter namespaces and identity", () => {
  const fsAdapter = fakeFsAdapter({}, new Set());
  const root = resolveRuntimeDiscoveryRoot("/project/skills/demo", {
    platform: "node",
    fsAdapter,
  });

  assertEquals(root.rootPath, "/project/skills/demo");
  assertEquals(root.fsAdapter === fsAdapter, true);
});

Deno.test("relative runtime root views preserve hosted-adapter provenance", () => {
  const fsAdapter = Object.assign(fakeFsAdapter({}, new Set()), {
    getUnderlyingAdapter() {
      return fsAdapter;
    },
    isMultiProjectMode() {
      return true;
    },
    isVeryfrontAdapter() {
      return true;
    },
  });
  const root = resolveRuntimeDiscoveryRoot("skills/demo", {
    platform: "node",
    fsAdapter,
  });

  assertEquals(root.fsAdapter === fsAdapter, false);
  assertEquals(isVirtualFilesystem(root.fsAdapter!), true);
  assertEquals(
    (root.fsAdapter as typeof fsAdapter).getUnderlyingAdapter(),
    fsAdapter,
  );
});

Deno.test("relative runtime root views support frozen exact-key adapters", async () => {
  let realPathInput: string | undefined;
  let boundedReadInput: { path: string; byteLimit: number } | undefined;
  let legacyReadCalled = false;
  const fsAdapter = Object.freeze(
    Object.assign(fakeFsAdapter({}, new Set()), {
      async readFile(path: string) {
        legacyReadCalled = true;
        return `content:${path}`;
      },
      async readFileBytesBounded(path: string, byteLimit: number) {
        boundedReadInput = { path, byteLimit };
        return new TextEncoder().encode("safe");
      },
      async stat() {
        return {
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          size: 4,
          mtime: null,
        };
      },
      async realPath(path: string) {
        realPathInput = path;
        return path;
      },
    }),
  );
  const root = resolveRuntimeDiscoveryRoot("skills/demo", {
    platform: "node",
    fsAdapter,
  });

  assertEquals(
    await root.fsAdapter!.readFile(`${root.rootPath}/SKILL.md`),
    "content:skills/demo/SKILL.md",
  );
  assertEquals(await root.fsAdapter!.realPath!(root.rootPath), root.rootPath);
  assertEquals(realPathInput, "skills/demo");

  legacyReadCalled = false;
  assertEquals(
    await readDiscoveryTextFile(
      `${root.rootPath}/SKILL.md`,
      { platform: "node", fsAdapter: root.fsAdapter },
      { maxBytes: 4 },
    ),
    "safe",
  );
  assertEquals(boundedReadInput, {
    path: "skills/demo/SKILL.md",
    byteLimit: 5,
  });
  assertEquals(legacyReadCalled, false);
});

Deno.test("relative runtime root views do not inherit native adapter provenance", () => {
  const fsAdapter = new DenoFileSystemAdapter();
  const root = resolveRuntimeDiscoveryRoot("skills/demo", {
    platform: "deno",
    fsAdapter,
  });

  assertEquals(isNativeFileSystemAdapter(fsAdapter), true);
  assertEquals(isNativeFileSystemAdapter(root.fsAdapter!), false);
});

Deno.test("file discovery propagates source failures instead of treating them as empty", async () => {
  const fsAdapter = {
    exists: () => Promise.resolve(true),
    readDir: async function* () {
      yield await Promise.reject(new Error("resource source unavailable"));
    },
  } as unknown as FileSystemAdapter;
  const context: FileDiscoveryContext = { platform: "node", fsAdapter };

  await assertRejects(
    () => findTypeScriptFiles("/resources", context),
    Error,
    "resource source unavailable",
  );
});

Deno.test("directory listing and existence checks propagate adapter failures", async () => {
  const listFailureAdapter = {
    exists: () => Promise.resolve(true),
    readDir: async function* () {
      yield await Promise.reject(new Error("directory authorization failed"));
    },
  } as unknown as FileSystemAdapter;
  const existsFailureAdapter = {
    exists: () => Promise.reject(new Error("metadata service unavailable")),
  } as unknown as FileSystemAdapter;

  await assertRejects(
    () =>
      listDiscoveryDirectoryEntries("/agents", {
        platform: "node",
        fsAdapter: listFailureAdapter,
      }),
    Error,
    "directory authorization failed",
  );
  await assertRejects(
    () =>
      discoveryFileExists("/agents/lead.md", {
        platform: "node",
        fsAdapter: existsFailureAdapter,
      }),
    Error,
    "metadata service unavailable",
  );
});

Deno.test("file discovery rejects unsafe adapter directory-entry names", async () => {
  const fsAdapter = fakeFsAdapter(
    {
      "/tools": [
        { name: "../outside.ts", isFile: true, isDirectory: false },
      ],
    },
    new Set(),
  );

  await assertRejects(
    () => findTypeScriptFiles("/tools", { platform: "node", fsAdapter }),
    TypeError,
    "invalid directory entry name",
  );
});

Deno.test("TypeScript discovery excludes tests, declarations, benchmarks, and ignored trees", async () => {
  const fsAdapter = fakeFsAdapter(
    {
      "/tools": [
        { name: "live.ts", isFile: true, isDirectory: false },
        { name: "live.test.ts", isFile: true, isDirectory: false },
        { name: "live.spec.tsx", isFile: true, isDirectory: false },
        { name: "live.d.ts", isFile: true, isDirectory: false },
        { name: "live.bench.ts", isFile: true, isDirectory: false },
        { name: "__tests__", isFile: false, isDirectory: true },
        { name: "nested", isFile: false, isDirectory: true },
      ],
      "/tools/__tests__": [
        { name: "hidden.ts", isFile: true, isDirectory: false },
      ],
      "/tools/nested": [
        { name: "helper.tsx", isFile: true, isDirectory: false },
      ],
    },
    new Set(),
  );

  assertEquals(
    await findTypeScriptFiles("/tools", { platform: "node", fsAdapter }),
    ["/tools/live.ts", "/tools/nested/helper.tsx"],
  );
});

Deno.test("discovery applies one scan budget across configured roots", async () => {
  const fsAdapter = fakeFsAdapter(
    {
      "/tools-a": [{ name: "first.ts", isFile: true, isDirectory: false }],
      "/tools-b": [{ name: "second.ts", isFile: true, isDirectory: false }],
    },
    new Set(),
  );
  const context = {
    platform: "node",
    fsAdapter,
    entryBudget: { scannedEntries: 0, maxEntries: 1 },
  } satisfies FileDiscoveryContext;

  assertEquals(await findTypeScriptFiles("/tools-a", context), ["/tools-a/first.ts"]);
  await assertRejects(
    () => findTypeScriptFiles("/tools-b", context),
    RangeError,
    "entry limit of 1 exceeded",
  );
});
