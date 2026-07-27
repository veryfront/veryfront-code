import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  FSAdapterWrapper,
  hasHostedStyleConfigCapability,
  isExtendedFSAdapter,
  isVirtualFilesystem,
  NotSupportedError,
  wrapFSAdapter,
} from "./wrapper.ts";
import { denoAdapter } from "../deno.ts";
import { MultiProjectFSAdapter } from "./veryfront/multi-project-adapter.ts";
import { VERYFRONT_FS_ADAPTER_KIND } from "./veryfront/adapter-kind.ts";
import type { ContextualFSAdapter, FSAdapter } from "./veryfront/types.ts";

function createMockFSAdapter(overrides: Partial<FSAdapter> = {}): FSAdapter {
  return {
    readFile: (path: string) => {
      if (path === "/exists.txt") return Promise.resolve("content");
      return Promise.reject(new Error(`File not found: ${path}`));
    },
    exists: (path: string) => Promise.resolve(path === "/exists.txt" || path === "/dir"),
    stat: (path: string) => {
      if (path === "/exists.txt") {
        return Promise.resolve({
          size: 7,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: new Date(),
        });
      }

      if (path === "/dir") {
        return Promise.resolve({
          size: 0,
          isFile: false,
          isDirectory: true,
          isSymlink: false,
          mtime: new Date(),
        });
      }

      return Promise.reject(new Error(`Path not found: ${path}`));
    },
    ...overrides,
  };
}

function createMockContextualAdapter(
  overrides: Partial<ContextualFSAdapter> = {},
): ContextualFSAdapter {
  return {
    ...createMockFSAdapter(),
    ...overrides,
  };
}

describe("NotSupportedError", () => {
  it("should create error with operation name", () => {
    const error = new NotSupportedError("writeFile");
    assertEquals(error.name, "NotSupportedError");
    assertEquals(error.message, "Operation 'writeFile' is not supported by this FSAdapter");
  });

  it("should create error with operation and adapter type", () => {
    const error = new NotSupportedError("writeFile", "MockAdapter");
    assertEquals(error.message, "Operation 'writeFile' is not supported by MockAdapter");
  });
});

describe("wrapFSAdapter", () => {
  it("should create FSAdapterWrapper instance", () => {
    const wrapper = wrapFSAdapter(createMockFSAdapter());
    assertEquals(wrapper instanceof FSAdapterWrapper, true);
  });
});

describe("isExtendedFSAdapter", () => {
  it("should return true for FSAdapterWrapper", () => {
    const wrapper = new FSAdapterWrapper(createMockFSAdapter());
    assertEquals(isExtendedFSAdapter(wrapper), true);
  });

  it("should return false for plain objects", () => {
    const plainFs = {
      readFile: () => Promise.resolve(""),
      writeFile: () => Promise.resolve(),
      exists: () => Promise.resolve(true),
      readDir: async function* () {},
      stat: () =>
        Promise.resolve({
          size: 0,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: null,
        }),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      makeTempDir: () => Promise.resolve("/tmp"),
      watch: () => ({ close: () => {}, [Symbol.asyncIterator]: async function* () {} }),
    };

    assertEquals(isExtendedFSAdapter(plainFs), false);
  });

  it("should return false for partial implementations", () => {
    const partialFs = {
      readFile: () => Promise.resolve(""),
      isVeryfrontAdapter: () => false,
    };

    assertEquals(isExtendedFSAdapter(partialFs as any), false);
  });
});

