# `@veryfront/ext-node-websocket-ws`

Default Node.js WebSocket transport for Veryfront, backed by the `ws` package.
Core owns request authorization, upgrade correlation, and shutdown. This
extension owns the third-party protocol implementation and publishes the
dependency-free `NodeWebSocketServerProvider` contract.

The standard `veryfront` npm/CLI distribution installs and auto-activates the
extension, so local HMR works without starter-specific configuration. A custom
Node service distribution must install the package alongside `veryfront`:

```bash
deno add npm:@veryfront/ext-node-websocket-ws
```

Projects can disable the builtin with
`{ name: "ext-node-websocket-ws", enabled: false }`. Without an available
provider, Node HTTP requests remain available but Node WebSocket upgrades fail
closed with an actionable diagnostic. Core never imports `ws` or substitutes a
hidden protocol fallback.
