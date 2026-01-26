import { isDeno } from "../runtime.js";
import { DenoHttpServer } from "./deno-server.js";
import { NodeHttpServer } from "./node-server.js";
import type { HttpServer } from "./types.js";

export function createHttpServer(): HttpServer {
  return isDeno ? new DenoHttpServer() : new NodeHttpServer();
}
