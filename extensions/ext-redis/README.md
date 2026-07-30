# @veryfront/ext-redis

Provides Redis-backed implementations for Veryfront's provider-neutral
`DistributedRuntimeProvider` contract. The package is never loaded by core,
the CLI, browser artifacts, or compiled binaries. Add and activate it
explicitly in project configuration before selecting a distributed backend.

```ts
import extRedis from "@veryfront/ext-redis";

export default defineConfig({
  extensions: [extRedis()],
});
```

Activating the extension registers factories only. A feature selects Redis
explicitly by selecting the provider-neutral distributed backend, for example
with `cache.render.type: "distributed"` or
`VF_CACHE_BACKEND=distributed`. `REDIS_URL` may supply connection details after
selection, but its presence never activates or selects the extension.

Missing extension registration, missing connection configuration, connection
failure, and command failure are surfaced to the caller. Core does not import
the package, discover it implicitly, or substitute an in-memory backend.

For CLI workflows, selection is explicit and provider-neutral:

```bash
veryfront workflow run publish-site --backend distributed
veryfront worker --project-dir . --entrypoint ./workflow-run.ts
```

The worker loads `veryfront.config.ts`, activates `ext-redis`, and asks the
provider for the bounded environment required by its isolated child process.
Core validates and transports that environment without interpreting Redis
configuration. The child entrypoint must also activate the project extensions
before it creates its distributed workflow backend.
