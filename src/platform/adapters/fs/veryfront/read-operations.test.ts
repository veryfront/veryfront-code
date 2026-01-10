import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { ReadOperations } from "./read-operations.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { FileCache } from "../cache/file-cache.ts";

describe("ReadOperations", () => {
  describe("class", () => {
    it("should export ReadOperations class", () => {
      assertExists(ReadOperations);
      assertEquals(typeof ReadOperations, "function");
    });
  });

  describe("instance", () => {
    // Create minimal mock objects for testing class structure
    const mockClient = {
      getRequestBranch: () => "main",
      getFileContent: () => Promise.resolve("file content"),
      getPublishedFileContent: () => Promise.resolve("published content"),
    } as any;
    const cache = new FileCache({ enabled: true, ttl: 1000, maxSize: 100 });
    const normalizer = new PathNormalizer();

    it("should be instantiable without production context", () => {
      const readOps = new ReadOperations(mockClient, cache, normalizer);
      assertExists(readOps);
    });

    it("should be instantiable with production context", () => {
      const productionContext = {
        isProductionMode: () => false,
        getReleaseId: () => null,
      };
      const readOps = new ReadOperations(mockClient, cache, normalizer, productionContext);
      assertExists(readOps);
    });

    it("should be instantiable with path resolver", () => {
      const productionContext = {
        isProductionMode: () => false,
        getReleaseId: () => null,
      };
      const pathResolver = (path: string) => path;
      const readOps = new ReadOperations(
        mockClient,
        cache,
        normalizer,
        productionContext,
        pathResolver,
      );
      assertExists(readOps);
    });

    it("should have readFile method", () => {
      const readOps = new ReadOperations(mockClient, cache, normalizer);
      assertExists(readOps.readFile);
      assertEquals(typeof readOps.readFile, "function");
    });

    it("should have readTextFile method", () => {
      const readOps = new ReadOperations(mockClient, cache, normalizer);
      assertExists(readOps.readTextFile);
      assertEquals(typeof readOps.readTextFile, "function");
    });
  });
});
