import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { S3BlobStorage } from "./s3-storage.ts";

function createStorage(): S3BlobStorage {
  return new S3BlobStorage({
    region: "test-region",
    bucket: "test-bucket",
    accessKeyId: "<ACCESS_KEY_ID>",
    secretAccessKey: "<SECRET_ACCESS_KEY>",
  });
}

describe("S3BlobStorage", () => {
  it("rejects unsafe IDs on every public ID operation", async () => {
    const storage = createStorage();
    const operations = [
      () => storage.put("data", { id: "../unsafe" }),
      () => storage.getStream("../unsafe"),
      () => storage.getText("../unsafe"),
      () => storage.getBytes("../unsafe"),
      () => storage.delete("../unsafe"),
      () => storage.exists("../unsafe"),
      () => storage.stat("../unsafe"),
    ];

    for (const operation of operations) {
      await assertRejects(operation, Error, "Invalid blob id");
    }

    const internals = storage as unknown as {
      client: unknown;
      initPromise: unknown;
    };
    assertEquals(internals.client, null);
    assertEquals(internals.initPromise, null);
  });
});
