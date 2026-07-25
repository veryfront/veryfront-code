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
