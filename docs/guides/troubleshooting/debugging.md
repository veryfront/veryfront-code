# Debugging Guide

This guide helps you debug and troubleshoot common issues when developing with Veryfront.

## Table of Contents

- [Enable Debug Logging](#enable-debug-logging)
- [VSCode Debugging](#vscode-debugging)
- [Common Issues](#common-issues)
- [Performance Profiling](#performance-profiling)
- [Memory Issues](#memory-issues)
- [Test Debugging](#test-debugging)

---

## Enable Debug Logging

### Using Environment Variables

Set these variables to enable verbose logging:

```bash
# Enable Veryfront debug mode
VERYFRONT_DEBUG=true deno task dev

# Enable all debug output
DEBUG=veryfront:* deno task dev

# Enable specific module debug
DEBUG=veryfront:rendering:* deno task dev
DEBUG=veryfront:build:* deno task dev
DEBUG=veryfront:ai:* deno task dev
```

### Available Debug Namespaces

```typescript
// Core systems
DEBUG=veryfront:core:*        // Core utilities, config, errors
DEBUG=veryfront:types:*       // Type system
DEBUG=veryfront:platform:*    // Platform adapters

// Development
DEBUG=veryfront:build:*       // Build system
DEBUG=veryfront:server:*      // Dev/prod servers
DEBUG=veryfront:hot-reload:*  // Hot module replacement

// Runtime
DEBUG=veryfront:rendering:*   // SSR/RSC rendering
DEBUG=veryfront:routing:*     // Route matching
DEBUG=veryfront:modules:*     // Module system

// AI Features
DEBUG=veryfront:ai:*          // AI runtime, agents, tools
DEBUG=veryfront:ai:agents:*   // Agent execution
DEBUG=veryfront:ai:tools:*    // Tool discovery

// Data
DEBUG=veryfront:data:*        // Data fetching
DEBUG=veryfront:cache:*       // Caching layer
```

### Combining Debug Options

```bash
# Debug build AND rendering
DEBUG=veryfront:build:*,veryfront:rendering:* deno task dev

# Debug everything except routing
DEBUG=veryfront:* deno task dev --no-routing-debug
```

---

## VSCode Debugging

### Setup

1. **Ensure Deno extension is installed:**
   ```bash
   # Extension should be auto-recommended
   # Or install: denoland.vscode-deno
   ```

2. **Launch configurations are ready:**
   - `.vscode/launch.json` is configured
   - Press `Ctrl+Shift+D` (or `Cmd+Shift+D` on macOS)

### Debugging the Dev Server

1. Click Run & Debug sidebar (or `Ctrl+Shift+D`)
2. Select "Veryfront Dev Server"
3. Press Play or F5
4. Set breakpoints in your code (click line number)
5. Interact with your app to trigger breakpoints

### Debugging Tests

1. Open the test file you want to debug
2. Click Run & Debug
3. Select "Veryfront Tests (Current File)"
4. Press F5
5. Set breakpoints in test or source code

### Setting Breakpoints

```typescript
// Click on line number to toggle breakpoint
function myFunction() {
  const value = expensiveComputation(); // Set breakpoint here
  return value;
}

// Conditional breakpoint (right-click line number)
// Breaks only if: count > 100
```

### Debug Console

While debugging, use the Debug Console to:

```javascript
// Inspect variables
> myVariable

// Call functions
> myFunction()

// Evaluate expressions
> count + 10
```

---

## Common Issues

### Issue: Module Not Found Error

**Error:**
```
Cannot find module '@veryfront/rendering'
```

**Solution:**
1. Check import path matches `deno.json` imports
2. Verify barrel export exists: `src/rendering/index.ts`
3. Check for typos: `rendering` not `renderin`

**Debug:**
```bash
# Check what's exported
deno task typecheck

# Check import map
cat deno.json | grep "@veryfront/rendering"
```

---

### Issue: Build Fails Silently

**Symptoms:**
- Build task exits without error
- No output files generated
- `dist/` is empty

**Debug:**
```bash
# Enable build debug
DEBUG=veryfront:build:* deno task build

# Check build directory
ls -la dist/

# Verify source files exist
ls -la src/
```

**Common Causes:**
1. No pages found - check `pages/` directory exists
2. TypeScript errors - run `deno task typecheck`
3. Circular dependencies - run `deno task check:circular`

---

### Issue: Hot Reload Not Working

**Symptoms:**
- Changes don't appear in browser
- No "rebuilding" message in console
- Page shows old version

**Debug:**
```bash
# Check HMR is enabled
ENABLE_HMR=true DEBUG=veryfront:hot-reload:* deno task dev

# Check file watcher is working
DEBUG=veryfront:server:* deno task dev
# Should see "Watching: src/"
```

**Common Causes:**
1. File changes in `dist/` (ignored, rebuild from `src/`)
2. TypeScript errors blocking rebuild
3. Browser cache - use `Ctrl+Shift+R` to hard refresh

---

### Issue: Tests Timeout or Hang

**Symptoms:**
- Test seems to run forever
- Eventually fails with timeout
- No error message

**Debug:**
```bash
# Run with verbose output
deno task test -- --trace-ops

# Run single test file
deno test src/my-test.test.ts --allow-all

# Check for missing awaits
deno task lint:check-awaits
```

**Common Causes:**
1. Missing `await` on async function
2. Promise not resolving
3. Event listener not cleaned up

**Example:**
```typescript
// WRONG - missing await
it("should load data", async () => {
  const data = fetchData(); // Missing await!
  assertEquals(data, expected);
});

// CORRECT
it("should load data", async () => {
  const data = await fetchData();
  assertEquals(data, expected);
});
```

---

### Issue: Memory Exhaustion During Tests

**Symptoms:**
- Error: `Failed to allocate memory`
- Tests stop at random points
- High CPU usage

**Debug:**
```bash
# Use memory-aware batch runner
deno task test:batches

# Check memory limit
TEST_MEMORY_LIMIT=4096 deno task test:batches

# Profile memory usage
deno run --allow-all scripts/analyze-test-timings.ts
```

---

### Issue: Circular Dependency Error

**Symptoms:**
```
Circular dependency detected: A -> B -> A
```

**Debug:**
```bash
# Find circular dependencies
deno task check:circular

# Verbose circular check
deno run -A jsr:@cunarist/deno-circular-deps src/index.ts
```

**Fix:**
1. Identify the cycle: A requires B, B requires A
2. Move shared code to new module C
3. A imports from C, B imports from C (no cycle)

**Example:**
```typescript
// WRONG - circular
// ai/agent.ts imports from ai/tools
// ai/tools imports from ai/agent

// CORRECT - extract shared code
// ai/utils/shared.ts (has common code)
// ai/agent.ts imports from ai/utils/shared
// ai/tools.ts imports from ai/utils/shared
```

---

### Issue: Linting Errors Block Development

**Symptoms:**
```
error[no-console]: console usage is not allowed
```

**Debug:**
```bash
# See all lint errors
deno task lint

# See which rules are causing issues
deno lint src/ --rules

# Check our lint config
cat deno.json | grep -A 20 '"lint"'
```

**Common False Positives:**
1. `no-console` in CLI tools (legitimate console.log)
2. `require-await` on test describe blocks
3. `no-async-fn-in-promise-constructor`

**Workaround:**
```typescript
// Suppress specific linting rule
// deno-lint-ignore no-console
console.error("This is needed");

// Or update deno.json to exclude specific files
```

---

## Performance Profiling

### CPU Profiling

**Profile dev server startup:**
```bash
deno run --allow-all --prof src/cli/main.ts dev
# Runs for 10 seconds, generates prof file

# Analyze profile
deno run --prof-process isolate-*.prof > profile.json

# View in Chrome: chrome://tracing
# Load profile.json
```

### Memory Profiling

**Check memory usage during tests:**
```bash
# Run with memory stats
deno task test -- --allow-all --inspect-brk

# In DevTools, take heap snapshots
```

### Build Time Analysis

**Profile build performance:**
```bash
DEBUG=veryfront:build:* PROFILE=true deno task build 2>&1 | tee build.log

# Analyze build phases
cat build.log | grep "Phase"
```

**Expected Build Times:**
- Small project: <5 seconds
- Medium project: 5-15 seconds
- Large project: 15-60 seconds

---

## Memory Issues

### Out of Memory During Tests

**Symptoms:**
```
Failed to allocate memory (8MB requested)
```

**Solutions:**

```bash
# 1. Use batch runner (recommended)
deno task test:batches

# 2. Increase V8 heap size
TEST_MEMORY_LIMIT=8192 deno task test

# 3. Run tests in sequence (slower but safer)
TEST_CONCURRENCY=1 deno task test:batches

# 4. Profile memory usage
deno run --allow-all scripts/analyze-test-timings.ts
```

### Memory Leak in Dev Server

**Symptoms:**
- Dev server gets slower over time
- Memory usage constantly increases
- Eventually becomes unresponsive

**Debug:**
```bash
# Monitor memory usage
DEBUG=veryfront:server:* deno task dev

# Check for event listener leaks
deno task lint:check-awaits

# Restart dev server periodically
# (Add to monitoring/health check)
```

---

## Test Debugging

### Run Single Test

```bash
# Run one test file
deno test src/my-feature.test.ts --allow-all

# Run tests matching pattern
deno test --allow-all --filter "my pattern"

# Run with verbose output
deno test --allow-all --trace-ops src/my-feature.test.ts
```

### Debug Test Failures

**When a test fails:**

```typescript
import { assertEquals, assertRejects } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";

describe("Feature", () => {
  it("should work", async () => {
    const result = await myFunction();

    // Add debugging
    console.log("Result:", result); // Shows in output on failure
    assertEquals(result, expected);
  });
});
```

**Run with debug output:**
```bash
deno test src/my-feature.test.ts --allow-all 2>&1 | head -100
```

### Isolate Failing Test

```bash
# Mark other tests as pending (skip)
describe.skip("Other tests", () => {
  // These won't run
});

// Or use only()
it.only("this test runs", () => {
  // Only this test runs
});
```

### Test Coverage Analysis

```bash
# Generate coverage report
deno task test:coverage

# Generate HTML coverage report
deno task coverage:html

# Check specific file coverage
deno coverage coverage --include=src/my-file.ts
```

---

## Getting Help

### Troubleshooting Checklist

1. **Enable debug logging** - see what's happening
2. **Check error messages** - read them fully
3. **Try isolating** - reproduce with minimal code
4. **Check git status** - are there uncommitted changes?
5. **Clear cache** - `rm -rf dist/ node_modules/`
6. **Update dependencies** - `deno cache --reload`
7. **Restart dev server** - sometimes helps
8. **Check documentation** - see relevant docs/

### Useful Commands

```bash
# Type check specific file
deno check src/my-file.ts

# Lint specific file
deno lint src/my-file.ts

# Format and fix issues
deno fmt src/

# Check for circular dependencies
deno task check:circular

# Check for unawaited promises
deno task lint:check-awaits

# Check console usage
deno task lint:ban-console

# Check for deep imports
deno task lint:ban-deep-imports
```

### Getting Support

- **Issues:** https://github.com/veryfront/veryfront/issues
- **Discussions:** https://github.com/veryfront/veryfront/discussions
- **Documentation:** https://veryfront.com/docs
- **Community:** Join our Discord server

---

## Tips & Tricks

### Reload Just Source Files

```bash
# Don't rebuild, just reload source
ctrl+c # stop dev server
deno cache --reload src/index.ts
deno task dev
```

### Compare Two Implementations

```bash
# Save current version
cp src/my-feature.ts src/my-feature.ts.bak

# Try new version
# ... make changes ...

# Compare
diff src/my-feature.ts src/my-feature.ts.bak
```

### Test Specific Module

```bash
# Test only rendering module
deno task test:unit -- --filter "rendering"

# Test everything except AI
deno task test -- --filter "^(?!.*ai)"
```

### Generate Test Coverage for Module

```bash
# Coverage for just core module
deno test --coverage=coverage src/core/**/*.test.ts
deno coverage coverage --include=src/core --lcov > core.lcov
```

---

Good luck debugging! Remember: slow down, enable debug logging, and read the error messages carefully.

