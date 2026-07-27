import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  discoveryFileExists,
  findTypeScriptFiles,
  listDiscoveryDirectoryEntries,
  readDiscoveryTextFile,
} from "./file-discovery.ts";
import type { FileDiscoveryContext } from "./types.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";

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
