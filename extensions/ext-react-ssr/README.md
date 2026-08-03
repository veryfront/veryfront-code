# React isolated SSR extension

`@veryfront/ext-react-ssr` supplies React and `react-dom/server` to Veryfront's
isolated project-worker renderer. Core does not import either package.

The worker renderer uses an extension-owned generated bundle. Its runtime
module graph is entirely local, so isolated workers do not need remote import,
network, environment, or broad filesystem permissions to load React.

Install and explicitly register the extension through the normal extension
configuration:

```sh
deno add npm:@veryfront/ext-react-ssr
```

```ts
import extReactSsr from "@veryfront/ext-react-ssr";

export default {
  extensions: [extReactSsr()],
};
```

The factory has no configuration options. Empty configuration objects are
accepted for generic extension loaders, but unknown or inherited properties
are rejected instead of being ignored.

`@veryfront/ext-react-ssr/worker-renderer` is the package's stable isolated
worker entrypoint. Veryfront loads it through the provider metadata registered
by the root factory; application code should normally register the factory
rather than import the worker entrypoint directly.

When isolated SSR is requested without this contract, Veryfront fails with an
actionable missing-extension error. It never falls back to host rendering or a
hidden React import.

When updating React or the renderer source, regenerate and verify the checked-in
offline bundle:

```sh
deno task --config=extensions/ext-react-ssr/deno.json generate:renderer
deno task --config=extensions/ext-react-ssr/deno.json generate:renderer:check
```
