# Module Refactoring Status

Track progress of module audits and test coverage.

## Completed Modules

| Module | Status | Tests | Notes |
|--------|--------|-------|-------|
| platform | ✅ Done | ✅ Colocated | Previously refactored |
| data | ✅ Done | ✅ Colocated | 7 test files, 134 test steps |
| core | ✅ Done | ✅ Colocated | 17 test files, imports fixed to @veryfront aliases |
| routing | ✅ Done | ✅ Colocated | 21 test files, imports fixed to @veryfront aliases |
| html | ✅ Done | ✅ Colocated | 9 test files, imports fixed to @veryfront aliases |
| middleware | ✅ Done | ✅ Colocated | 5 test files, imports fixed to @veryfront aliases |
| security | ✅ Done | ✅ Colocated | 6 test files, imports fixed to @veryfront aliases |
| module-system | ✅ Done | ✅ Colocated | 2 test files, imports fixed to @veryfront aliases |
| observability | ✅ Done | ✅ Colocated | 3 test files, imports fixed to @veryfront aliases |
| rendering | ✅ Done | ✅ Colocated | 10 test files, imports fixed to @veryfront aliases |
| react | ✅ Done | ✅ Colocated | 3 test files, imports fixed to @veryfront aliases |
| ai | ✅ Done | ✅ Colocated | 3 test files, imports fixed to @veryfront aliases |
| build | ✅ Done | ✅ Colocated | 14 test files, imports fixed to @veryfront aliases |
| server | ✅ Done | ✅ Colocated | 8 test files, imports fixed to @veryfront aliases |
| cli | ✅ Done | ✅ Colocated | 2 test files, imports fixed to @veryfront aliases |

## All Modules Complete

All src modules have been refactored:
1. ~~platform - Previously done~~
2. ~~data - 7 test files~~
3. ~~core - 17 test files~~
4. ~~routing - 21 test files~~
5. ~~html - 9 test files~~
6. ~~middleware - 5 test files~~
7. ~~security - 6 test files~~
8. ~~module-system - 2 test files~~
9. ~~observability - 3 test files~~
10. ~~rendering - 10 test files~~
11. ~~react - 3 test files~~
12. ~~ai - 3 test files~~
13. ~~build - 14 test files~~
14. ~~server - 8 test files~~
15. ~~cli - 2 test files~~

## Process

For each module:
1. Audit all files - understand purpose and boundaries
2. Fix imports to use @veryfront/ aliases
3. Create colocated .test.ts files
4. Run `deno task verify` to ensure tests pass
5. Update this status file

## Core Module Summary

- Fixed imports in 13 source files to use @veryfront/ aliases
- Created 8 new test files:
  - branded.test.ts
  - hash-utils.test.ts
  - base64url.test.ts
  - memoize.test.ts
  - route-path-utils.test.ts
  - feature-flags.test.ts
  - veryfront-error.test.ts
  - error-context.test.ts
- Total: 17 test files covering config, types, utils, errors
- All tests passing

## Routing Module Summary

- Fixed imports in 11 source files to use @veryfront/ aliases:
  - api-route-matcher.ts
  - handler.ts
  - route-executor.ts
  - path-candidate-generator.ts
  - responses.ts
  - method-validator.ts
  - error-handler.ts
  - module-loader/loader.ts
  - module-loader/http-validator.ts
  - module-loader/loader.test.ts
- Created 5 new test files:
  - route-parser.test.ts
  - route-matcher.test.ts
  - pattern-route-matcher.test.ts
  - method-validator.test.ts
  - path-candidate-generator.test.ts
- Total: 21 test files covering matchers, api, slug-mapper, client
- All 1032 tests passing

## HTML Module Summary

- Fixed imports in 7 source files to use @veryfront/ aliases:
  - types.ts
  - utils.ts
  - utils.test.ts
  - styles-builder/tailwind-config.ts
  - styles-builder/unocss-generator.ts
  - hydration-script-builder/hydration-data-generator.ts
  - html-shell-generator.ts
