import * as http from 'node:http';
// Helper for Cross-Platform CWD
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
  const port = Number(getEnv("PORT") ?? "8080");
  console.log(`[API] Server listening on http://localhost:${port}`);

  // Node.js specific server setup
  if (typeof process !== 'undefined') {
    http.createServer(async (nodeReq, nodeRes) => {
      const url = `http://${nodeReq.headers.host}${nodeReq.url}`;
      const req = new Request(url, {
        method: nodeReq.method,
        headers: nodeReq.headers as HeadersInit,
        body: nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD' ? nodeReq : undefined,
      });

      const response = await handler(req);

      nodeRes.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (response.body) {
        for await (const chunk of response.body as any) {
          nodeRes.write(chunk);
        }
      }
      nodeRes.end();
    }).listen(port);
  } else {
    // Deno specific server setup
    // @ts-ignore - Deno global
    await Deno.serve(handler, { port });
  }
}
