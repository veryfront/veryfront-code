import { serverLogger } from "#veryfront/utils";
import { convertNodeRequestToWebRequest } from "#veryfront/platform/compat/http/request-adapter.ts";
import { writeNodeResponse } from "#veryfront/platform/compat/http/node-server.ts";

/** Convert a Web API request handler into a Node.js HTTP listener. */
export function toNodeHandler(
  handler: (req: Request) => Promise<Response> | Response,
): (
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) => Promise<void> {
  return async (req, res) => {
    try {
      const host = req.headers.host;
      const requestHost = Array.isArray(host) ? host[0] : host;
      const url = new URL(req.url ?? "/", `http://${requestHost ?? "localhost"}`);
      const request = convertNodeRequestToWebRequest(req, url.toString());
      const response = await handler(request);

      if (response.status === 101) return;
      await writeNodeResponse(req, res, response);
    } catch (error) {
      serverLogger.debug("toNodeHandler request failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      if (!res.headersSent && !res.writableEnded) {
        res.statusCode = 500;
        res.statusMessage = "Internal Server Error";
        res.end("Internal Server Error");
      } else if (!res.destroyed) {
        res.destroy();
      }
    }
  };
}