describe("hasHostedStyleConfigCapability", () => {
  it("recognizes a wrapper only when its underlying contextual adapter supports the full contract", () => {
    const underlying = createMockContextualAdapter({
      runWithContext: <T>(_slug: string, _token: string, fn: () => Promise<T>) => fn(),
      createStyleConfigBinding: () =>
        Promise.resolve({
          projectSlug: "project-a",
          sourceKey: "branch:main",
          sourceRevision: 1,
        }),
      installStyleConfig: () => Promise.resolve(true),
    });

    assertEquals(hasHostedStyleConfigCapability(new FSAdapterWrapper(underlying)), true);
  });

  it("does not mistake unconditional wrapper forwarding methods for underlying support", () => {
    const underlying = createMockContextualAdapter({
      runWithContext: <T>(_slug: string, _token: string, fn: () => Promise<T>) => fn(),
    });

    assertEquals(hasHostedStyleConfigCapability(new FSAdapterWrapper(underlying)), false);
  });

  it("rejects malformed extended adapters without invoking facade capabilities", () => {
    const facade = Object.assign(Object.create(denoAdapter.fs) as typeof denoAdapter.fs, {
      getUnderlyingAdapter: () => {
        throw new Error("invalid adapter provenance");
      },
      isVeryfrontAdapter: () => true,
      isMultiProjectMode: () => true,
      runWithContext: () => {
        throw new Error("capability guard must not enter request context");
      },
      createStyleConfigBinding: () => {
        throw new Error("capability guard must not create a binding");
      },
      installStyleConfig: () => {
        throw new Error("capability guard must not install config");
      },
    });

    assertEquals(hasHostedStyleConfigCapability(facade), false);
  });
});

describe("isVirtualFilesystem", () => {
  it("should classify every factory wrapper as virtual regardless of underlying type", () => {
    class FutureRemoteAdapter {
      readFile = () => Promise.resolve("content");
      exists = () => Promise.resolve(true);
      stat = () =>
        Promise.resolve({
          size: 0,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: null,
        });
    }

    const wrappers = [
      wrapFSAdapter(createMockFSAdapter()),
      new FSAdapterWrapper(new FutureRemoteAdapter() as FSAdapter),
    ];

    for (const wrapper of wrappers) {
      assertEquals(isVirtualFilesystem(wrapper), true);
    }
  });

  it("should classify structural ExtendedFileSystemAdapter implementations as virtual", () => {
    const extendedFs = Object.assign(Object.create(denoAdapter.fs) as typeof denoAdapter.fs, {
      getUnderlyingAdapter: () => createMockFSAdapter(),
      getAdapterType: () => {
        throw new Error("classification must not inspect implementation names");
      },
      isVeryfrontAdapter: () => {
        throw new Error("classification must not invoke adapter capabilities");
      },
      isMultiProjectMode: () => false,
    });

    assertEquals(isVirtualFilesystem(extendedFs), true);
  });

  it("should classify an ordinary local filesystem as non-virtual", () => {
    assertEquals(isVirtualFilesystem(denoAdapter.fs), false);
  });
});

