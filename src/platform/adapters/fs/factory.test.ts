import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { createFSAdapter } from "./factory.ts";

describe("createFSAdapter", () => {
  it("should export createFSAdapter function", () => {
    assertExists(createFSAdapter);
    assertEquals(typeof createFSAdapter, "function");
  });

  it("should throw for local type", async () => {
    await assertRejects(
      () => createFSAdapter({ type: "local" }),
      Error,
      'FSAdapter type "local" should not use this factory',
    );
  });

  it("should throw for unsupported type", async () => {
    await assertRejects(
      () => createFSAdapter({ type: "unsupported" as any }),
      Error,
      'FSAdapter type "unsupported" is not implemented',
    );
  });

  it("should throw for github type without config", async () => {
    await assertRejects(
      () => createFSAdapter({ type: "github" }),
      Error,
      "GitHub adapter requires github configuration",
    );
  });

  it("should default to local type when type not specified", async () => {
    await assertRejects(
      () => createFSAdapter({}),
      Error,
      'FSAdapter type "local" should not use this factory',
    );
  });

  it("creates an isolated memory adapter from configured files", async () => {
    const binary = new Uint8Array([1, 2, 3]);
    const files = {
      "/hello.txt": "hello",
      "/binary.bin": binary,
    };

    const pending = createFSAdapter({ type: "memory", memory: { files } });
    binary[0] = 9;
    files["/late.txt" as keyof typeof files] = "late" as never;

    const adapter = await pending;
    assertEquals(await adapter.readTextFile?.("/hello.txt"), "hello");
    assertEquals(await adapter.exists("/late.txt"), false);

    const firstRead = await adapter.readFile("/binary.bin");
    assertEquals(firstRead, new Uint8Array([1, 2, 3]));
    if (typeof firstRead !== "string") firstRead[0] = 8;
    assertEquals(await adapter.readFile("/binary.bin"), new Uint8Array([1, 2, 3]));
  });

  it("supports writable directory semantics for memory adapters", async () => {
    const adapter = await createFSAdapter({ type: "memory" });
    assertExists(adapter.writeFile);
    assertExists(adapter.mkdir);
    assertExists(adapter.remove);
    assertExists(adapter.readDir);

    await adapter.mkdir("/nested/deep", { recursive: true });
    await adapter.writeFile("/nested/deep/value.txt", "value");

    assertEquals(await adapter.exists("/nested"), true);
    assertEquals(await adapter.stat("/nested/deep/value.txt"), {
      isFile: true,
      isDirectory: false,
      isSymlink: false,
      size: 5,
      mtime: null,
    });
    assertEquals(await Array.fromAsync(adapter.readDir("/nested")), [{
      name: "deep",
      path: "/nested/deep",
      isDirectory: true,
      isFile: false,
      isSymlink: false,
    }]);

    await adapter.remove("/nested", { recursive: true });
    assertEquals(await adapter.exists("/nested/deep/value.txt"), false);
  });

  it("rejects memory files that conflict with a parent file", async () => {
    await assertRejects(
      () =>
        createFSAdapter({
          type: "memory",
          memory: {
            files: {
              "/entry": "file",
              "/entry/nested.txt": "nested",
            },
          },
        }),
      VeryfrontError,
      "Memory filesystem paths cannot be both files and directories",
    );
  });

  it("rejects recursive directories beneath an existing memory file", async () => {
    const adapter = await createFSAdapter({
      type: "memory",
      memory: { files: { "/entry": "file" } },
    });

    await assertRejects(
      () => adapter.mkdir?.("/entry/nested", { recursive: true }) ?? Promise.resolve(),
      VeryfrontError,
      "Memory filesystem paths cannot be both files and directories",
    );
    assertEquals((await adapter.stat("/entry")).isFile, true);
    assertEquals(await adapter.exists("/entry/nested"), false);
  });

  it("reads the adapter type once", async () => {
    const secret = "PRIVATE_ADAPTER_TYPE/project-963";
    let reads = 0;
    const config = Object.create(null);
    Object.defineProperty(config, "type", {
      get() {
        reads++;
        if (reads > 1) throw new Error(secret);
        return "local";
      },
    });

    const error = await assertRejects(
      () => createFSAdapter(config),
      Error,
      'FSAdapter type "local" should not use this factory',
    );

    assertEquals(reads, 1);
    assertEquals(JSON.stringify(error).includes(secret), false);
  });

  it("rejects unreadable configuration without retaining trap data", async () => {
    const secret = "PRIVATE_FACTORY_CONFIG/project-159";
    const config = Object.create(null);
    Object.defineProperty(config, "type", {
      get() {
        throw new Error(secret);
      },
    });

    const error = await assertRejects(() => createFSAdapter(config));
    assertEquals(error instanceof VeryfrontError, true);
    assertEquals(JSON.stringify(error).includes(secret), false);
  });

  it("does not include an unsafe unsupported type in public errors", async () => {
    const secret = "PRIVATE_UNSUPPORTED_TYPE/project-753";
    const error = await assertRejects(
      () => createFSAdapter({ type: secret as never }),
      Error,
      "FSAdapter type is not implemented",
    );

    assertEquals(JSON.stringify(error).includes(secret), false);
  });

  it("snapshots GitHub configuration before asynchronous module loading", async () => {
    const originalFetch = globalThis.fetch;
    const github = { token: "token-before", owner: "owner", repo: "repo" };
    let authorization: string | null = null;
    globalThis.fetch = (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            sha: "root",
            tree: [],
            truncated: false,
          }),
          { status: 200 },
        ),
      );
    };

    try {
      const pending = createFSAdapter({ type: "github", github });
      github.token = "token-after";
      const adapter = await pending;

      assertEquals(authorization, "Bearer token-before");
      (adapter as { dispose?: () => void }).dispose?.();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
