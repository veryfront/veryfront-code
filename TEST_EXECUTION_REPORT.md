# Test Execution Report

## Summary

Attempted to run the Veryfront test suite in a sandboxed CI environment. Tests could not be executed due to network restrictions preventing dependency downloads.

## Environment Details

- **Operating System**: Linux (Azure CI environment)
- **Deno Version**: 2.6.8 (stable, release, x86_64-unknown-linux-gnu)
- **Node Version**: v24.13.0
- **DNS Configuration**: Azure internal DNS (168.63.129.16)
- **Network**: Restricted environment with blocked external domain resolution

## Test Configuration

- **Test Command**: `deno task test`
- **Test Script** (from `deno.json` line 282):
  ```bash
  VF_DISABLE_LRU_INTERVAL=1 \
  SSR_TRANSFORM_PER_PROJECT_LIMIT=0 \
  REVALIDATION_PER_PROJECT_LIMIT=0 \
  NODE_ENV=production \
  LOG_FORMAT=text \
  deno test --no-check --parallel --allow-all \
    '--ignore=tests/e2e,tests/integration/compiled-binary-e2e.test.ts' \
    --unstable-worker-options --unstable-net
  ```

## Issues Encountered

### 1. Network Restrictions

The sandboxed environment has DNS resolution blocked for external domains:

```
$ nslookup esm.sh
Server: 127.0.0.53
Address: 127.0.0.53#53

** server can't find esm.sh: REFUSED
```

### 2. Blocked Domains

The following domains required by tests are inaccessible:
- `esm.sh` - React, React-DOM, Tailwind CSS, and other ESM modules
- `registry.npmjs.org` - npm packages
- `jsr.io` - JSR packages (Deno standard library)

### 3. Dependency Download Failures

Example error when attempting to run tests:

```
error: Import 'https://esm.sh/react@19.1.1?target=es2022&deps=csstype@3.2.3' failed.
    0: error sending request for url: client error (Connect): dns error: 
       failed to lookup address information: No address associated with hostname
```

## Normal CI Workflow

According to `.github/workflows/cicd.yml`, the tests are normally run on `veryfront-k8s-runners` with:

1. **Setup**: Uses `.github/actions/setup-deno` action
2. **Cache Warming**: Pre-downloads dependencies with `deno cache --reload=https://esm.sh src/index.ts`
3. **Test Execution**: Runs tests with `--no-lock` flag after cache is warmed

### Test Suites

The CI runs multiple test suites:
- **Unit tests**: `deno task test:unit`
- **Integration tests**: `deno task test:integration`
- **Binary E2E tests**: `deno task test:e2e:binary`

## Recommendations

### For Running Tests Locally

1. **Ensure network access** to external domains
2. **Warm the Deno cache** before running tests:
   ```bash
   deno cache --reload=https://esm.sh src/index.ts
   ```
3. **Run tests**:
   ```bash
   deno task test
   ```

### For Sandboxed/Offline Environments

1. **Pre-cache dependencies** in an environment with network access:
   ```bash
   deno cache --reload src/index.ts cli/main.ts
   ```
2. **Vendor dependencies** using Deno's vendor feature:
   ```bash
   deno vendor src/index.ts
   ```
3. **Configure network security** to allow the following domains:
   - `esm.sh`
   - `registry.npmjs.org`
   - `jsr.io`
   - `deno.land`

### For CI/CD Pipelines

Use runners with network access (like the `veryfront-k8s-runners` configured in `.github/workflows/cicd.yml`) that allow external domain resolution.

## Test Structure

The repository contains:
- **Unit tests**: Test files located alongside source code (e.g., `src/**/*.test.ts`)
- **Integration tests**: Located in `tests/integration/`
- **E2E tests**: Located in `tests/e2e/`

Example test file: `src/workflow/types.test.ts`
```typescript
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateId, parseDuration, validateRetryConfig } from "./types.ts";

describe("parseDuration", () => {
  it("should parse seconds", () => {
    assertEquals(parseDuration("30s"), 30000);
  });
  // ... more tests
});
```

## Conclusion

The Veryfront test suite requires network access to download dependencies from external sources (esm.sh, npm registry, JSR). Tests cannot be executed in the current sandboxed environment due to DNS resolution being blocked. To run tests successfully, either:

1. Use an environment with unrestricted network access
2. Pre-cache all dependencies before network restrictions are applied
3. Configure the network security rules to allow required domains

The test suite is properly configured and should work correctly in environments with appropriate network access, as demonstrated by the working CI/CD pipeline configuration.
