---
title: "Error reference"
description: "Every error the Veryfront CLI, server, and logs can report, with what it means and what to do next."
order: 48
---

Veryfront reports errors with a stable slug, such as `port-in-use`. The CLI, the
HTTP response body, and the server logs all print that slug alongside a link to
this page, so you can jump straight to the entry for the error you hit.

Each entry lists the HTTP status the error maps to, the process exit code when
it reaches the CLI, and the first thing to try.

This page is generated from the framework's error registry, so it always lists
every error the current release can report.

## Configuration

Raised while loading or validating project configuration.

### config-not-found

Configuration file not found.

- **HTTP status:** 404
- **What to do:** Create veryfront.config.js, veryfront.config.ts, or veryfront.config.mjs in the project root

### config-invalid

Invalid configuration format.

- **HTTP status:** 400
- **What to do:** Check the reported configuration path and validation details

### config-parse-error

Failed to parse configuration.

- **HTTP status:** 400
- **What to do:** Ensure your configuration file contains valid JavaScript or TypeScript

### config-validation-error

Configuration validation failed.

- **HTTP status:** 422
- **What to do:** Check the configuration against the schema requirements

### config-type-error

Configuration type mismatch.

- **HTTP status:** 400
- **What to do:** Ensure configuration values match expected types

### import-map-invalid

Invalid import map configuration.

- **HTTP status:** 400
- **What to do:** Check your import map syntax and paths

### cors-config-invalid

Invalid CORS configuration.

- **HTTP status:** 400
- **What to do:** Review CORS settings in your configuration

### config-validation-failed

Configuration validation failed.

- **HTTP status:** 400
- **What to do:** Check configuration values against requirements

### webhook-config-invalid

Invalid webhook configuration.

- **HTTP status:** 400
- **What to do:** Check webhook definition fields, target settings, and eventFilter conditions

### schedule-config-invalid

Invalid schedule configuration.

- **HTTP status:** 400
- **What to do:** Check schedule definition fields, cron expression, target settings, and positive-integer limits

### trigger-config-invalid

Invalid trigger configuration.

- **HTTP status:** 400
- **What to do:** Check trigger ID format (lowercase, alphanumeric, dots/slashes/hyphens) and ensure all input values are JSON-serializable

### template-not-found

Unknown project template.

- **HTTP status:** 404
- **CLI exit code:** 2
- **What to do:** Run 'veryfront init --help' to see the available templates

## Build

Raised while compiling, bundling, or transforming project source.

### build-failed

Build process failed.

- **HTTP status:** 500
- **What to do:** Check the build output for specific errors

### bundle-error

Bundle generation failed.

- **HTTP status:** 500
- **What to do:** Review bundler output for details

### typescript-error

TypeScript compilation error.

- **HTTP status:** 500
- **What to do:** Fix TypeScript errors shown in the output

### mdx-compile-error

MDX compilation failed.

- **HTTP status:** 500
- **What to do:** Check your MDX file syntax

### markdown-compile-error

Markdown compilation failed.

- **HTTP status:** 500
- **What to do:** Check your Markdown file syntax and frontmatter

### asset-optimization-error

Asset optimization failed.

- **HTTP status:** 500
- **What to do:** Check asset file formats and paths

### ssg-generation-error

Static site generation failed.

- **HTTP status:** 500
- **What to do:** Review SSG configuration and data fetching

### sourcemap-error

Source map generation failed.

- **HTTP status:** 500
- **What to do:** Check source map configuration

### compilation-error

Compilation failed.

- **HTTP status:** 500
- **What to do:** Review compiler output for specific errors

### server-export-strip-failed

Server-only export cannot be removed from the client build.

- **HTTP status:** 500
- **What to do:** Declare the hook directly in the route module and keep its values module scope

## Runtime

Raised while executing project code.

### hydration-mismatch

Client/server hydration mismatch.

- **HTTP status:** 500
- **What to do:** Ensure server and client render the same content

### render-error

Component render failed.

- **HTTP status:** 500
- **What to do:** Check component for runtime errors

### redirect-destination-not-allowed

Redirect destination not allowed.

