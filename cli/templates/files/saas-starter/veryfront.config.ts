import { defineConfig } from "veryfront";
import extNodeWebSocketWs from "@veryfront/ext-node-websocket-ws";

export default defineConfig({
  extensions: [extNodeWebSocketWs()],
});
