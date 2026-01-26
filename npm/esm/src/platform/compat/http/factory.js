import { isDeno } from "../runtime.js";
import { DenoHttpServer } from "./deno-server.js";
import { NodeHttpServer } from "./node-server.js";
export function createHttpServer() {
    return isDeno ? new DenoHttpServer() : new NodeHttpServer();
}
