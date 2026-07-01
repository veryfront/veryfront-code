# Publish first-party extension npm packages

## Goal

Move feature-specific npm dependencies out of the default `veryfront` install path and into publishable first-party extension packages.

## Constraints

- Keep the root `veryfront` npm package small and installable without native, shell, OpenTelemetry, Redis, SQLite, MDX, Tailwind, Babel, or document extraction implementation packages.
- Generate extension package metadata from each `extensions/*/deno.json` manifest. Do not maintain a second dependency table for extension runtime dependencies.
- Preserve the existing extension discovery model: installed packages that declare `veryfront.extension: true` are discovered from `node_modules` and loaded by bare package specifier.
- Keep npm install/build verification on `--ignore-scripts`.
- Do not patch downstream Dockerfiles or hosts to install raw transitive dependencies such as `bash-tool`, `just-bash`, or `@kreuzberg/node`.

## Implementation plan

1. Add a manifest-driven extension package builder that emits one npm package per first-party `extensions/*/deno.json`.
2. Map extension imports in generated package metadata:
   - `npm:` and `esm.sh` runtime imports become package dependencies.
   - Public `veryfront/*` imports become `veryfront` peer imports.
   - Non-public helper imports stay bundled inside the extension package that uses them.
   - `@std/*` and test-only imports stay out of runtime dependencies.
3. Keep the root package metadata free of first-party extension implementation dependencies.
4. Teach the release workflow to publish root `veryfront` and each generated extension package from the same trusted-publishing workflow and `production` environment.
5. Add tests that fail when root automatic installs regain feature packages or when an extension package is missing required metadata/dependencies.
6. Verify with focused Deno tests and an npm build/package dry-run for representative extension packages.

## Runtime dependency model

- Root `veryfront` keeps core, React, Zod, Deno shims, and the Node HMR WebSocket dependency.
- Heavy first-party extension dependencies are published in generated `@veryfront/ext-*` packages.
- Source and compiled-binary builds resolve workspace extension sources first.
- npm builds resolve `@veryfront/ext-*` packages when the workspace source is absent.
- Downstream service repos install extension packages by feature. For example, project server runtimes install bundler, content, CSS, and parser extensions; local shell-tool agent runtimes install `@veryfront/ext-sandbox-shell-tools`; MCP-only tool execution does not need the shell-tools package unless local shell tools are also enabled.

## Risks

- Some extensions import core implementation helpers from `veryfront/*`. The package builder must preserve public imports as peer package subpaths without forcing every helper into the root package public API.
- The document extraction extension has a sibling worker file that is not statically traced. The extension package builder must include or transpile it explicitly.
- npm trusted publishing must be configured manually for each newly published package before the release job can publish them.
- Root `veryfront` still contains LLM providers and schema-zod because they do not bring the sensitive native, shell, parser, MDX, Tailwind, or OpenTelemetry dependency classes into automatic installs.
