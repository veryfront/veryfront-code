# html2canvas Studio capture extension

`@veryfront/ext-studio-capture-html2canvas` adds PNG screenshot capture to the
Studio preview bridge. The framework's base bridge remains dependency-free and
returns an explicit capability error when this extension is not configured.

Add the extension to the project configuration:

```ts
import { defineConfig } from "veryfront";
import extStudioCaptureHtml2Canvas from "@veryfront/ext-studio-capture-html2canvas";

export default defineConfig({
  extensions: [extStudioCaptureHtml2Canvas()],
});
```

Installing the package or placing it under `extensions/` does not activate it.
Its manifest is explicit-only, so the factory is imported, invoked, and set up
only through the project configuration above.

The extension registers `StudioCaptureBundleProvider` during startup. Veryfront
snapshots that contract into the server generation and serves the
extension-owned browser bundle at the existing
`/_veryfront/studio-bridge.js` endpoint. No package lookup, CDN fallback,
ambient browser global, or runtime dynamic import is used.

The server registers only this checked-in bundle string and therefore requests
no Deno runtime capabilities. Browser resource loading follows the preview
document's own browser security policy; it is not a server permission.

The browser adapter maps the provider-neutral viewport request to
`html2canvas-pro@2.0.0`. Requests remain bounded by core's capture deadline,
canvas limits, aggregate payload limit, and one-capture-at-a-time lease. The
vendor cannot cancel an in-progress render, so core quarantines work that
outlives cancellation or timeout until the underlying promise settles.

After changing the browser adapter or the core Studio bridge, regenerate this
package's checked-in artifact with:

```sh
deno task --config extensions/ext-studio-capture-html2canvas/deno.json generate:bridge
```
