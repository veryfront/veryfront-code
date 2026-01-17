import { workflow, step, map, type BlobRef } from "veryfront/workflow";
import { z } from "zod";
import processorAgent from "../agents/processor.ts";
import saveBlobTool from "../tools/save-blob.ts";
import indexProcessedData from "../tools/index-data.ts";

export default workflow({
  id: "ingestion-pipeline",
  description: "Ingest, process, and index raw data items.",
  
  inputSchema: z.object({
    rawItems: z.array(z.string()),
  }),

  // Define the workflow steps
  steps: ({ input, blobStorage, blob }) => {
    if (!blobStorage) throw new Error("Blob storage required");

    return [
      // 1. Fan-out: Save all raw items to Blob Storage
      map("save-raw-data", {
        items: input.rawItems,
        concurrency: 5,
        processor: step("save-single-item", {
          tool: saveBlobTool
        })
      }),

      // 2. Fan-out: Process each stored blob
      map("process-blobs", {
        // Input comes from previous step (array of BlobRefs)
        items: (ctx) => ctx["save-raw-data"] as BlobRef[],
        concurrency: 3,
        processor: step("process-item", {
          agent: processorAgent,
          // Context input for this step is the single BlobRef from the map iterator
          input: async (ctx) => {
            const ref = ctx.input as BlobRef;
            // Retrieve content using the blob resolver helper
            const text = await blob?.getText(ref); 
            if (!text) throw new Error(`Could not read blob ${ref.id}`);
            
            return `Analyze this data: ${text}`;
          }
        })
      }),

      // 3. Fan-out: Index the results
      map("index-results", {
        items: (ctx) => {
          // Zip original blob refs with their processing results
          const refs = ctx["save-raw-data"] as BlobRef[];
          const results = ctx["process-blobs"] as any[];
          return refs.map((ref, i) => ({
            id: ref.id, 
            analysis: results[i] 
          }));
        },
        concurrency: 5,
        processor: step("index-item", {
          tool: indexProcessedData
        })
      })
    ];
  },

  onComplete: async (result, context) => {
    console.log("\n✅ Pipeline Completed Successfully");
    console.log("Indexed Items:", (context["index-results"] as any[]).length);
  }
});
