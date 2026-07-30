# `@veryfront/ext-node-websocket-ws`

Explicit Node.js WebSocket transport for Veryfront, backed by the `ws` package.
Core owns request authorization, upgrade correlation, and shutdown. This
extension owns the third-party protocol implementation and publishes the
dependency-free `NodeWebSocketServerProvider` contract.

Install the package and compose it explicitly:

```bash
deno add npm:@veryfront/ext-node-websocket-ws
```

```ts
import { defineConfig } from "veryfront";
import extNodeWebSocketWs from "@veryfront/ext-node-websocket-ws";

export default defineConfig({
  extensions: [extNodeWebSocketWs()],
});
```

Veryfront never auto-loads this package and has no built-in WebSocket fallback.
Without an explicitly registered provider, Node HTTP requests remain available
but Node WebSocket upgrades fail closed with an actionable diagnostic.
