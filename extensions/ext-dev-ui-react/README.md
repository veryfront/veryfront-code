# React development UI extension

`@veryfront/ext-dev-ui-react` owns the React implementation used by Veryfront's
local dashboard and projects screens. It auto-activates as a first-party
extension and registers one immutable `DevUiAssetProvider` bundle. The bundle
contains both the React implementation and its generated stylesheet, so the
two assets cannot be built or deployed at different versions.

Core serves that checked-in bundle from local, same-origin endpoints. It never
loads React, transforms TSX, imports a CDN module, or falls back to source at
request time. The extension requests no Deno runtime capabilities.

After changing the UI or shell source, regenerate and verify both generated
files with:

```sh
deno task --config extensions/ext-dev-ui-react/deno.json generate
deno task --config extensions/ext-dev-ui-react/deno.json generate:check
```
