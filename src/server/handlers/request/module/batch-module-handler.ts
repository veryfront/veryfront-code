import type { HandlerResult } from "../../types.ts";
import { HTTP_GONE, HTTP_METHOD_NOT_ALLOWED } from "#veryfront/utils/constants/index.ts";

export function handleBatchModuleEndpoint(
  req: Request,
  respond: (response: Response) => HandlerResult,
): Promise<HandlerResult> {
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return Promise.resolve(
      respond(
        new Response("Method not allowed", {
          status: HTTP_METHOD_NOT_ALLOWED,
          headers: {
            "Allow": "GET, HEAD",
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=utf-8",
          },
        }),
      ),
    );
  }

  const body = method === "HEAD" ? null : "Module batch endpoint has been removed";
  return Promise.resolve(
    respond(
      new Response(body, {
        status: HTTP_GONE,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
        },
      }),
    ),
  );
}
