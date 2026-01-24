import { isDeno } from "../runtime.ts";
import { DenoHttpServer } from "./deno-server.ts";
import { NodeHttpServer } from "./node-server.ts";
import type { HttpServer } from "./types.ts";

export function createHttpServer(): HttpServer {
  return isDeno ? new DenoHttpServer() : new NodeHttpServer();
}
