# React development UI extension

`@veryfront/ext-dev-ui-react` owns the React implementation used by Veryfront's
local dashboard and projects screens. It auto-activates as a first-party
extension and registers one immutable `DevUiAssetProvider` bundle. The bundle
contains both the React implementation and its generated stylesheet, so the
two assets cannot be built or deployed at different versions.

The bundle carries React and its stylesheet inline, so serving it needs no CDN
module, no request-time TSX transform, and no source fallback. The extension
requests no Deno runtime capabilities.

This package supplies the asset and the shared protocol only. The dashboard and
projects handlers in `src/server/handlers/dev/` still serve the legacy
`src/server/dev-ui` path; switching them to `DevUiAssetProvider` also requires
the dashboard session endpoint and CSRF token defined in
`src/extensions/dev-ui/protocol.ts`, which core does not implement yet.

After changing the UI or shell source, regenerate and verify both generated
files with:

```sh
deno task --config extensions/ext-dev-ui-react/deno.json generate
deno task --config extensions/ext-dev-ui-react/deno.json generate:check
```