- **HTTP status:** 500
- **What to do:** Use a relative or same-origin destination, or add the origin to security.redirects.allowedOrigins

### component-error

Component execution error.

- **HTTP status:** 500
- **What to do:** Review component logic and props

### layout-not-found

Layout component not found.

- **HTTP status:** 404
- **What to do:** Ensure layout file exists at the expected path

### page-not-found

Page component not found.

- **HTTP status:** 404
- **What to do:** Check that the page file exists in the routes directory

### api-error

API route handler error.

- **HTTP status:** 500
- **What to do:** Review API route handler for errors

### middleware-error

Middleware execution error.

- **HTTP status:** 500
- **What to do:** Check middleware function for errors

### trigger-target-not-found

Trigger target not found.

- **HTTP status:** 404
- **What to do:** Ensure the referenced task or workflow ID is registered in the project

### trigger-execution-failed

Trigger target execution failed.

- **HTTP status:** 500
- **What to do:** Check the task or workflow for errors and review the trigger input

### trigger-not-supported

Trigger target type not supported in local runtime.

- **HTTP status:** 501
- **What to do:** Use a workflow or task target for local trigger runs; agent targets require the Cloud runtime

## Routing

Raised while matching or handling a route.

### route-conflict

Conflicting route definitions.

- **HTTP status:** 409
- **What to do:** Rename or reorganize conflicting route files

### invalid-route-file

Invalid route file structure.

- **HTTP status:** 400
- **What to do:** Ensure route file exports required functions

### route-handler-invalid

Invalid route handler export.

- **HTTP status:** 400
- **What to do:** Export a valid handler function from the route file

### dynamic-route-error

Dynamic route parsing failed.

- **HTTP status:** 500
- **What to do:** Check dynamic route segment syntax

### route-params-error

Route parameters invalid.

- **HTTP status:** 400
- **What to do:** Validate route parameter values

### api-route-error

API route definition error.

- **HTTP status:** 500
- **What to do:** Review API route configuration

## Modules

Raised while resolving or loading a module.

### module-not-found

Module could not be resolved.

- **HTTP status:** 404
- **What to do:** Check the import path and ensure the module is installed

### import-resolution-error

Import path resolution failed.

- **HTTP status:** 500
- **What to do:** Verify import paths and module configuration

### circular-dependency

Circular dependency detected.

- **HTTP status:** 500
- **What to do:** Refactor imports to break the circular dependency

### invalid-import

Invalid import statement.

- **HTTP status:** 400
- **What to do:** Fix import syntax or path

### dependency-missing

Required dependency not installed.

- **HTTP status:** 404
- **What to do:** Install the missing dependency with your package manager

### version-mismatch

Dependency version mismatch.

- **HTTP status:** 409
- **What to do:** Update dependencies to compatible versions

### lockfile-format-mismatch

Lockfile format is not supported.

- **HTTP status:** 409
- **What to do:** Upgrade Veryfront or migrate the lockfile before modifying it

### lockfile-read-error

Lockfile could not be read safely.

- **HTTP status:** 500
- **What to do:** Check file access or restore a valid lockfile before retrying

## Server

Raised by the dev server, the request pipeline, or a backing service.

### port-in-use

Server port already in use.

- **HTTP status:** 409
- **What to do:** Stop the process using the port, or pick another with: veryfront dev --port \<number>

### server-start-error

Server failed to start.

- **HTTP status:** 500
- **What to do:** Check server configuration and port availability

### cache-error

Cache operation failed.

- **HTTP status:** 500
- **What to do:** Clear the cache and try again

### file-watch-error

File watcher error.

- **HTTP status:** 500
- **What to do:** Restart the development server

### request-error

HTTP request handling error.

- **HTTP status:** 500
- **What to do:** Check request handler and middleware

### service-overloaded

Service overloaded.

- **HTTP status:** 503
- **What to do:** Reduce load or scale up resources

### project-execution-unavailable

Project execution unavailable.

- **HTTP status:** 503
- **What to do:** Route the project to a dedicated isolated runtime

### semaphore-timeout

Semaphore acquire timeout.

- **HTTP status:** 503
- **What to do:** Reduce concurrency or increase the semaphore acquire timeout

### circuit-breaker-open

