import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { discoveryFileExists, listDiscoveryDirectoryEntries } from "./file-discovery.ts";
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

Deno.test("discoveryFileExists resolves through an fsAdapter", async () => {
  const fsAdapter = fakeFsAdapter({}, new Set(["/agents/writer/AGENT.md"]));
  const context: FileDiscoveryContext = { platform: "node", fsAdapter };

  assertEquals(await discoveryFileExists("/agents/writer/AGENT.md", context), true);
  assertEquals(await discoveryFileExists("/agents/writer/SKILL.md", context), false);
});
