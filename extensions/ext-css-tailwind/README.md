# @veryfront/ext-css-tailwind

> **Category:** Build | **Contract:** `CSSProcessor` | **Default**

Provides Tailwind CSS v4 compilation for Veryfront. The extension owns the
pinned compiler, local base stylesheet, plugin policy, plugin module loading,
and every third-party import; framework core sees only `CSSProcessor`.

## Activation

The standard `veryfront` npm/CLI distribution installs and auto-activates this
extension. Source and custom service distributions must make the package
available alongside `veryfront`; the builtin composition then activates it.
Projects do not need a Tailwind entry in `veryfront.config.ts`.

Production pipelines that request CSS minification must still explicitly compose a
`CSSOptimizationEngine` provider such as `@veryfront/ext-css-lightning`.
If either requested provider is absent, compilation fails instead of returning
empty or regex-rewritten CSS.

## Provided contract

`CSSProcessor` — exposes:

- `defaultStylesheet` — the extension-owned Tailwind import, typography plugin,
  and dark-mode variant used only when the application supplies no stylesheet;
- `compile(stylesheet)` — delegates to Tailwind's native `compile()` and returns
  a compiler whose `build(candidates)` emits CSS for the class-name candidates
  discovered at render time.

## Plugin isolation

The extension accepts only its audited plugin allowlist and resolves every
plugin to one exact, extension-owned npm dependency. All five plugin modules are
statically imported and registered locally; compilation performs no plugin
download, temporary-module write, source rewriting, or global shim injection.
Unpinned version overrides and unknown packages are rejected before Tailwind
receives a plugin value.

The audited local inventory is:

- `@tailwindcss/forms@0.5.11`
- `@tailwindcss/typography@0.5.19`
- `daisyui@5.5.14`
- `tailwind-scrollbar-hide@2.0.0`
- `tailwindcss-animate@1.0.7`

Stylesheets may use either the bare package name or that exact versioned
specifier. No other version is accepted.

The complete local plugin inventory and exact versions are bound into the
processor cache identity. Changing any plugin implementation policy therefore
invalidates compiled CSS caches deterministically.

## Capabilities

- **filesystem read:** reading the pinned package's `index.css`.

The extension requests no network or filesystem-write capability.

## Configuration

No factory options. Inherited configuration, accessors, and unknown keys are
rejected. The base stylesheet is local and mandatory; there is no CDN or empty
stylesheet fallback.
