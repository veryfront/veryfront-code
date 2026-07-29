import { assertEquals, assertRejects } from "#std/assert";
import {
  checkExtensionWorkspaces,
  type ExtensionCheckInvocation,
} from "./check-extension-workspaces.ts";

async function fixture(
  manifests: Record<string, unknown>,
): Promise<string> {
  const root = await Deno.makeTempDir();
  const workspace = Object.keys(manifests).map((name) =>
    `./extensions/${name}`
  );
  await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify({ workspace }));
  await Deno.writeTextFile(
    `${root}/deno.lock`,
    JSON.stringify({
      version: "5",
      specifiers: {},
      jsr: {},
      npm: {},
      redirects: {},
      remote: {},
    }),
  );
  const targets = (value: unknown): string[] => {
    if (typeof value === "string") {
      return /\.(?:ts|tsx|mts|cts)$/.test(value) ? [value] : [];
    }
    if (Array.isArray(value)) return value.flatMap(targets);
    if (!value || typeof value !== "object") return [];
    return Object.values(value).flatMap(targets);
  };
  for (const [name, exports] of Object.entries(manifests)) {
    await Deno.mkdir(`${root}/extensions/${name}`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/extensions/${name}/deno.json`,
      JSON.stringify({ name: `@veryfront/${name}`, exports }),
    );
    for (const target of targets(exports)) {
      const path = `${root}/extensions/${name}/${target.replace(/^\.\//, "")}`;
      await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), {
        recursive: true,
      });
      await Deno.writeTextFile(path, "export {};\n");
    }
  }
  return root;
}

