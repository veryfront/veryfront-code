# React development UI extension

`@veryfront/ext-dev-ui-react` owns the React implementation used by Veryfront's
local dashboard and projects screens. It auto-activates as a first-party
extension and registers one immutable `DevUiAssetProvider` bundle. The bundle
contains both the React implementation and its generated stylesheet, so the
two assets cannot be built or deployed at different versions.

The bundle carries React and its stylesheet inline, so serving it needs no CDN
module, no request-time TSX transform, and no source fallback. The extension
requests no Deno runtime capabilities.

This package supplies the asset bundle and its shared host protocol only.
Veryfront's dashboard and projects pages still use the legacy development UI.
A host that adopts `DevUiAssetProvider` must also implement the dashboard
session endpoint and CSRF-token contract exposed by the shared protocol; the
core host does not provide those protocol operations yet.

After changing the UI or shell source, regenerate and verify both generated
files with:

```sh
deno task --config extensions/ext-dev-ui-react/deno.json generate
deno task --config extensions/ext-dev-ui-react/deno.json generate:check
```
