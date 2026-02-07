/**
 * Run Ingestion Pipeline
 * 
 * Executes the ingestion pipeline workflow using local MinIO and Redis.
 */

// Helper for Cross-Platform Compatibility (Deno/Node)
function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== 'undefined') {
    // @ts-ignore - Deno global
    return Deno.env.get(key);
  }
  // @ts-ignore - process global
  else if (typeof process !== 'undefined' && process.env) {
    // @ts-ignore - process global
    return process.env[key];
  }
  return undefined;
}

/**
 * Run Ingestion Pipeline
 * 
 * Executes the ingestion pipeline workflow using local MinIO and Redis.
 */

import { RedisBackend } from "veryfront/workflow";
import { WorkflowExecutor } from "veryfront/workflow/executor";
import { DefaultAgentRegistry, DefaultToolRegistry } from "veryfront/workflow/runtime";
import { S3BlobStorage } from "veryfront/workflow/blob";
import ingestionWorkflow from "./ai/workflows/ingestion.ts";
import processorAgent from "./ai/agents/processor.ts";
import indexerAgent from "./ai/agents/indexer.ts";
import { initializeProviders } from "veryfront/provider";

async function main() {
  console.log("🚀 Starting Ingestion Pipeline Example...");

  // 1. Setup AI Providers
  // In a real app, this would be auto-configured from env vars.
  // Here we explicitly initialize it to ensure it uses the provided key.
  initializeProviders({
    openai: {
      apiKey: getEnv("OPENAI_API_KEY") || "sk-no-key-provided",
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