Circuit breaker is open.

- **HTTP status:** 503
- **What to do:** Wait for the breaker reset timeout before retrying

### cache-path-mismatch

Cache path mismatch.

- **HTTP status:** 500
- **What to do:** Clear the cache directory and rebuild

### network-error

Network operation failed.

- **HTTP status:** 502
- **What to do:** Check network connectivity and retry

### api-client-error

API client request failed.

- **HTTP status:** 500
- **What to do:** Check API connectivity and authentication

### token-storage-error

Token storage operation failed.

- **HTTP status:** 500
- **What to do:** Check token storage backend and credentials

### cache-invariant-violation

Cache path invariant violated.

- **HTTP status:** 500
- **What to do:** Clear the cache and rebuild

### release-not-found

No active release found.

- **HTTP status:** 404
- **What to do:** Deploy the project to create a release for this environment

### fallback-exhausted

Primary and fallback operations both failed.

- **HTTP status:** 500
- **What to do:** Check service availability and connectivity

### rag-store-corrupt

RAG store file is corrupt.

- **HTTP status:** 500
- **What to do:** Repair or move the store file aside, then retry; it was not overwritten

### rag-store-unavailable

RAG store file is unavailable.

- **HTTP status:** 500
- **What to do:** Check storage availability, permissions, and concurrent operations, then retry

## Server and client boundary

Raised when server-only and client-only code are mixed incorrectly.

### client-boundary-violation

Client boundary rule violation.

- **HTTP status:** 400
- **What to do:** Add 'use client' directive or move code to a client component

### server-only-in-client

Server-only code in client component.

- **HTTP status:** 400
- **What to do:** Move server-only code to a server component

### client-only-in-server

Client-only code in server component.

- **HTTP status:** 400
- **What to do:** Move client-only code to a client component

### invalid-use-client

Invalid 'use client' directive.

- **HTTP status:** 400
- **What to do:** Place 'use client' at the top of the file

### invalid-use-server

Invalid 'use server' directive.

- **HTTP status:** 400
- **What to do:** Place 'use server' at the top of the file or function

### rsc-payload-error

RSC payload serialization error.

- **HTTP status:** 500
- **What to do:** Ensure props are serializable (no functions, symbols, etc.)

### ssr-output-limit-exceeded

SSR output limit exceeded.

- **HTTP status:** 500
- **What to do:** Reduce the rendered HTML size or split the response into smaller pages

## Development tooling

Raised by the local development workflow.

### hmr-error

Hot module replacement error.

- **HTTP status:** 500
- **What to do:** Restart the development server

### dev-server-error

Development server error.

- **HTTP status:** 500
- **What to do:** Check the dev server logs and restart

### fast-refresh-error

Fast refresh failed.

- **HTTP status:** 500
- **What to do:** Save the file again or restart the dev server

### error-overlay-error

Error overlay failed.

- **HTTP status:** 500
- **What to do:** Check browser console for details

### source-map-error

Source map loading error.

- **HTTP status:** 500
- **What to do:** Rebuild or clear cache

## Deployment

Raised while building, uploading, or activating a deployment.

### config-not-deployable

Configuration cannot be deployed to Veryfront Cloud.

- **HTTP status:** 400
- **CLI exit code:** 2
- **What to do:** Veryfront Cloud reads veryfront.config.ts as data: keep it to literals and the veryfront configuration helpers

### deployment-error

Deployment process failed.

- **HTTP status:** 500
- **What to do:** Check deployment logs for details

### platform-error

Platform-specific error.

- **HTTP status:** 500
- **What to do:** Check platform documentation and requirements

### env-var-missing

Required environment variable missing.

- **HTTP status:** 500
- **What to do:** Set the required environment variable

### production-build-required

Production build required.

- **HTTP status:** 400
- **What to do:** Run 'veryfront build' before deploying

### environment-not-found

Deployment environment not found.

- **HTTP status:** 404
- **What to do:** Check environment names with: veryfront config

### environment-not-routable

Environment name has no Veryfront-hosted address.

- **HTTP status:** 400
- **What to do:** Deploy to preview, staging, or production, or attach a custom domain to this environment in Studio

### release-missing-version

