import { assert, assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { makeTempDir } from "@veryfront/testing/deno-compat";
import { join } from "@veryfront/compat/path";
import { LocalBlobStorage } from "./local-storage.ts";
import { remove, stat } from "@veryfront/compat/fs.ts";

describe("LocalBlobStorage", () => {
  it("put and get text", async () => {
    const testDir = await makeTempDir({ prefix: "vf_blob_test_" });
    const storage = new LocalBlobStorage(testDir);

    try {
      const data = "Hello, Blob!";
      const ref = await storage.put(data, { mimeType: "text/plain" });

      assertExists(ref.id);
      assertEquals(ref.size, new TextEncoder().encode(data).length);
      assertEquals(ref.mimeType, "text/plain");

      const retrieved = await storage.getText(ref.id);
      assertEquals(retrieved, data);
    } finally {
      await remove(testDir, { recursive: true });
    }
  });

  it("put and get bytes", async () => {
    const testDir = await makeTempDir({ prefix: "vf_blob_test_" });
    const storage = new LocalBlobStorage(testDir);

    try {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const ref = await storage.put(data, { mimeType: "application/octet-stream" });

      assertExists(ref.id);
      assertEquals(ref.size, data.length);
      assertEquals(ref.mimeType, "application/octet-stream");

      const retrieved = await storage.getBytes(ref.id);
      assertExists(retrieved);
      // Compare as arrays to handle Buffer vs Uint8Array differences
      assertEquals([...retrieved!], [...data]);
    } finally {
      await remove(testDir, { recursive: true });
    }
  });

  it("put with TTL and cleanup", async () => {
    const testDir = await makeTempDir({ prefix: "vf_blob_test_" });
    let now = Date.now();
    const storage = new LocalBlobStorage(testDir, undefined, {
      now: () => new Date(now),
    });

    try {
      const expiredData = "Expired content";
      const expiredRef = await storage.put(expiredData, { ttl: 1 });
      assertExists(expiredRef.expiresAt);
      assert(expiredRef.expiresAt! <= new Date(now + 2000));

      const validData = "Valid content";
      const validRef = await storage.put(validData, { ttl: 3600 });
      assertExists(validRef.expiresAt);
      assert(validRef.expiresAt! > new Date(now + 3000));

      now += 1500;

      assert(await storage.exists(expiredRef.id));
      assert(await storage.exists(validRef.id));

      await storage.cleanupExpiredBlobs();

      assert(!await storage.exists(expiredRef.id));
      assert(await storage.exists(validRef.id));

      const validStat = await storage.stat(validRef.id);
      assertExists(validStat);
      assertEquals(validStat?.id, validRef.id);
      assertEquals(validStat?.size, new TextEncoder().encode(validData).length);
      assertExists(validStat?.expiresAt);
    } finally {
      await remove(testDir, { recursive: true });
    }
  });

  it("delete existing blob", async () => {
    const testDir = await makeTempDir({ prefix: "vf_blob_test_" });
    const storage = new LocalBlobStorage(testDir);

    try {
      const data = "Data to delete";
      const ref = await storage.put(data);

      assert(await storage.exists(ref.id));
      assertExists(await storage.stat(ref.id));

      await storage.delete(ref.id);

      assert(!await storage.exists(ref.id));
      assertEquals(await storage.stat(ref.id), null);
    } finally {
      await remove(testDir, { recursive: true });
    }
  });

  it("delete non-existent blob (no error)", async () => {
    const testDir = await makeTempDir({ prefix: "vf_blob_test_" });
    const storage = new LocalBlobStorage(testDir);

    try {
      await storage.delete("non-existent-id");
      assert(true, "Delete did not throw for non-existent blob");
    } finally {
      await remove(testDir, { recursive: true });
    }
  });

  it("stat non-existent blob", async () => {
    const testDir = await makeTempDir({ prefix: "vf_blob_test_" });
    const storage = new LocalBlobStorage(testDir);

    try {
      assertEquals(await storage.stat("non-existent-id"), null);
    } finally {
      await remove(testDir, { recursive: true });
    }
  });

  it("exists non-existent blob", async () => {
    const testDir = await makeTempDir({ prefix: "vf_blob_test_" });
    const storage = new LocalBlobStorage(testDir);

    try {
      assert(!await storage.exists("non-existent-id"));
    } finally {
      await remove(testDir, { recursive: true });
    }
  });

  it("rootDir is created if not exists", async () => {
    const parentDir = await makeTempDir({ prefix: "vf_blob_test_root_" });
    const nonExistentDir = join(parentDir, "sub_dir");
    const storage = new LocalBlobStorage(nonExistentDir);

    try {
      const data = "Initial data";
      const ref = await storage.put(data);
      assert(await storage.exists(ref.id), "Blob should exist after put");
      const statResult = await stat(nonExistentDir);
      assert(statResult.isDirectory, "Root directory should be created");
    } finally {
      await remove(parentDir, { recursive: true });
    }
  });

  it("getStream", async () => {
    const testDir = await makeTempDir({ prefix: "vf_blob_test_" });
    const storage = new LocalBlobStorage(testDir);

    try {
      const data = "Stream me this content.";
      const ref = await storage.put(data, { mimeType: "text/plain" });

      const stream = await storage.getStream(ref.id);
      assertExists(stream);

      const reader = stream!.getReader();
      let receivedData = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedData += new TextDecoder().decode(value);
      }
      assertEquals(receivedData, data);
    } finally {
      await remove(testDir, { recursive: true });
    }
  });

  it("put with ReadableStream", async () => {
    const testDir = await makeTempDir({ prefix: "vf_blob_test_" });
    const storage = new LocalBlobStorage(testDir);

    try {
      const textEncoder = new TextEncoder();
      const chunks = ["hello", " ", "world"];
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(textEncoder.encode(chunk));
          }
          controller.close();
        },
      });

      const ref = await storage.put(stream, { mimeType: "text/plain" });
      assertExists(ref.id);
      assertEquals(ref.size, textEncoder.encode(chunks.join("")).length);

      const retrieved = await storage.getText(ref.id);
      assertEquals(retrieved, chunks.join(""));
    } finally {
      await remove(testDir, { recursive: true });
    }
  });
});
