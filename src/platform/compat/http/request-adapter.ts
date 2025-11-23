import type { NodeIncomingMessage } from "./node-types.ts";

export function convertNodeRequestToWebRequest(
  req: NodeIncomingMessage,
  url: string,
): Request {
  return new Request(url, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: req.method !== "GET" && req.method !== "HEAD" ? (req as unknown as BodyInit) : undefined,
  });
}