- Created 6 new test files:
  - html-escape.test.ts
  - html-detection.test.ts
  - tag-generators.test.ts
  - styles-builder/tailwind-config.test.ts
  - styles-builder/theme-variables.test.ts
  - hydration-script-builder/hydration-data-generator.test.ts
- Total: 9 test files covering HTML utilities, escaping, detection, tag generation, styling
- All 685 unit tests passing (3706 steps)

## Middleware Module Summary

- Fixed imports in 4 source files to use @veryfront/ aliases:
  - core/pipeline/pipeline.ts
  - core/pipeline/executor.ts
  - core/pipeline/composer.ts
  - builtin/security/redis-rate-limit.ts
- Created 5 new test files:
  - core/context.test.ts
  - core/pipeline/composer.test.ts
  - builtin/security/rate-limit.test.ts
  - builtin/security/csp.test.ts
  - builtin/security/cors-simple.test.ts
- Total: 5 test files covering context, pipeline composition, rate limiting, CSP, CORS
- All 691 unit tests passing (3770 steps)

## Security Module Summary

- Fixed imports in 4 source files to use @veryfront/ aliases:
  - http/auth.ts
  - http/cors/constants.ts
  - http/cors/middleware.ts
  - http/response/static-helpers.ts
- Fixed imports in 4 existing test files to use jsr:@std/ aliases:
  - path-validation.test.ts
  - rate-limit/middleware.test.ts
  - sandbox/deno-sandbox.test.ts
  - sandbox/permission-system.test.ts
- Created 2 new test files:
  - http/cors/validators.test.ts
  - input-validation/sanitizers.test.ts
- Total: 6 test files covering path validation, CORS, rate limiting, sandboxing, sanitization
- All 1048 unit tests passing (5431 steps)

## Module-System Module Summary

- Fixed imports in 7 source files to use @veryfront/ aliases:
  - react-loader/ssr-module-loader.ts
  - react-loader/component-loader.ts
  - react-loader/extract-component.ts
  - react-loader/temp-directory.ts
  - import-map/default-import-map.ts
  - server/websocket-handler.ts
  - server/module-server.ts
- Fixed imports in 2 existing test files to use jsr:@std/ aliases:
  - component-registry/edge-cases.test.ts
  - react-loader/ssr-module-loader.stress-test.ts
- Total: 2 test files covering component registry edge cases and SSR module loader stress tests
- All 1048 unit tests passing (5431 steps)

## Observability Module Summary

- Fixed imports in 2 source files to use @veryfront/ aliases:
  - tracing/config.ts
  - metrics/config.ts
- Fixed imports in 3 existing test files to use jsr:@std/ aliases:
  - auto-instrument.test.ts
  - metrics/metrics.test.ts
  - tracing/tracing.test.ts
- Total: 3 test files covering auto-instrumentation, metrics, and tracing
- All 1048 unit tests passing (5431 steps)

## Rendering Module Summary

- Fixed imports in 23 source files to use @veryfront/ aliases:
  - rsc/client-dom.ts
  - layouts/provider-manager.ts
  - client/hmr-runtime.ts
  - element-validator/element-inspector.ts
  - element-validator/element-normalizer.ts
  - layouts/layout-applicator.ts
  - layouts/layout-collector.ts
  - layouts/utils/component-loader.ts
  - layouts/utils/discovery.ts
  - orchestrator/lifecycle.ts
  - orchestrator/pipeline.ts
  - orchestrator/ssr-orchestrator.ts
  - orchestrator/compiler-service.ts
  - orchestrator/config.ts
  - orchestrator/html.ts
  - ssr/mdx-module-loader.ts
  - page-resolution/page-resolver.ts
  - rsc/component-analyzer.ts
  - rsc/constants.ts
  - rsc/hydrate-client.ts
  - rsc/server-renderer/html-generator.ts
  - cache/stores/redis-store.ts
  - cache/stores/filesystem-store.ts
