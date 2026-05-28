export async function POST(
  request: Request,
  context: { params: Record<string, string> },
): Promise<Response> {
  const body = await request.json().catch(() => ({})) as {
    input?: { topic?: string };
  };
  const runId = `run-${Date.now()}`;

  return Response.json({
    success: true,
    runId,
    id: runId,
    workflowId: context.params.workflowId,
    status: "pending",
    input: body.input ?? {},
    createdAt: new Date().toISOString(),
  });
}
