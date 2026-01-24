import { dataProcessingPipeline } from "../../../../workflows/index.ts";

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const sourceUrl = body?.sourceUrl;

    if (!sourceUrl) {
      return Response.json({ error: "sourceUrl is required" }, { status: 400 });
    }

    const runId = crypto.randomUUID();

    console.log(
      `Starting workflow ${dataProcessingPipeline.id} with run ID: ${runId}`,
    );

    return Response.json({
      success: true,
      runId,
      workflow: dataProcessingPipeline.id,
      status: "pending",
    });
  } catch {
    return Response.json({ error: "Failed to start workflow" }, { status: 500 });
  }
}
