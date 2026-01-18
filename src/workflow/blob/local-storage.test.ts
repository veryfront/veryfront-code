import { assert, assertEquals, assertExists } from "@std/assert";
import { LocalBlobStorage } from "./local-storage.ts";
import { join } from "@std/path";

// Helper function to replace std's remove
async function remove(path: string, options?: { recursive?: boolean }): Promise<void> {
  await Deno.remove(path, options);
}

Deno.test("LocalBlobStorage - put and get text", async () => {
  const testDir = await Deno.makeTempDir({ prefix: "vf_blob_test_" });
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

Deno.test("LocalBlobStorage - put and get bytes", async () => {
  const testDir = await Deno.makeTempDir({ prefix: "vf_blob_test_" });
  const storage = new LocalBlobStorage(testDir);

  try {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const ref = await storage.put(data, { mimeType: "application/octet-stream" });

    assertExists(ref.id);
    assertEquals(ref.size, data.length);
    assertEquals(ref.mimeType, "application/octet-stream");

    const retrieved = await storage.getBytes(ref.id);
    assertEquals(retrieved, data);
  } finally {
    await remove(testDir, { recursive: true });
  }
});

Deno.test("LocalBlobStorage - put with TTL and cleanup", async () => {
  const testDir = await Deno.makeTempDir({ prefix: "vf_blob_test_" });
  const storage = new LocalBlobStorage(testDir);

  try {
    // Put an expired blob
    const expiredData = "Expired content";
    const expiredRef = await storage.put(expiredData, { ttl: 1 }); // 1 second TTL
    assertExists(expiredRef.expiresAt);
    // Use <= since expiresAt = createdAt + ttl*1000, and createdAt ≈ Date.now()
    assert(expiredRef.expiresAt! <= new Date(Date.now() + 2000));

    // Put a non-expired blob
    const validData = "Valid content";
    const validRef = await storage.put(validData, { ttl: 3600 }); // 1 hour TTL
    assertExists(validRef.expiresAt);
    assert(validRef.expiresAt! > new Date(Date.now() + 3000)); // Should be > 3 seconds from now

    // Wait for expired blob to actually expire
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Before cleanup, expired blob should still exist
    assert(await storage.exists(expiredRef.id));
    assert(await storage.exists(validRef.id));

    await storage.cleanupExpiredBlobs();

    // After cleanup, expired blob should be gone, valid one should remain
    assert(!await storage.exists(expiredRef.id));
    assert(await storage.exists(validRef.id));

    // Check stat for valid blob
    const validStat = await storage.stat(validRef.id);
    assertExists(validStat);
    assertEquals(validStat?.id, validRef.id);
    assertEquals(validStat?.size, new TextEncoder().encode(validData).length);
    assertExists(validStat?.expiresAt);
  } finally {
    await remove(testDir, { recursive: true });
  }
});

Deno.test("LocalBlobStorage - delete existing blob", async () => {
  const testDir = await Deno.makeTempDir({ prefix: "vf_blob_test_" });
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

Deno.test("LocalBlobStorage - delete non-existent blob (no error)", async () => {
  const testDir = await Deno.makeTempDir({ prefix: "vf_blob_test_" });
  const storage = new LocalBlobStorage(testDir);

  try {
    // Should not throw an error
    await storage.delete("non-existent-id");
    assert(true, "Delete did not throw for non-existent blob");
  } finally {
    await remove(testDir, { recursive: true });
  }
});

Deno.test("LocalBlobStorage - stat non-existent blob", async () => {
  const testDir = await Deno.makeTempDir({ prefix: "vf_blob_test_" });
  const storage = new LocalBlobStorage(testDir);

  try {
    assertEquals(await storage.stat("non-existent-id"), null);
  } finally {
    await remove(testDir, { recursive: true });
  }
});

Deno.test("LocalBlobStorage - exists non-existent blob", async () => {
  const testDir = await Deno.makeTempDir({ prefix: "vf_blob_test_" });
  const storage = new LocalBlobStorage(testDir);

  try {
    assert(!await storage.exists("non-existent-id"));
  } finally {
    await remove(testDir, { recursive: true });
  }
});

Deno.test("LocalBlobStorage - rootDir is created if not exists", async () => {
  const nonExistentDir = join(Deno.makeTempDirSync({ prefix: "vf_blob_test_root_" }), "sub_dir");
  const storage = new LocalBlobStorage(nonExistentDir);

  try {
    const data = "Initial data";
    const ref = await storage.put(data);
    // Verify the blob exists using the returned reference ID
    assert(await storage.exists(ref.id), "Blob should exist after put");
    const statResult = await Deno.stat(nonExistentDir);
    assert(statResult.isDirectory, "Root directory should be created");
  } finally {
    await remove(nonExistentDir, { recursive: true });
  }
});

Deno.test("LocalBlobStorage - getStream", async () => {
  const testDir = await Deno.makeTempDir({ prefix: "vf_blob_test_" });
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

Deno.test("LocalBlobStorage - put with ReadableStream", async () => {
  const testDir = await Deno.makeTempDir({ prefix: "vf_blob_test_" });
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