describe("FSAdapterWrapper", () => {
  describe("accessor methods", () => {
    it("getUnderlyingAdapter should return the wrapped FSAdapter", () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertEquals(wrapper.getUnderlyingAdapter(), fsAdapter);
    });

    it("getAdapterType should return constructor name", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      assertEquals(wrapper.getAdapterType(), "Object");
    });

    it("getAdapterType should return class name for class instances", () => {
      class CustomAdapter {
        readFile = () => Promise.resolve("content");
        exists = () => Promise.resolve(true);
        stat = () =>
          Promise.resolve({
            size: 0,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: new Date(),
          });
      }

      const wrapper = new FSAdapterWrapper(new CustomAdapter() as FSAdapter);
      assertEquals(wrapper.getAdapterType(), "CustomAdapter");
    });

    it("isVeryfrontAdapter should return false for non-Veryfront adapters", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      assertEquals(wrapper.isVeryfrontAdapter(), false);
    });

    it("isVeryfrontAdapter should return true for a branded single-project adapter", () => {
      class HostedAdapter {
        readonly [VERYFRONT_FS_ADAPTER_KIND] = "single-project" as const;
        readFile = () => Promise.resolve("content");
        exists = () => Promise.resolve(true);
        stat = () =>
          Promise.resolve({
            size: 0,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: new Date(),
          });
      }

      const wrapper = new FSAdapterWrapper(new HostedAdapter() as FSAdapter);
      assertEquals(wrapper.isVeryfrontAdapter(), true);
    });

    it("isVeryfrontAdapter should return true for a branded multi-project adapter", () => {
      class HostedAdapter {
        readonly [VERYFRONT_FS_ADAPTER_KIND] = "multi-project" as const;
        readFile = () => Promise.resolve("content");
        exists = () => Promise.resolve(true);
        stat = () =>
          Promise.resolve({
            size: 0,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: new Date(),
          });
      }

      const wrapper = new FSAdapterWrapper(new HostedAdapter() as FSAdapter);
      assertEquals(wrapper.isVeryfrontAdapter(), true);
    });

    it("does not trust a constructor name without the internal brand", () => {
      class VeryfrontFSAdapter {
        readFile = () => Promise.resolve("content");
        exists = () => Promise.resolve(true);
        stat = () =>
          Promise.resolve({
            size: 0,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: new Date(),
          });
      }

      const wrapper = new FSAdapterWrapper(new VeryfrontFSAdapter() as FSAdapter);
      assertEquals(wrapper.isVeryfrontAdapter(), false);
    });
  });

  describe("refreshSourceSnapshot", () => {
    it("should not expose refreshSourceSnapshot when the wrapped adapter does not support it", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());

      assertEquals(wrapper.refreshSourceSnapshot, undefined);
    });

    it("should delegate refreshSourceSnapshot to the wrapped adapter", async () => {
      let refreshedReason: string | undefined;
      const fsAdapter = createMockFSAdapter({
        refreshSourceSnapshot(reason?: string) {
          refreshedReason = reason;
          return Promise.resolve();
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      await wrapper.refreshSourceSnapshot?.("review-comment");

      assertEquals(refreshedReason, "review-comment");
    });
  });

  describe("source snapshot freshness", () => {
    it("should delegate freshness checks and snapshot versions", async () => {
      let reason: string | undefined;
      const fsAdapter = {
        ...createMockFSAdapter(),
        ensureSourceSnapshotFresh(value?: string) {
          reason = value;
          return Promise.resolve();
        },
        getSourceSnapshotVersion() {
          return 11;
        },
      };
      const wrapper = new FSAdapterWrapper(fsAdapter);

      await wrapper.ensureSourceSnapshotFresh?.("page-routing");

      assertEquals(reason, "page-routing");
      assertEquals(await wrapper.getSourceSnapshotVersion?.(), 11);
    });

    it("should omit freshness methods when the adapter does not support them", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());

      assertEquals(wrapper.ensureSourceSnapshotFresh, undefined);
      assertEquals(wrapper.getSourceSnapshotVersion, undefined);
    });
  });

  describe("readFile", () => {
    it("should read file using readTextFile if available", async () => {
      const fsAdapter = createMockFSAdapter({
        readTextFile: () => Promise.resolve("text content"),
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const content = await wrapper.readFile("/any.txt");
      assertEquals(content, "text content");
    });

    it("should read file using readFile and decode if readTextFile not available", async () => {
      const fsAdapter = createMockFSAdapter({
        readFile: () => Promise.resolve(new TextEncoder().encode("binary content")),
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const content = await wrapper.readFile("/any.txt");
      assertEquals(content, "binary content");
    });

    it("should return string directly if readFile returns string", async () => {
      const fsAdapter = createMockFSAdapter({
        readFile: () => Promise.resolve("string content"),
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const content = await wrapper.readFile("/any.txt");
      assertEquals(content, "string content");
    });
  });

  describe("readFileBytes", () => {
    it("should return Uint8Array directly if readFile returns bytes", async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const fsAdapter = createMockFSAdapter({
        readFile: () => Promise.resolve(bytes),
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const result = await wrapper.readFileBytes("/any.txt");
      assertEquals(result, bytes);
    });

    it("should encode string to Uint8Array if readFile returns string", async () => {
      const fsAdapter = createMockFSAdapter({
        readFile: () => Promise.resolve("hello"),
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const result = await wrapper.readFileBytes("/any.txt");
      assertEquals(new TextDecoder().decode(result), "hello");
    });
  });

  describe("readFileBytesBounded", () => {
    it("advertises and forwards a genuine underlying bounded-read capability", async () => {
      let received: { path: string; byteLimit: number } | undefined;
      const fsAdapter = createMockFSAdapter({
        readFileBytesBounded(path, byteLimit) {
          received = { path, byteLimit };
          return Promise.resolve(new Uint8Array([1, 2, 3]));
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertEquals(
        [...await wrapper.readFileBytesBounded!("/bounded.bin", 4)],
        [1, 2, 3],
      );
      assertEquals(received, { path: "/bounded.bin", byteLimit: 4 });
    });

    it("does not claim bounded reads when the underlying adapter cannot provide them", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());

      assertEquals(wrapper.readFileBytesBounded, undefined);
    });
  });

  describe("writeFile", () => {
    it("should write file when writeFile is supported", async () => {
      let written: { path: string; content: string } | null = null;
      const fsAdapter = createMockFSAdapter({
        writeFile: (path: string, content: string) => {
          written = { path, content };
          return Promise.resolve();
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      await wrapper.writeFile("/new.txt", "new content");
      assertEquals(written, { path: "/new.txt", content: "new content" });
    });

    it("should throw NotSupportedError when writeFile not available", async () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());

      await assertRejects(() => wrapper.writeFile("/new.txt", "content"), NotSupportedError);
    });
  });

  describe("exists", () => {
    it("should delegate to fsAdapter.exists", async () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());

      assertEquals(await wrapper.exists("/exists.txt"), true);
      assertEquals(await wrapper.exists("/missing.txt"), false);
    });
  });

  describe("stat", () => {
    it("should return FileInfo for file", async () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());

      const stat = await wrapper.stat("/exists.txt");
      assertEquals(stat.isFile, true);
      assertEquals(stat.isDirectory, false);
      assertEquals(stat.size, 7);
    });

    it("should return FileInfo for directory", async () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());

      const stat = await wrapper.stat("/dir");
      assertEquals(stat.isFile, false);
      assertEquals(stat.isDirectory, true);
    });
  });

  describe("readDir", () => {
    it("should yield directory entries using readdir", async () => {
      const fsAdapter = createMockFSAdapter({
        readdir: () =>
          Promise.resolve([
            {
              name: "file1.txt",
              path: "/dir/file1.txt",
              isFile: true,
              isDirectory: false,
              isSymlink: false,
            },
            {
              name: "subdir",
              path: "/dir/subdir",
              isFile: false,
              isDirectory: true,
              isSymlink: false,
            },
          ]),
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const entries: { name: string; isFile: boolean; isDirectory: boolean }[] = [];
      for await (const entry of wrapper.readDir("/dir")) {
        entries.push({ name: entry.name, isFile: entry.isFile, isDirectory: entry.isDirectory });
      }

      assertEquals(entries.length, 2);
      assertEquals(entries[0]?.name, "file1.txt");
      assertEquals(entries[1]?.name, "subdir");
    });

    it("should yield directory entries using readDir if readdir not available", async () => {
      const fsAdapter = createMockFSAdapter({
        readDir: async function* () {
          yield {
            name: "a.txt",
            path: "/dir/a.txt",
            isFile: true,
            isDirectory: false,
            isSymlink: false,
          };
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const entries = [];
      for await (const entry of wrapper.readDir("/dir")) entries.push(entry);

      assertEquals(entries.length, 1);
      assertEquals(entries[0]?.name, "a.txt");
    });

    it("should throw NotSupportedError when neither readdir nor readDir available", async () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());

      await assertRejects(async () => {
        for await (const _entry of wrapper.readDir("/dir")) {
          // consume iterator
        }
      }, NotSupportedError);
    });
  });

  describe("readdir", () => {
    it("should return array of directory entries", async () => {
      const fsAdapter = createMockFSAdapter({
        readdir: () =>
          Promise.resolve([
            {
              name: "file.txt",
              path: "/dir/file.txt",
              isFile: true,
              isDirectory: false,
              isSymlink: false,
            },
          ]),
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const entries = await wrapper.readdir("/dir");
      assertEquals(entries.length, 1);
      assertEquals(entries[0]?.name, "file.txt");
    });
  });

  describe("mkdir", () => {
    it("should create directory when supported", async () => {
      let created: { path: string; options?: { recursive?: boolean } } | null = null;
      const fsAdapter = createMockFSAdapter({
        mkdir: (path: string, options?: { recursive?: boolean }) => {
          created = { path, options };
          return Promise.resolve();
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      await wrapper.mkdir("/newdir", { recursive: true });
      assertEquals(created, { path: "/newdir", options: { recursive: true } });
    });

    it("should throw NotSupportedError when mkdir not available", async () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      await assertRejects(() => wrapper.mkdir("/newdir"), NotSupportedError);
    });
  });

  describe("remove", () => {
    it("should remove when supported", async () => {
      let removed: string | null = null;
      const fsAdapter = createMockFSAdapter({
        remove: (path: string) => {
          removed = path;
          return Promise.resolve();
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      await wrapper.remove("/file.txt");
      assertEquals(removed, "/file.txt");
    });

    it("should throw NotSupportedError when remove not available", async () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      await assertRejects(() => wrapper.remove("/file.txt"), NotSupportedError);
    });
  });

  describe("resolveFile", () => {
    it("should delegate to fsAdapter.resolveFile when available", async () => {
      const fsAdapter = createMockFSAdapter({
        resolveFile: (basePath: string) => Promise.resolve(`${basePath}.tsx`),
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const resolved = await wrapper.resolveFile("/pages/index");
      assertEquals(resolved, "/pages/index.tsx");
    });

    it("should throw NotSupportedError when resolveFile not available", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      assertThrows(() => wrapper.resolveFile("/pages/index"), NotSupportedError);
    });
  });

  describe("makeTempDir", () => {
    it("should throw NotSupportedError (not supported by FSAdapter)", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      assertThrows(() => wrapper.makeTempDir("test"), NotSupportedError);
    });
  });

  describe("watch", () => {
    it("should throw NotSupportedError (not supported by FSAdapter)", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      assertThrows(() => wrapper.watch("/dir"), NotSupportedError);
    });
  });

  describe("shutdown", () => {
    it("should call fsAdapter.shutdown when available", async () => {
      let shutdownCalled = false;
      const fsAdapter = createMockFSAdapter({
        shutdown: () => {
          shutdownCalled = true;
          return Promise.resolve();
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      await wrapper.shutdown();
      assertEquals(shutdownCalled, true);
    });

    it("should do nothing when fsAdapter.shutdown not available", async () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      await wrapper.shutdown();
    });
  });

  describe("contextual operations", () => {
    it("isMultiProjectMode should return true when runWithContext available", () => {
      const fsAdapter = createMockContextualAdapter({
        runWithContext: <T>(_slug: string, _token: string, fn: () => Promise<T>) => fn(),
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertEquals(wrapper.isMultiProjectMode(), true);
    });

    it("isMultiProjectMode should return false when runWithContext not available", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      assertEquals(wrapper.isMultiProjectMode(), false);
    });

    it("isContextualMode should return true when setRequestToken available", () => {
      const fsAdapter = createMockContextualAdapter({
        setRequestToken: () => {},
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertEquals(wrapper.isContextualMode(), true);
    });

    it("setRequestToken should throw when not supported", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      assertThrows(() => wrapper.setRequestToken("token"), NotSupportedError);
    });

    it("clearRequestToken should throw when not supported", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      assertThrows(() => wrapper.clearRequestToken(), NotSupportedError);
    });

    it("setRequestBranch should throw when not supported", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      assertThrows(() => wrapper.setRequestBranch("main"), NotSupportedError);
    });

    it("getRequestBranch should throw when not supported", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      assertThrows(() => wrapper.getRequestBranch(), NotSupportedError);
    });

    it("clearRequestBranch should throw when not supported", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      assertThrows(() => wrapper.clearRequestBranch(), NotSupportedError);
    });

    it("setProductionMode should throw when not supported", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      assertThrows(() => wrapper.setProductionMode(true), NotSupportedError);
    });

    it("runWithContext should throw when not supported", () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());
      assertThrows(
        () => wrapper.runWithContext("slug", "token", () => Promise.resolve("result")),
        NotSupportedError,
      );
    });

    it("style config binding should throw when not supported", async () => {
      const wrapper = new FSAdapterWrapper(createMockContextualAdapter({
        setRequestToken: () => {},
      }));

      await assertRejects(
        () => wrapper.createStyleConfigBinding(),
        NotSupportedError,
        "createStyleConfigBinding",
      );
    });

    it("should delegate source-qualified style config installation", async () => {
      const binding = Object.freeze({
        projectSlug: "project-a",
        sourceKey: "source-a",
        sourceRevision: 3,
      });
      const config = Object.freeze({ tailwind: { stylesheet: "styles/project-a.css" } });
      const calls: unknown[][] = [];
      const fsAdapter = createMockContextualAdapter({
        runWithContext: <T>(_slug: string, _token: string, fn: () => Promise<T>) => fn(),
        createStyleConfigBinding: () => Promise.resolve(binding),
        installStyleConfig: (receivedBinding, receivedConfig) => {
          calls.push([receivedBinding, receivedConfig]);
          return Promise.resolve(true);
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const issuedBinding = await wrapper.createStyleConfigBinding();
      const installed = await wrapper.installStyleConfig(issuedBinding, config);

      assertEquals(issuedBinding, binding);
      assertEquals(installed, true);
      assertEquals(calls, [[binding, config]]);
    });

    it("setRequestToken should delegate when supported", () => {
      let tokenSet: string | null = null;
      const fsAdapter = createMockContextualAdapter({
        setRequestToken: (token: string) => {
          tokenSet = token;
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      wrapper.setRequestToken("my-token");
      assertEquals(tokenSet, "my-token");
    });

    it("runWithContext should delegate when supported", async () => {
      let captured: { slug: string; token: string } | null = null;
      const fsAdapter = createMockContextualAdapter({
        runWithContext: <T>(slug: string, token: string, fn: () => Promise<T>) => {
          captured = { slug, token };
          return fn();
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const result = await wrapper.runWithContext(
        "my-slug",
        "my-token",
        () => Promise.resolve("result"),
      );
      assertEquals(captured, { slug: "my-slug", token: "my-token" });
      assertEquals(result, "result");
    });

    it("readOptionalTextFile should delegate when supported", async () => {
      const calls: string[] = [];
      const fsAdapter = createMockFSAdapter({
        readFile: (path: string) => {
          calls.push(`readFile:${path}`);
          return Promise.resolve("required");
        },
        readOptionalTextFile: (path: string) => {
          calls.push(`readOptionalTextFile:${path}`);
          return Promise.resolve("optional");
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const content = await wrapper.readOptionalTextFile("/globals.css");

      assertEquals(content, "optional");
      assertEquals(calls, ["readOptionalTextFile:/globals.css"]);
    });

    it("readOptionalTextFile should fall back to readFile when unsupported", async () => {
      const wrapper = new FSAdapterWrapper(createMockFSAdapter());

      const content = await wrapper.readOptionalTextFile("/exists.txt");

      assertEquals(content, "content");
    });

    it("runWithContext should preserve adapter binding for production release materialization", async () => {
      const adapter = new MultiProjectFSAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      const wrapper = new FSAdapterWrapper(adapter);
      const originalManager = (adapter as any).manager;
      let getAdapterCalled = false;
      let callbackSawMaterializedAdapter = false;

      (adapter as any).manager = {
        getAdapter() {
          getAdapterCalled = true;
          return Promise.resolve(createMockFSAdapter());
        },
        getStats: () => ({ adapters: 0, stats: [] }),
        dispose: () => {},
      };

      try {
        const result = await wrapper.runWithContext(
          "project-release",
          "test-token",
          async () => {
            callbackSawMaterializedAdapter = getAdapterCalled;
            return "result";
          },
          "project-id-release",
          {
            productionMode: true,
            releaseId: "rel-first-hit",
            environmentName: "production",
          },
        );

        assertEquals(result, "result");
        assertEquals(callbackSawMaterializedAdapter, true);
      } finally {
        (adapter as any).manager = originalManager;
        adapter.dispose();
      }
    });
  });
});
