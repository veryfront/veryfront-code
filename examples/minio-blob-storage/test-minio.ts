/**
 * Test script for MinIO Blob Storage
 *
 * This script attempts to connect to a local MinIO instance
 * and perform basic blob operations.
 *
 * Prerequisites:
 * 1. Run `docker-compose up -d` in this directory to start MinIO.
 * 2. Login to http://localhost:9001 (minioadmin/minioadmin) and create a bucket named 'test-bucket'.
 */

import { S3BlobStorage } from "veryfront/workflow/blob";

async function main() {
  console.log("Initializing S3BlobStorage for MinIO...");

  const storage = new S3BlobStorage({
    region: "us-east-1", // MinIO default region
    bucket: "test-bucket",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    endpoint: "http://localhost:9000",
    forcePathStyle: true,
    autoCreateBucket: true, // Auto-create 'test-bucket' if it doesn't exist
  });

  try {
    const testContent = "Hello from Veryfront MinIO Test!";
    console.log("Putting blob...");
    
    const ref = await storage.put(testContent, {
      mimeType: "text/plain",
      metadata: { source: "test-script" },
    });

    console.log(`Blob stored successfully! ID: ${ref.id}`);
    console.log(`Size: ${ref.size} bytes`);

    console.log("Retrieving blob...");
    const retrieved = await storage.getText(ref.id);

    if (retrieved === testContent) {
      console.log("SUCCESS: Retrieved content matches original.");
    } else {
      console.error("FAILURE: Content mismatch.");
      console.error("Original:", testContent);
      console.error("Retrieved:", retrieved);
    }

    // Clean up
    console.log("Deleting blob...");
    await storage.delete(ref.id);
    console.log("Blob deleted.");

  } catch (error) {
    console.error("\nError performing MinIO operations:");
    console.error(error);
    console.error("\nTroubleshooting:");
    console.error("1. Is MinIO running? (docker-compose ps)");
    console.error("2. If autoCreateBucket failed, check MinIO logs.");
    console.error("3. If you see DNS errors (e.g. test-bucket.localhost), the S3 client might be trying virtual-hosted style access.");
  }
}

if (import.meta.main) {
  main();
}
