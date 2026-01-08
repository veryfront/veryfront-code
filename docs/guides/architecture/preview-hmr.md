# Preview HMR (Hot Module Replacement)

Live updates for cloud preview environments without full page reloads.

## Overview

Preview HMR enables real-time code updates in cloud preview environments (e.g., `myapp.preview.veryfront.com`). When a file is saved in Studio, the browser updates without a full page reload.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         API Server                               │
│         (broadcasts "poke" with changedPaths to renderers)       │
└──────────────────────────────┬──────────────────────────────────┘
                               │ WebSocket (per-project events)
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
   │  Renderer 1  │     │  Renderer 2  │     │  Renderer 3  │
   │ (subscribes) │     │ (subscribes) │     │ (subscribes) │
   └──────┬───────┘     └──────┬───────┘     └──────────────┘
          │                    │
          ▼                    ▼
   ┌──────────────┐     ┌──────────────┐
   │  Browser A   │     │  Browser B   │
   │   (HMR WS)   │     │   (HMR WS)   │
   └──────────────┘     └──────────────┘
```

## Request Flow

### HTTP Requests vs WebSocket Connections

The proxy handles HTTP and WebSocket differently:

**HTTP Requests:**
```
Browser → Proxy → Renderer → Response
         (fetch)
```
- Standard request/response cycle
- Load balanced across replicas
- Each request can hit any replica

**WebSocket Connections:**
```
Browser ←──────────────────→ Proxy ←──────────────────→ Renderer
         (persistent WS)            (persistent WS)
```
- Persistent bidirectional connection
- Stays connected to same replica for lifetime
- Proxy bridges client and renderer WebSockets

### HMR Update Flow

1. **User saves file** in Studio
2. **API persists** the file and broadcasts "poke" to all renderers
3. **All renderer replicas** receive the poke (they all subscribe to project events)
4. **Each replica** clears its cache and broadcasts HMR update to connected browsers
5. **Browser** receives update and applies it without full reload

## Components

### Proxy WebSocket Handler (`proxy/main.ts`)

Detects WebSocket upgrades and creates a bridge:

```typescript
if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
  // 1. Upgrade client connection
  const { socket: clientSocket, response } = Deno.upgradeWebSocket(req);

  // 2. Connect to renderer
  const rendererSocket = new WebSocket(rendererWsUrl);

  // 3. Bridge messages bidirectionally
  clientSocket.onmessage = (e) => rendererSocket.send(e.data);
  rendererSocket.onmessage = (e) => clientSocket.send(e.data);
}
```

### HMR Handler (`src/server/handlers/preview/hmr-handler.ts`)

Server-side WebSocket handler for preview mode:

- Listens on `/_ws` endpoint
- Subscribes to `ReloadNotifier` for file change events
- Broadcasts `update` messages with changed file paths
- Only enabled when `proxyEnvironment === "preview"`

### Preview HMR Client (`endpoints.ts` - `getPreviewHMRScript()`)

Client-side script injected in preview mode:

```javascript
// On receiving update message:
1. Load changed module with cache-busting URL
2. Clear component cache: window.__veryfrontClearComponentCache()
3. Re-render page: window.__veryfrontRenderPage(pathname)
4. Fall back to full reload if HMR functions unavailable
```

### ReloadNotifier (`src/server/reload-notifier.ts`)

Event bus for file change notifications:

- `triggerReload(changedPaths?)` - Called by FSAdapter when files change
- `subscribe(listener)` - HMRHandler subscribes to receive updates
- Debounces rapid changes (300ms) to batch updates

## Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `update` | Server → Client | Smart update with file path |
| `reload` | Server → Client | Full page reload (fallback) |
| `connected` | Server → Client | Connection acknowledged |

### Update Message Format

```json
{
  "type": "update",
  "path": "pages/index.mdx",
  "timestamp": 1704672000000
}
```

## Multi-Replica Support

HMR works correctly with multiple proxy and renderer replicas because:

1. **All renderers subscribe** to API's project event stream
2. **WebSocket connections are persistent** - browser stays connected to one replica
3. **Each replica independently broadcasts** to its connected browsers
4. **No sticky sessions required** - persistent connections handle affinity naturally

## CSS vs JS Updates

| File Type | Update Method |
|-----------|---------------|
| `.css` | Hot reload via `<link>` href refresh |
| `.tsx`, `.ts`, `.mdx`, `.jsx` | Clear component cache + re-render |

## Enabling Preview HMR

Preview HMR is automatically enabled when:
- `proxyEnvironment === "preview"` (set by proxy via `x-environment` header)
- The `/_veryfront/preview-hmr.js` script is injected into the HTML

## Debugging

Check browser console for HMR messages:
```
[Preview HMR] Connected to wss://myapp.preview.veryfront.com/_ws
[Preview HMR] Update received for: pages/index.mdx
[Preview HMR] Module loaded, applying update
[Preview HMR] Component cache cleared
[Preview HMR] Re-rendering page
```

## Related Files

- `proxy/main.ts` - WebSocket proxy handler
- `src/server/handlers/preview/hmr-handler.ts` - HMR WebSocket server
- `src/server/handlers/dev/endpoints.ts` - Preview HMR client script
- `src/server/reload-notifier.ts` - File change event bus
- `src/platform/adapters/veryfront-fs-adapter/adapter.ts` - API poke handling
