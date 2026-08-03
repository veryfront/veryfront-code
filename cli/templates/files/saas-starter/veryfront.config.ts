import { defineConfig } from "veryfront";
import extTailwind from "@veryfront/ext-css-tailwind";
import extNodeWebSocketWs from "@veryfront/ext-node-websocket-ws";

export default defineConfig({
  extensions: [extTailwind(), extNodeWebSocketWs()],
});
