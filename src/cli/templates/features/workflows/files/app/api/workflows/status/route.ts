export function GET(req: Request): Response {
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("runId");

  if (!runId) {
    return Response.json({ error: "runId is required" }, { status: 400 });
  }

  return Response.json({
    runId,
    status: "completed",
    steps: [
      { name: "fetch", status: "completed" },
      { name: "validate", status: "completed" },
      { name: "transform", status: "completed" },
      { name: "aggregate", status: "completed" },
      { name: "merge", status: "completed" },
      { name: "export", status: "completed" },
    ],
  });
}
