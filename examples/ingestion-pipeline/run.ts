/**
 * Run Ingestion Pipeline
 * 
 * Executes the ingestion pipeline workflow using local MinIO and Redis.
 */

import "https://deno.land/std@0.220.0/dotenv/load.ts";
import { WorkflowExecutor, RedisBackend, S3BlobStorage, DefaultAgentRegistry, DefaultToolRegistry } from "veryfront/ai/workflow";
import ingestionWorkflow from "./ai/workflows/ingestion.ts";
import processorAgent from "./ai/agents/processor.ts";
import indexerAgent from "./ai/agents/indexer.ts";
import { initializeProviders } from "veryfront/ai";

async function main() {
  console.log("🚀 Starting Ingestion Pipeline Example...");

  // 1. Setup AI Providers
  // In a real app, this would be auto-configured from env vars.
  // Here we explicitly initialize it to ensure it uses the provided key.
  initializeProviders({
    openai: {
      apiKey: Deno.env.get("OPENAI_API_KEY") || "sk-no-key-provided",
    },
  });

  // 2. Setup MinIO Blob Storage
  const blobStorage = new S3BlobStorage({
    region: "us-east-1",
    bucket: "ingest-bucket",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    endpoint: "http://localhost:9000",
    forcePathStyle: true,
    autoCreateBucket: true,
  });

  // 3. Setup Redis Backend
  const backend = new RedisBackend({
    hostname: "localhost",
    port: 6379,
    prefix: "ingest-demo:",
  });
  await backend.initialize();

  // 4. Setup Executor
  // Create registry and then register agents
  const agentRegistry = new DefaultAgentRegistry();
  agentRegistry.registerAgents([processorAgent, indexerAgent]);

  const executor = new WorkflowExecutor({
    backend,
    blobStorage,
    stepExecutor: {
      agentRegistry,
      toolRegistry: new DefaultToolRegistry(), // Add tools if needed
    },
    debug: false, // Set to true for detailed logs
  });

  // 4. Register Workflow
  executor.register(ingestionWorkflow.definition);

  // 5. Generate Test Data
  const rawItems = Array.from({ length: 20 }, (_, i) => 
    `Item ${i}: This is some raw text data that needs processing. Random value: ${Math.random()}`
  );

  console.log(`📥 Ingesting ${rawItems.length} items...`);

  // 6. Start Workflow
  try {
    const handle = await executor.start("ingestion-pipeline", { rawItems });
    console.log(`Workflow Run ID: ${handle.runId}`);
    
    // Wait for completion
    const result = await handle.result();
    console.log("🏁 Result:", result);

  } catch (error) {
    console.error("❌ Workflow execution failed:", error);
  } finally {
    // Cleanup
    await backend.destroy();
  }
}

if (import.meta.main) {
  main();
}
