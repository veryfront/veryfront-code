import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  activeDocumentPaths,
  buildChunkFilePaths,
  documentPartsMetadata,
  metadataWriteOutcome,
  readPartPaths,
  retiredDocumentPaths,
  retireDocumentParts,
} from "./document-parts.ts";

describe("Cloud RAG document part state", () => {
  it("allocates a new file after each complete API batch while retaining extensions", () => {
    assertEquals(buildChunkFilePaths("document.txt", 500), ["document.txt"]);
    assertEquals(buildChunkFilePaths("document.txt", 1001), [
      "document.txt",
      "document.part-1.txt",
      "document.part-2.txt",
    ]);
    assertEquals(buildChunkFilePaths("document", 501), ["document", "document.part-1"]);
    assertEquals(buildChunkFilePaths("document.txt", 0), []);
  });
  it("reads only usable unique path metadata", () => {
    assertEquals(readPartPaths(undefined), []);
    assertEquals(readPartPaths(["part", "", null, "part", 1, "  "]), ["part"]);
  });
  it("preserves legacy single-file records and separates active and obsolete parts", () => {
    assertEquals(activeDocumentPaths({}, "legacy.txt"), ["legacy.txt"]);
    assertEquals(activeDocumentPaths({ filePath: "recorded.txt" }, "legacy.txt"), ["recorded.txt"]);
    const document = {
      filePath: "old.txt",
      filePaths: ["active.txt", "active.txt"],
      cleanupFilePaths: ["old.txt", "active.txt", "old.txt"],
    };
    assertEquals(activeDocumentPaths(document, "fallback"), ["active.txt"]);
    assertEquals(retiredDocumentPaths(document, "fallback"), ["old.txt"]);
    assertEquals(retiredDocumentPaths({}, "fallback"), []);
  });
  it("persists recoverable cleanup state with the replacement without retiring active parts", () => {
    assertEquals(documentPartsMetadata(["active"], []), { filePath: "active" });
    assertEquals(documentPartsMetadata(["active", "part-1"], ["old", "old", "active"]), {
      filePath: "active",
      filePaths: ["active", "part-1"],
      cleanupFilePaths: ["old"],
    });
    assertThrows(() => documentPartsMetadata([], []), Error, "no file parts");
  });
  it("accepts authoritative committed paths despite a failed acknowledgement", () => {
    assertEquals(metadataWriteOutcome(["a", "b"], ["b", "a"], 504), "committed");
    assertEquals(metadataWriteOutcome(["a"], ["a"], undefined), "committed");
  });
  it("requires an observed noncommit and definitive client rejection before rollback", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      assertEquals(metadataWriteOutcome(["new"], ["old"], status), "rejected");
      assertEquals(metadataWriteOutcome(["new"], undefined, status), "unknown");
    }
    for (const status of [undefined, null, "400", 200, 408, 500, 502, 503, 504]) {
      assertEquals(metadataWriteOutcome(["new"], ["old"], status), "unknown");
    }
  });
  it("attempts each obsolete part once and returns only failures for durable retry", async () => {
    const calls: string[] = [];
    const failure = new Error("Unavailable");
    const failed = await retireDocumentParts(["one", "two", "one", "three"], (path) => {
      calls.push(path);
      return path === "one" ? Promise.reject(failure) : Promise.resolve();
    });
    assertEquals(calls, ["one", "two", "three"]);
    assertEquals(failed, [{ path: "one", error: failure }]);
    assertEquals(await retireDocumentParts([], () => Promise.resolve()), []);
  });
});
