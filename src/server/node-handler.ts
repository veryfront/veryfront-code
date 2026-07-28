import { createNodeRequestListener } from "#veryfront/platform/adapters/runtime/node/http-server.ts";

/** Convert a Web API request handler into a Node.js HTTP listener. */
export function toNodeHandler(
  handler: (req: Request) => Promise<Response> | Response,
): (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void {
  return createNodeRequestListener(handler);
}