Release has no version.

- **HTTP status:** 500
- **What to do:** Try again or check the build logs in Studio

### release-build-timeout

Release build timed out.

- **HTTP status:** 408
- **What to do:** Try again or check the build logs in Studio

### deployment-verification-timeout

Deployment verification timed out.

- **HTTP status:** 408
- **What to do:** Try again or check the deployment status in Studio

### push-receipt-missing

Push receipt not found.

- **HTTP status:** 400
- **What to do:** Run: veryfront push --branch main first

### push-conflict

Push rejected because remote files changed.

- **HTTP status:** 409
- **What to do:** Commit or stash local changes, run veryfront pull, reconcile the changes with Git, then push again

### sync-state-invalid

Local sync metadata is invalid.

- **HTTP status:** 400
- **What to do:** Remove .veryfront/sync-state.json, run veryfront pull, and try again

### source-digest-mismatch

Release source digest mismatch.

- **HTTP status:** 409
- **What to do:** Run veryfront push again to re-upload source files

### preview-hostname-too-long

Preview hostname too long.

- **HTTP status:** 400
- **What to do:** Use a shorter project slug or branch name

### branch-not-found

Branch not found.

- **HTTP status:** 404
- **What to do:** List branches in Studio or push a new one with: veryfront push --branch \<name>

## Agents

Raised while running an agent, tool, or workflow.

### agent-error

Agent operation error.

- **HTTP status:** 500
- **What to do:** Check agent configuration and logs

### agent-not-found

Agent not found.

- **HTTP status:** 404
- **What to do:** Verify the agent ID exists

### agent-timeout

Agent operation timed out.

- **HTTP status:** 408
- **What to do:** Increase timeout or simplify the request

### agent-intent-error

Agent intent parsing error.

- **HTTP status:** 400
- **What to do:** Rephrase the request more clearly

### orchestration-error

Multi-agent orchestration error.

- **HTTP status:** 500
- **What to do:** Check agent coordination logic

### cost-limit-exceeded

Cost limit exceeded.

- **HTTP status:** 429
- **What to do:** Wait for the budget period to reset or increase the limit

### tool-id-conflict

Tool ID conflict.

- **HTTP status:** 409
- **What to do:** Use a unique tool ID or rename one of the conflicting tools

### durable-run-event-persistence-failed

Durable run event persistence failed.

- **HTTP status:** 500
- **What to do:** Correct invalid or oversized event data, or retry after durable event storage recovers

## General

Raised anywhere; these are not specific to one subsystem.

### unknown-error

Unknown/unclassified error.

- **HTTP status:** 500
- **What to do:** Check logs for more details

### authentication-required

Authentication required.

- **HTTP status:** 401
- **What to do:** Set VERYFRONT_API_TOKEN or run 'veryfront login'

### permission-denied

File/resource permission denied.

- **HTTP status:** 403
- **What to do:** Check file permissions and access rights

### file-not-found

File not found.

- **HTTP status:** 404
- **What to do:** Verify the file path exists

### resource-not-found

Requested resource not found.

- **HTTP status:** 404
- **What to do:** Verify the referenced resource ID or name exists

### invalid-argument

Invalid function argument.

- **HTTP status:** 400
- **CLI exit code:** 2
- **What to do:** Check argument types and values

### timeout-error

Operation timed out.

- **HTTP status:** 408
- **What to do:** Increase timeout or optimize the operation

### initialization-error

Initialization failed.

- **HTTP status:** 500
- **What to do:** Check initialization requirements and dependencies

### not-supported

Feature not supported.

- **HTTP status:** 501
- **What to do:** Check documentation for supported features

### security-violation

Security violation detected.

- **HTTP status:** 403
- **What to do:** Check for path traversal or unauthorized access attempts

### input-validation-failed

Input validation failed.

- **HTTP status:** 400
- **What to do:** Check request input against validation rules

### project-source-empty

Project source is empty.

- **HTTP status:** 400
- **What to do:** Add project files or run 'veryfront init'

### nested-cwd-scope

Working directory scope nested inside another.

- **HTTP status:** 500
- **What to do:** Do the inner work directly in the outer scope's callback instead of opening a second one
