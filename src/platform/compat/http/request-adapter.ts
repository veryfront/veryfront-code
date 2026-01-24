import type { NodeIncomingMessage } from "./node-types.ts";

export function convertNodeRequestToWebRequest(
  req: NodeIncomingMessage,
  url: string,
): Request {
  const method = req.method;

  return new Request(url, {
    method,
    headers: req.headers as HeadersInit,
    body: method !== "GET" && method !== "HEAD" ? (req as unknown as BodyInit) : undefined,
  });
}