Deno.test("extension checker rejects a member with zero concrete TypeScript exports", async () => {
  const root = await fixture({ "ext-empty": { ".": "./README.md" } });
  try {
    await assertRejects(
      () =>
        checkExtensionWorkspaces({
          root,
          runner: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
        }),
      Error,
      "extension workspace has zero exported TypeScript entrypoints: extensions/ext-empty",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("extension checker rejects Deno's zero-file warning even with exit zero", async () => {
  const root = await fixture({ "ext-one": "./src/index.ts" });
  try {
    await assertRejects(
      () =>
        checkExtensionWorkspaces({
          root,
          runner: () =>
            Promise.resolve({
              code: 0,
              stdout: "",
              stderr: "No matching files found\n",
            }),
        }),
      Error,
      "No matching files found",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("extension checker rejects a failed member check with captured diagnostics", async () => {
  const root = await fixture({ "ext-one": "./src/index.ts" });
  try {
    await assertRejects(
      () =>
        checkExtensionWorkspaces({
          root,
          runner: () =>
            Promise.resolve({
              code: 1,
              stdout: "",
              stderr: "TS2322 bad type\n",
            }),
        }),
      Error,
      "extension typecheck failed for extensions/ext-one (exit 1): TS2322 bad type",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("extension checker invokes one frozen multi-entrypoint check per workspace", async () => {
  const root = await fixture({
    "ext-many": {
      ".": "./src/index.ts",
      "./deno": { types: "./src/deno.ts", default: "./src/deno.ts" },
      "./node": "./src/node.ts",
    },
    "ext-one": "./src/index.ts",
  });
  const invocations: ExtensionCheckInvocation[] = [];
  try {
    const result = await checkExtensionWorkspaces({
      root,
      runner: (invocation) => {
        invocations.push(invocation);
        return Promise.resolve({ code: 0, stdout: "Check ok\n", stderr: "" });
      },
    });
    const realRoot = await Deno.realPath(root);

    assertEquals(result, { members: 2, entrypoints: 4 });
    assertEquals(invocations, [
      {
        command: Deno.execPath(),
        args: [
          "check",
          `--config=${realRoot}/extensions/ext-many/deno.json`,
          "--frozen",
          `--lock=${realRoot}/deno.lock`,
          `${realRoot}/extensions/ext-many/src/deno.ts`,
          `${realRoot}/extensions/ext-many/src/index.ts`,
          `${realRoot}/extensions/ext-many/src/node.ts`,
        ],
        cwd: realRoot,
      },
      {
        command: Deno.execPath(),
        args: [
          "check",
          `--config=${realRoot}/extensions/ext-one/deno.json`,
          "--frozen",
          `--lock=${realRoot}/deno.lock`,
          `${realRoot}/extensions/ext-one/src/index.ts`,
        ],
        cwd: realRoot,
      },
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("extension checker rejects noncanonical, duplicate, escaping, and symlink workspace members", async () => {
  for (
    const member of [
      "foo/../extensions/ext-one",
      "extensions/../cli",
    ]
  ) {
    const root = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        `${root}/deno.json`,
        JSON.stringify({ workspace: [member] }),
      );
      await Deno.writeTextFile(
        `${root}/deno.lock`,
        JSON.stringify({ version: "5" }),
      );
      await assertRejects(
        () =>
          checkExtensionWorkspaces({
            root,
            runner: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
          }),
        Error,
        "workspace member must be a canonical direct extensions child",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }

  const duplicateRoot = await fixture({ "ext-one": "./src/index.ts" });
  try {
    await Deno.writeTextFile(
      `${duplicateRoot}/deno.json`,
      JSON.stringify({
        workspace: ["./extensions/ext-one", "extensions/ext-one"],
      }),
    );
    await assertRejects(
      () =>
        checkExtensionWorkspaces({
          root: duplicateRoot,
          runner: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
        }),
      Error,
      "duplicate extension workspace member: extensions/ext-one",
    );
  } finally {
    await Deno.remove(duplicateRoot, { recursive: true });
  }

  const symlinkRoot = await Deno.makeTempDir();
  const outside = await fixture({ "ext-outside": "./src/index.ts" });
  try {
    await Deno.mkdir(`${symlinkRoot}/extensions`, { recursive: true });
    await Deno.symlink(
      `${outside}/extensions/ext-outside`,
      `${symlinkRoot}/extensions/ext-outside`,
    );
    await Deno.writeTextFile(
      `${symlinkRoot}/deno.json`,
      JSON.stringify({ workspace: ["./extensions/ext-outside"] }),
    );
    await Deno.writeTextFile(
      `${symlinkRoot}/deno.lock`,
      JSON.stringify({ version: "5" }),
    );
    await assertRejects(
      () =>
        checkExtensionWorkspaces({
          root: symlinkRoot,
          runner: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
        }),
      Error,
      "extension workspace member must be a direct non-symlink directory",
    );
  } finally {
    await Deno.remove(symlinkRoot, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("extension checker preflights every export as a contained regular file", async () => {
  const root = await fixture({
    "ext-one": { ".": "./src/index.ts", "./missing": "./src/missing.ts" },
  });
  try {
    await Deno.remove(`${root}/extensions/ext-one/src/missing.ts`);
    let invoked = false;
    await assertRejects(
      () =>
        checkExtensionWorkspaces({
          root,
          runner: () => {
            invoked = true;
            return Promise.resolve({ code: 0, stdout: "", stderr: "" });
          },
        }),
      Error,
      "extension export is missing: extensions/ext-one: ./src/missing.ts",
    );
    assertEquals(invoked, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }

  const directoryRoot = await fixture({ "ext-one": "./src/index.ts" });
  try {
    await Deno.remove(`${directoryRoot}/extensions/ext-one/src/index.ts`);
    await Deno.mkdir(`${directoryRoot}/extensions/ext-one/src/index.ts`);
    await assertRejects(
      () =>
        checkExtensionWorkspaces({
          root: directoryRoot,
          runner: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
        }),
      Error,
      "extension export must be a regular file",
    );
  } finally {
    await Deno.remove(directoryRoot, { recursive: true });
  }
});

Deno.test("extension checker rejects URL-semantic export traversal", async () => {
  for (
    const target of [
      "./%2e%2e/ext-other/mod.ts",
      "./src/%2f..%2fother.ts",
      "./src/%5c..%5cother.ts",
    ]
  ) {
    const root = await fixture({ "ext-one": target });
    try {
      await assertRejects(
        () =>
          checkExtensionWorkspaces({
            root,
            runner: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
          }),
        Error,
        `extension export escapes workspace: extensions/ext-one: ${target}`,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

Deno.test("extension checker requires a contained regular root lockfile", async () => {
  const root = await fixture({ "ext-one": "./src/index.ts" });
  try {
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({ workspace: ["./extensions/ext-one"], lock: false }),
    );
    await assertRejects(
      () =>
        checkExtensionWorkspaces({
          root,
          runner: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
        }),
      Error,
      "extension checks require a workspace-root lockfile",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("extension checker rejects malformed conditional exports", async () => {
  const root = await fixture({
    "ext-one": { ".": { default: "./src/index.ts", deno: 42 } },
  });
  try {
    await assertRejects(
      () =>
        checkExtensionWorkspaces({
          root,
          runner: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
        }),
      Error,
      "invalid extension export branch at exports...deno",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("extension checker runs real Deno with member config and explicit frozen root lock", async () => {
  const root = await fixture({
    "ext-one": {
      ".": "./src/index.ts",
      "./deno": { deno: "./src/deno.ts", default: null },
    },
  });
  try {
    await Deno.writeTextFile(
      `${root}/extensions/ext-one/deno.json`,
      JSON.stringify({
        name: "@veryfront/ext-one",
        exports: {
          ".": "./src/index.ts",
          "./deno": { deno: "./src/deno.ts", default: null },
        },
        imports: { "#local": "./src/local.ts" },
      }),
    );
    await Deno.writeTextFile(
      `${root}/extensions/ext-one/src/index.ts`,
      'export { local } from "#local";\n',
    );
    await Deno.writeTextFile(
      `${root}/extensions/ext-one/src/local.ts`,
      "export const local = 1;\n",
    );
    const result = await checkExtensionWorkspaces({ root });
    assertEquals(result, { members: 1, entrypoints: 2 });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