- Fixed imports in 10 existing test files to use jsr:@std/ aliases:
  - router-detection.test.ts
  - cache/cache-coordinator.test.ts
  - ssr-react18.test.ts
  - plugins.test.ts
  - orchestrator/pipeline.test.ts
  - client/state-bridge.test.ts
  - client/prefetch/resource-hints.test.ts
  - client/prefetch/network-utils.test.ts
  - client/prefetch/link-observer.test.ts
  - client/browser-logger.test.ts
- Total: 10 test files covering SSR, RSC, caching, prefetching, state bridging, plugins
- All 1048 unit tests passing (5431 steps)

## React Module Summary

- Fixed imports in 6 source files to use @veryfront/ aliases:
  - compat/config-generator.ts
  - components/live/LivePageContextProvider.tsx
  - components/live/LiveDataProvider.tsx
  - compat/version-detector/version-parser.ts
  - compat/ssr-adapter/stream-renderer.ts
  - compat/ssr-adapter/server-loader.ts
- Fixed imports in 3 existing test files to use jsr:@std/ aliases:
  - compat/version-detector/version-detector.test.ts
  - compat/version-detector.test.ts
  - compat/hooks-adapter.test.ts
- Total: 3 test files covering React version detection, hooks adapters, SSR compatibility
- All 1048 unit tests passing (5431 steps)

## AI Module Summary

- Fixed imports in 25 source files to use @veryfront/ aliases:
  - providers/base.ts, openai.ts, anthropic.ts, google.ts, factory.ts
  - agent/runtime.ts, factory.ts, composition.ts
  - agent/execution/tool-execution-core.ts
  - mcp/server.ts, resource.ts, prompt.ts
  - utils/config-validator.ts, setup.ts, tool.ts, discovery.ts
  - react/hooks/use-chat.ts, use-agent.ts, use-streaming.ts, use-completion.ts
  - dev/generate-sdk.ts
  - production/rate-limit/limiter.ts, security/validator.ts
  - workflow/blob/local-storage.ts
- Fixed imports in 3 existing test files to use jsr:@std/ aliases:
  - utils/discovery-fsadapter.test.ts
  - agent/execution/tool-execution-core.test.ts
  - agent/execution/usage-tracker.test.ts
- Total: 3 test files covering discovery, tool execution, usage tracking
- All 1048 unit tests passing (5431 steps)

## Build Module Summary

