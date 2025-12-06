import { dataProcessingPipeline } from "../../../../workflows/index.ts";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sourceUrl, options: _options } = body;

    if (!sourceUrl) {
      return Response.json({ error: "sourceUrl is required" }, { status: 400 });
    }

    // Start the workflow
    const runId = crypto.randomUUID();

    // In a real implementation, this would start the workflow asynchronously
    // and return the run ID for status polling
    console.log(`Starting workflow ${dataProcessingPipeline.id} with run ID: ${runId}`);

    return Response.json({
      success: true,
      runId,
      workflow: dataProcessingPipeline.id,
      status: "pending",
    });
  } catch (_error) {
    return Response.json({ error: "Failed to start workflow" }, { status: 500 });
  }
}
