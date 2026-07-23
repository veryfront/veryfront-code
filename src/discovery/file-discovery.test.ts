import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  assertDiscoveryPathWithinBase,
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

Deno.test("discovery filesystem helpers reject lexical escapes before probing the adapter", async () => {
  const probedPaths: string[] = [];
  const fsAdapter = {
    exists(path: string) {
      probedPaths.push(path);
      return Promise.resolve(false);
    },
  } as unknown as FileSystemAdapter;
  const context: FileDiscoveryContext = {
    platform: "node",
    baseDir: "/project",
    fsAdapter,
  };

  await assertRejects(
    () => discoveryFileExists("/outside/secret.ts", context),
    TypeError,
    "outside the project root",
  );
  await assertRejects(
    () => findTypeScriptFiles("/outside/tools", context),
    TypeError,
    "outside the project root",
  );
  await assertRejects(
    () => listDiscoveryDirectoryEntries("/outside/agents", context),
    TypeError,
    "outside the project root",
  );

  assertEquals(probedPaths, []);
});

Deno.test("discovery filesystem helpers propagate operational adapter failures", async () => {
  const failure = new Error("storage unavailable");
  const fsAdapter = {
    exists: (path: string) =>
      path === "/exists-error" ? Promise.reject(failure) : Promise.resolve(true),
    readDir: async function* () {
      yield* [];
      throw failure;
    },
  } as unknown as FileSystemAdapter;
  const context: FileDiscoveryContext = { platform: "node", fsAdapter };

  await assertRejects(() => listDiscoveryDirectoryEntries("/agents", context), Error);
  await assertRejects(() => findTypeScriptFiles("/tools", context), Error);
  await assertRejects(() => discoveryFileExists("/exists-error", context), Error);
});

Deno.test("findTypeScriptFiles includes supported JavaScript module extensions", async () => {
  const fsAdapter = fakeFsAdapter(
    {
      "/tools": [
        { name: "a.ts", isFile: true, isDirectory: false },
        { name: "b.tsx", isFile: true, isDirectory: false },
        { name: "c.js", isFile: true, isDirectory: false },
        { name: "d.jsx", isFile: true, isDirectory: false },
        { name: "e.mjs", isFile: true, isDirectory: false },
        { name: "types.d.ts", isFile: true, isDirectory: false },
      ],
    },
    new Set(),
  );
  const context: FileDiscoveryContext = { platform: "node", fsAdapter };

  assertEquals(await findTypeScriptFiles("/tools", context), [
    "file:///tools/a.ts",
    "file:///tools/b.tsx",
    "file:///tools/c.js",
    "file:///tools/d.jsx",
    "file:///tools/e.mjs",
  ]);
});

Deno.test("findTypeScriptFiles rejects a configured root symlink outside the project", async () => {
  const root = await Deno.makeTempDir();
  const projectDir = `${root}/project`;
  const outsideDir = `${root}/outside`;
  try {
    await Deno.mkdir(projectDir);
    await Deno.mkdir(outsideDir);
    await Deno.writeTextFile(`${outsideDir}/escaped.ts`, "export default {};\n");
    await Deno.symlink(outsideDir, `${projectDir}/tools`);

    await assertRejects(
      () =>
        findTypeScriptFiles(`${projectDir}/tools`, {
          platform: "node",
          baseDir: projectDir,
        }),
      TypeError,
      "outside the project root",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("adapter containment rejects a symlink in an intermediate path component", async () => {
  const fsAdapter = {
    lstat: (path: string) =>
      Promise.resolve({
        size: 0,
        isFile: path.endsWith(".ts"),
        isDirectory: !path.endsWith(".ts"),
        isSymlink: path === "/project/tools/link",
        mtime: null,
      }),
  } as unknown as FileSystemAdapter;

  await assertRejects(
    () =>
      assertDiscoveryPathWithinBase("/project/tools/link/escaped.ts", {
        platform: "node",
        baseDir: "/project",
        fsAdapter,
      }),
    TypeError,
    "cannot be verified",
  );
});

Deno.test("readDiscoveryTextFile rejects oversized markdown definitions", async () => {
  const root = await Deno.makeTempDir();
  const file = `${root}/AGENT.md`;
  try {
    await Deno.writeTextFile(file, "a".repeat(2 * 1_024 * 1_024 + 1));

    await assertRejects(
      () =>
        readDiscoveryTextFile(`file://${file}`, {
          platform: "node",
          baseDir: root,
        }),
      RangeError,
      "size limit",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("local discovery file URLs preserve spaces and URL metacharacters", async () => {
  const root = await Deno.makeTempDir({ prefix: "vf discovery #" });
  try {
    await Deno.mkdir(`${root}/tools`);
    await Deno.writeTextFile(`${root}/tools/a file.ts`, "export default {};\n");
    const context: FileDiscoveryContext = { platform: "node", baseDir: root };

    const files = await findTypeScriptFiles(`${root}/tools`, context);

    assertEquals(files.length, 1);
    assertEquals(await readDiscoveryTextFile(files[0]!, context), "export default {};\n");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("discovery rejects filesystem entry names beyond the supported limit", async () => {
  const fsAdapter = fakeFsAdapter(
    {
      "/tools": [
        { name: `${"a".repeat(256)}.ts`, isFile: true, isDirectory: false },
      ],
    },
    new Set(),
  );

  await assertRejects(
    () => findTypeScriptFiles("/tools", { platform: "node", fsAdapter }),
    TypeError,
    "invalid entry name",
  );
});
