import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createWebSocketUpgradeResponse, isWebSocketUpgradeResponse } from "./base.ts";
import type {
  DirEntry,
  EnvironmentAdapter,
  FileChangeEvent,
  FileChangeKind,
  FileInfo,
  FileSystemAdapter,
  KVStoreAdapter,
  RuntimeCapabilities,
  RuntimeId,
  ServeOptions,
  ServerAdapter,
  ShellAdapter,
  WatchOptions,
  WebSocketUpgradeResponse,
} from "./base.ts";

describe("base.ts type exports", () => {
  describe("WebSocketUpgradeResponse", () => {
    it("models upgrade responses without constructing a DOM Response", () => {
      const response = createWebSocketUpgradeResponse({
        headers: { upgrade: "websocket" },
      });

      assertEquals(response.status, 101);
      assertEquals(response.statusText, "Switching Protocols");
      assertEquals(response.body, null);
      assertEquals(response.headers.get("upgrade"), "websocket");
      assertEquals(response instanceof Response, false);
      assertEquals(isWebSocketUpgradeResponse(response), true);
      assertEquals(isWebSocketUpgradeResponse(new Response()), false);
    });

    it("accepts the public structural upgrade-response contract", () => {
      const response: WebSocketUpgradeResponse = {
        kind: "websocket-upgrade",
        status: 101,
        statusText: "Switching Protocols",
        headers: new Headers({ upgrade: "websocket" }),
        body: null,
      };

      assertEquals(isWebSocketUpgradeResponse(response), true);
    });

    it("recognizes upgrade signals created by another module instance", async () => {
      const duplicate = await import("./base.ts?websocket-upgrade-duplicate");
      const response = createWebSocketUpgradeResponse();

      assertEquals(duplicate.isWebSocketUpgradeResponse(response), true);
    });

    it("does not invoke accessors while identifying an upgrade response", () => {
      let accessorReads = 0;
      const value = Object.defineProperties({}, {
        kind: {
          enumerable: true,
          get() {
            accessorReads++;
            return "websocket-upgrade";
          },
        },
        status: { enumerable: true, value: 101 },
      });

      assertEquals(isWebSocketUpgradeResponse(value), false);
      assertEquals(accessorReads, 0);
    });

    it("short-circuits a mismatched kind before inspecting other fields", () => {
      let otherFieldReads = 0;
      const value = new Proxy({}, {
        getOwnPropertyDescriptor(_target, key) {
          if (key === "kind") {
            return {
              configurable: true,
              value: "http-response",
            };
          }
          otherFieldReads++;
          throw new Error("non-upgrade fields must not be inspected");
        },
      });

      assertEquals(isWebSocketUpgradeResponse(value), false);
      assertEquals(otherFieldReads, 0);
    });

    it("bounds prototype traversal when a Proxy returns fresh prototypes", () => {
      let descriptorReads = 0;
      let prototypeReads = 0;
      const createFreshPrototype = (): object =>
        new Proxy({}, {
          getOwnPropertyDescriptor() {
            descriptorReads++;
            return undefined;
          },
          getPrototypeOf() {
            prototypeReads++;
            return createFreshPrototype();
          },
        });

      assertEquals(isWebSocketUpgradeResponse(createFreshPrototype()), false);
      assertEquals(descriptorReads, 16);
      assertEquals(prototypeReads, 16);
    });

    it("rejects incomplete structural upgrade signals", () => {
      const incomplete = {
        kind: "websocket-upgrade",
        status: 101,
      };

      assertEquals(isWebSocketUpgradeResponse(incomplete), false);
    });
  });

  describe("RuntimeId", () => {
    it("should accept valid runtime identifiers", () => {
      const ids: RuntimeId[] = ["deno", "node", "bun", "cloudflare", "memory"];
      assertEquals(ids.length, 5);
    });
  });

  describe("RuntimeCapabilities", () => {
    it("should define all capability flags", () => {
      const capabilities: RuntimeCapabilities = {
        typescript: true,
        jsx: true,
        http2: true,
        websocket: true,
        workers: true,
        fileWatching: true,
        shell: true,
        kvStore: true,
        writableFs: true,
      };

      assertEquals(capabilities, {
        typescript: true,
        jsx: true,
        http2: true,
        websocket: true,
        workers: true,
        fileWatching: true,
        shell: true,
        kvStore: true,
        writableFs: true,
      });
    });
  });

  describe("FileInfo", () => {
    it("should define file information structure", () => {
      const fileInfo: FileInfo = {
        size: 1024,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        mtime: new Date(),
      };

      assertEquals(fileInfo.size, 1024);
      assertEquals(fileInfo.isFile, true);
      assertEquals(fileInfo.isDirectory, false);
      assertExists(fileInfo.mtime);
    });

    it("should allow null mtime", () => {
      const fileInfo: FileInfo = {
        size: 0,
        isFile: false,
        isDirectory: true,
        isSymlink: false,
        mtime: null,
      };

      assertEquals(fileInfo.mtime, null);
    });
  });

  describe("DirEntry", () => {
    it("should define directory entry structure", () => {
      const entry: DirEntry = {
        name: "file.txt",
        isFile: true,
        isDirectory: false,
        isSymlink: false,
      };

      assertEquals(entry.name, "file.txt");
      assertEquals(entry.isFile, true);
    });
  });

  describe("FileChangeKind", () => {
    it("should accept valid change kinds", () => {
      const kinds: FileChangeKind[] = ["create", "modify", "delete", "any"];
      assertEquals(kinds.length, 4);
    });
  });

  describe("FileChangeEvent", () => {
    it("should define change event structure", () => {
      const event: FileChangeEvent = {
        kind: "modify",
        paths: ["/path/to/file.ts"],
      };

      assertEquals(event.kind, "modify");
      assertEquals(event.paths.length, 1);
    });
  });

  describe("ServeOptions", () => {
    it("should define serve options structure", () => {
      const options: ServeOptions = { port: 3000, hostname: "localhost" };
      assertEquals(options, { port: 3000, hostname: "localhost" });
    });

    it("should allow optional fields", () => {
      const options: ServeOptions = {};
      assertEquals(options, {});
    });
  });

  describe("WatchOptions", () => {
    it("should define watch options structure", () => {
      const options: WatchOptions = { recursive: true };
      assertEquals(options.recursive, true);
    });
  });

  describe("Interface shapes", () => {
    it("FileSystemAdapter should require core methods", () => {
      const mockFs: FileSystemAdapter = {
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
        watch: () => ({
          close: () => {},
          [Symbol.asyncIterator]: async function* () {},
        }),
      };

      assertExists(mockFs.readFile);
      assertExists(mockFs.writeFile);
      assertExists(mockFs.exists);
    });

    it("EnvironmentAdapter should require get, set, toObject", () => {
      const mockEnv: EnvironmentAdapter = {
        get: () => undefined,
        set: () => {},
        toObject: () => ({}),
      };

      assertExists(mockEnv.get);
      assertExists(mockEnv.set);
      assertExists(mockEnv.toObject);
    });

    it("ServerAdapter should require upgradeWebSocket", () => {
      const mockServer: ServerAdapter = {
        upgradeWebSocket: () => ({
          socket: {} as WebSocket,
          response: new Response(),
        }),
      };

      assertExists(mockServer.upgradeWebSocket);
    });

    it("ShellAdapter should require sync methods", () => {
      const mockShell: ShellAdapter = {
        statSync: () => ({ isFile: true, isDirectory: false }),
        readFileSync: () => "",
      };

      assertExists(mockShell.statSync);
      assertExists(mockShell.readFileSync);
    });

    it("KVStoreAdapter should require async CRUD methods", () => {
      const mockKV: KVStoreAdapter = {
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        list: async function* () {},
      };

      assertExists(mockKV.get);
      assertExists(mockKV.set);
      assertExists(mockKV.delete);
      assertExists(mockKV.list);
    });
  });
});