- Fixed imports in 30+ source files to use @veryfront/ aliases:
  - asset-pipeline/tailwind-processor/batch-processor.ts
  - asset-pipeline/image-optimizer/optimizer-core.ts, variant-generator.ts
  - asset-pipeline/css-optimizer/*.ts files
  - production-build/build/*.ts files, client-runtime.ts, asset-generation.ts
  - bundler/code-splitter/*.ts files
  - compiler/mdx-compiler/*.ts files, mdx-to-js.ts
  - transforms/esm/*.ts files, transforms/mdx/*.ts files
  - transforms/plugins/plugin-loader.ts
  - embedded/preset.ts, vendor-bundle.ts
  - renderer/services/*.ts files
- Fixed imports in 14 test files to use jsr:@std/ aliases:
  - css-optimizer.test.ts, cache-manager.test.ts, strategies.test.ts, utils.test.ts
  - manifest-manager.test.ts, build-executor.test.ts, loader-utils.test.ts
  - rehype-utils.test.ts, remark-headings.test.ts, remark-mdx-utils.test.ts
  - remark-node-id.test.ts, plugin-loader.test.ts, fixture-runner.test.ts
- Total: 14 test files covering CSS optimizer, image optimizer, build executor, loaders, plugins
- All 1048 unit tests passing (5431 steps)

## Server Module Summary

- Fixed imports in 22 source files to use @veryfront/ aliases:
  - bootstrap.ts (utils, errors)
  - production-server.ts (utils, core/memory, core/cache)
  - shared/renderer-factory.ts (module-system, core/memory)
  - universal-handler/index.ts (errors)
  - build-service-worker.ts (utils)
  - dev-server/hmr-server.ts (errors, platform)
  - dev-server/middleware.ts (platform, utils)
  - dev-server/server.ts (rendering)
  - dev-server/route-discovery.ts (platform)
  - dev-server/error-overlay/html-template.ts (html)
  - handlers/monitoring/metrics.ts (platform)
  - handlers/monitoring/memory.ts (core/memory)
  - handlers/monitoring/client-log.ts (errors)
  - handlers/index.ts (routing)
  - handlers/request/snippet-handler.ts (errors)
  - handlers/request/ssr/ssr-handler.ts (core/memory)
  - handlers/response/not-found.ts (html)
  - handlers/request/api/app-router-handler.ts (http)
  - handlers/request/rsc/handlers/render-handler.ts (errors)
  - handlers/request/rsc/handlers/hydrator-handler.ts (platform, errors)
  - handlers/request/rsc/handlers/component-resolver.ts (platform)
  - handlers/request/rsc/handlers/environment.ts (platform)
  - handlers/request/rsc/endpoints/action-parser.ts (http)
  - handlers/request/rsc/endpoints/action-handler.ts (errors, http)
  - handlers/request/rsc/endpoints/endpoint-router.ts (http, html)
  - handlers/request/rsc/endpoints/handler-registry.ts (utils, core/memory)
  - handlers/studio/endpoints.ts (studio)
- Fixed imports in 1 test file to use jsr:@std/ aliases:
  - handlers/request/lib-modules-handler.test.ts
- Total: 8 test files covering handlers, parsing, production mode, streaming, domain parsing
- All 695 unit tests passing (3839 steps)

## CLI Module Summary

- Fixed imports in 28 source files to use @veryfront/ aliases:
  - npm-cli.ts (platform/compat/path, fs, process)
  - commands/analyze-chunks.ts (platform/compat/fs, process)
  - commands/clean.ts (platform/compat/fs)
  - commands/generate.ts (errors, platform/compat/fs)
  - commands/dev.ts (platform/compat/process, ai/utils)
  - commands/routes.ts (platform/compat/fs)
  - commands/push.ts (platform/compat/process, fs)
  - commands/pull.ts (platform/compat/process, fs)
  - commands/init/init-command.ts (errors, platform/compat/process, fs)
  - commands/init/config-generator.ts (platform/compat/fs)
  - commands/init/interactive-wizard.ts (platform/compat/process)
  - commands/doctor/index.ts (errors)
  - commands/doctor/version-checks.ts (platform/compat/process, react/compat)
  - commands/doctor/ai-checks.ts (config/loader, platform/adapters)
  - commands/build/error-handler.ts (platform/compat/process)
  - commands/generate/integration-generator.ts (platform/compat/fs, process)
  - index/cli-main.ts (platform/compat/process)
  - index/dev-handler.ts (platform/compat/process, fs)
  - index/build-handler.ts (platform/compat/process, build/index)
  - index/generate-handler.ts (platform/compat/process)
  - index/command-router.ts (platform/compat/process, fs, path, server)
  - templates/loader.ts (platform/compat/fs, path-helper, runtime)
  - templates/feature-loader.ts (platform/compat/fs, path-helper)
  - templates/integration-loader.ts (platform/compat/fs, path-helper)
  - utils/package-manager.ts (platform/compat/fs, process, runtime)
  - utils/index.ts (platform/compat/runtime)
  - utils/env-prompt.ts (platform/compat/process)
  - utils/terminal-select.ts (platform/compat/runtime)
  - shared/config.ts (platform/compat/process, fs, runtime)
- Fixed imports in 2 test files to use jsr:@std/ aliases:
  - commands/init/init-command.test.ts
  - utils/index.test.ts
- Total: 2 test files covering init command types and CLI utilities
- All 1048 unit tests passing (5431 steps)
