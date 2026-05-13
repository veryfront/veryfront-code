# @veryfront/ext-css-tailwind

> **Type:** Build Tool | **Contract:** `CSSProcessor`

Provides Tailwind CSS v4 compilation for Veryfront. Compiles stylesheets at render time and supports dynamic plugin loading from CDN.

## Installation

Add the extension to your project's `veryfront.config.ts`:

```ts
import extTailwind from "@veryfront/ext-css-tailwind";

export default defineConfig({
  extensions: [extTailwind()],
});
```

## Provided contract

`CSSProcessor` — exposes:

- `compile(stylesheet, options)` — delegates to Tailwind's native `compile()` and returns a compiler whose `build(candidates)` emits CSS for the class-name candidates discovered at render time.

## Plugin shims

On setup the extension installs three `globalThis` shims so that Tailwind plugin bundles loaded at runtime from `esm.sh` bind their `tailwindcss/plugin`, `tailwindcss/defaultTheme`, and `tailwindcss/colors` imports to the same tailwindcss copy this extension ships. Core's `plugin-loader.ts` rewrites plugin bundle code to reference these shims by name; without them, dynamic plugin loading fails.

The shims live at:

- `globalThis.__tailwindPluginShim`
- `globalThis.__tailwindDefaultThemeShim`
- `globalThis.__tailwindColorsShim`

## Capabilities

- **net `esm.sh`:** loading user-declared Tailwind plugins from CDN at runtime.

## Configuration

No factory options. The extension reads no environment variables and takes no config.
