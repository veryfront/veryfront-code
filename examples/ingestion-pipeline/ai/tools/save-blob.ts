import { tool } from "../../../../src/ai/index.ts";
import { z } from "zod";
import type { ToolExecutionContext } from "../../../../src/ai/types/tool.ts";

export default tool({
  id: "save-string-to-blob",
  description: "Save string to blob storage",
  inputSchema: z.string(),
  execute: async (item: string, context?: ToolExecutionContext) => {
    if (!context?.blobStorage) {
      throw new Error("Blob storage not available in tool context. Ensure the workflow is configured with blobStorage.");
    }
    
    const ref = await context.blobStorage.put(item, { 
      mimeType: "text/plain",
      metadata: { type: "raw-ingest" }
    });
    console.log(`[Save] Saved blob ${ref.id}`);
    return ref;
  }
});
