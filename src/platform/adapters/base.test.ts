import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
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
} from "./base.ts";

describe("base.ts type exports", () => {
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

      assertEquals(capabilities.typescript, true);
      assertEquals(capabilities.jsx, true);
      assertEquals(capabilities.http2, true);
      assertEquals(capabilities.websocket, true);
      assertEquals(capabilities.workers, true);
      assertEquals(capabilities.fileWatching, true);
      assertEquals(capabilities.shell, true);
      assertEquals(capabilities.kvStore, true);
      assertEquals(capabilities.writableFs, true);
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
      const options: ServeOptions = {
        port: 3000,
        hostname: "localhost",
      };

      assertEquals(options.port, 3000);
      assertEquals(options.hostname, "localhost");
    });

    it("should allow optional fields", () => {
      const options: ServeOptions = {};
      assertEquals(options.port, undefined);
      assertEquals(options.hostname, undefined);
    });
  });

  describe("WatchOptions", () => {
    it("should define watch options structure", () => {
      const options: WatchOptions = {
        recursive: true,
      };

      assertEquals(options.recursive, true);
    });
  });

  describe("Interface shapes", () => {
    it("FileSystemAdapter should require core methods", () => {
      // This test verifies the interface shape at compile time
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
