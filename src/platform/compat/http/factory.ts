import { isDeno } from "../runtime.ts";
import { DenoHttpServer } from "./deno-server.ts";
import { NodeHttpServer } from "./node-server.ts";
import type { HttpServer } from "./types.ts";

export function createHttpServer(): HttpServer {
  if (isDeno) {
    return new DenoHttpServer();
  }

  return new NodeHttpServer();
}
