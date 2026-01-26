import * as dntShim from "../../../../_dnt.shims.js";
import type { NodeIncomingMessage } from "./node-types.js";

export function convertNodeRequestToWebRequest(
  req: NodeIncomingMessage,
  url: string,
): dntShim.Request {
  const method = req.method;

  return new dntShim.Request(url, {
    method,
    headers: req.headers as dntShim.HeadersInit,
    body: method !== "GET" && method !== "HEAD" ? (req as unknown as dntShim.BodyInit) : undefined,
  });
}
