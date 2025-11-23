import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { cancelRun, createRun, getRun } from "./agent_runtime.ts";

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // POST /runs -> Create Run
  if (req.method === "POST" && url.pathname === "/runs") {
    try {
      const body = await req.json().catch(() => ({}));
      const agentId = body.agentId ?? "default";
      const input = body.input;

      if (!input) {
        return Response.json({ error: "input required" }, { status: 400 });
      }

      const run = await createRun(agentId, input);
      return Response.json({ runId: run.id }, { status: 202 });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  }

  // Match /runs/:id or /runs/:id/cancel
  const match = url.pathname.match(/^\/runs\/([^/]+)(\/cancel)?$/);
  if (match) {
    const runId = match[1]!;
    const isCancel = Boolean(match[2]);

    // GET /runs/:id
    if (req.method === "GET" && !isCancel) {
      const run = await getRun(runId);
      if (!run) {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      return Response.json(run);
    }

    // POST /runs/:id/cancel
    if (req.method === "POST" && isCancel) {
      await cancelRun(runId);
      return Response.json({ cancelled: true });
    }
  }

  return new Response("Not found", { status: 404 });
}

if (import.meta.main) {
  const port = Number(Deno.env.get("PORT") ?? "8080");
  console.log(`[API] Server listening on http://localhost:${port}`);
  await serve(handler, { port });
}
