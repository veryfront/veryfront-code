import { isDeno } from "../runtime.ts";
import type { HttpServer } from "./types.ts";
import { DenoHttpServer } from "./deno-server.ts";
import { NodeHttpServer } from "./node-server.ts";

export function createHttpServer(): HttpServer {
  if (isDeno) {
    return new DenoHttpServer();
  } else {
    return new NodeHttpServer();
  }
}
