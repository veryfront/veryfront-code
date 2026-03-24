---
name: vf-performance
description: Use when reviewing code for performance issues, profiling hot paths, benchmarking before/after changes, or optimizing runtime, build, request latency, or bundle size
---

# Veryfront Performance Review & Benchmark

## Overview

This skill covers performance analysis across all layers of veryfront: runtime hot paths, request latency, build/compile time, and bundle size. Use it to identify regressions before they ship and to measure the impact of optimizations.

**Core principle:** Measure first, optimize second. Never optimize without a baseline.

## When to Use

- Before merging performance-sensitive PRs
- When investigating latency complaints or slowdowns
- After adding new middleware, transforms, or rendering paths
- When modifying hot paths (SSR, data fetching, API routing, transforms)
- When adding dependencies or changing build configuration

---

## Part 1: Performance Review Checklist

Run through this checklist when reviewing code for performance. Flag items that apply.

### Runtime Hot Paths

| Pattern | Risk | Where to Check |
|---------|------|----------------|
| Sync I/O in request path | Blocks event loop | API handlers, middleware, SSR |
| `await` in a loop (N+1) | Multiplied latency | Data fetchers, module loaders |
| Unbounded `Promise.all` | Memory spike | Batch operations, parallel fetches |
| Missing cache / cache miss storm | Redundant work | `FileCache`, module cache, transform cache |
| Regex on untrusted input | ReDoS potential | Route matching, content parsing |
| Large JSON.stringify/parse | CPU spike per request | Request/response serialization, SSR props |
| Module re-import on each request | Startup cost repeated | Worker script, dynamic imports |
| Unnecessary cloning | Memory churn | `request.clone()`, deep copies |

### Memory & Allocation

| Pattern | Risk | Where to Check |
|---------|------|----------------|
| Growing Map/Set without eviction | Memory leak | Caches, registries, module maps |
| Holding large buffers across requests | Heap pressure | SSR streams, file uploads |
| Closures capturing request scope | Prevents GC | Event handlers, callbacks |
| `new TextEncoder()` per call | Allocation churn | Use module-level singleton |
| Accumulating strings via `+=` | O(n^2) copying | HTML building, log formatting |

### Build & Compile

| Pattern | Risk | Where to Check |
|---------|------|----------------|
| New `--include` in compile args | Binary size increase | `compile-binary.ts` |
| Heavy dependency added | Compile time + size | `deno.json`, import maps |
| Unused imports in hot modules | Tree-shaking bloat | Barrel exports, re-exports |
| Type-only imports without `type` keyword | Runtime bundle inclusion | Missing `import type` |

### Request Latency

| Pattern | Risk | Where to Check |
|---------|------|----------------|
| Serial awaits that could parallelize | Wasted wall time | Data fetching, layout loading |
| Middleware running on static assets | Unnecessary overhead | Security, auth, CORS checks |
| Cold-start penalty per worker | First-request latency | Worker pool, module loading |
| DNS/TCP for every external call | Connection overhead | API clients, data fetchers |

---

## Part 2: Benchmarking

### Quick Profiling (No Setup)

```bash
# Time a single request
time curl -s -o /dev/null http://localhost:3000/

# Multiple requests with timing
for i in {1..10}; do
  curl -s -o /dev/null -w "%{time_total}\n" http://localhost:3000/
done | awk '{sum+=$1; count++} END {printf "avg: %.3fs, count: %d\n", sum/count, count}'

# Request with detailed timing breakdown
curl -w "\n  DNS: %{time_namelookup}s\n  Connect: %{time_connect}s\n  TTFB: %{time_starttransfer}s\n  Total: %{time_total}s\n" -o /dev/null -s http://localhost:3000/
```

### Deno Built-in Profiling

```bash
# CPU profile (generates V8 .cpuprofile)
deno run --allow-all --v8-flags=--prof src/index.ts
# Then process with: deno run --v8-flags=--prof-process isolate-*.log > profile.txt

# Heap snapshot
deno run --allow-all --inspect src/index.ts
# Connect Chrome DevTools to deno inspect URL, take heap snapshot
```

### Structured Benchmark (Before/After)

When measuring an optimization, follow this protocol:

```
1. BASELINE: Run benchmark on main branch
2. CHANGE: Apply optimization
3. MEASURE: Run same benchmark on feature branch
4. COMPARE: Report delta with confidence
```

#### Benchmark Script Template

```typescript
// bench/name.bench.ts
const WARMUP = 50;
const ITERATIONS = 500;

async function benchmark(name: string, fn: () => Promise<void> | void): Promise<void> {
  // Warmup
  for (let i = 0; i < WARMUP; i++) await fn();

  // Measure
  const times: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const p99 = times[Math.floor(times.length * 0.99)];
  const avg = times.reduce((a, b) => a + b, 0) / times.length;

  console.log(`${name}: avg=${avg.toFixed(2)}ms p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms`);
}
```

#### Deno Bench (Built-in)

```typescript
// name.bench.ts — run with: deno bench --allow-all
Deno.bench("operation name", async () => {
  // code to benchmark
});

Deno.bench({
  name: "operation with setup",
  fn: async () => { /* measured code */ },
  group: "feature-name",
  baseline: true,
});
```

### Load Testing

```bash
# Simple load test with hey (install: go install github.com/rakyll/hey@latest)
hey -n 1000 -c 50 http://localhost:3000/

# With wrk (if available)
wrk -t4 -c100 -d30s http://localhost:3000/

# Watch memory during load test
watch -n1 'curl -s http://localhost:3000/_vf_internal/health | grep -o "heap[^,]*"'
```

### Binary Size Tracking

```bash
# Check binary size before and after
ls -lh bin/veryfront | awk '{print $5}'

# Detailed size breakdown (what's in the binary)
deno info --json cli/main.ts | deno eval 'const d=JSON.parse(await new Response(Deno.stdin.readable).text()); console.log("Modules:", d.modules.length, "Size:", (d.modules.reduce((a,m)=>a+(m.size||0),0)/1024/1024).toFixed(1)+"MB")'
```

---

## Part 3: Common Veryfront Performance Patterns

### Cache Effectively

```typescript
// BAD: Compute on every request
function getConfig() {
  return JSON.parse(Deno.readTextFileSync("config.json"));
}

// GOOD: Cache with TTL
let cached: Config | null = null;
let cachedAt = 0;
function getConfig(): Config {
  if (cached && Date.now() - cachedAt < 60_000) return cached;
  cached = JSON.parse(Deno.readTextFileSync("config.json"));
  cachedAt = Date.now();
  return cached;
}
```

### Parallelize Independent Work

```typescript
// BAD: Serial awaits
const user = await getUser(id);
const posts = await getPosts(id);
const comments = await getComments(id);

// GOOD: Parallel
const [user, posts, comments] = await Promise.all([
  getUser(id),
  getPosts(id),
  getComments(id),
]);
```

### Avoid Unnecessary Serialization

```typescript
// BAD: Clone via JSON round-trip
const copy = JSON.parse(JSON.stringify(obj));

// GOOD: structuredClone (if needed) or spread
const copy = structuredClone(obj);
const shallow = { ...obj };
```

### Stream Large Responses

```typescript
// BAD: Buffer entire response
const html = await renderToString(element);
return new Response(html);

// GOOD: Stream
const stream = await renderToReadableStream(element);
return new Response(stream);
```

### Use Singleton Instances

```typescript
// BAD: New encoder per call
function encode(s: string) {
  return new TextEncoder().encode(s);
}

// GOOD: Module-level singleton
const encoder = new TextEncoder();
function encode(s: string) {
  return encoder.encode(s);
}
```

---

## Part 4: Performance Review Report Format

When reporting performance findings, use this structure:

```markdown
## Performance Review: [PR/Feature Name]

### Summary
- [One-line verdict: "No regressions" or "N issues found"]

### Hot Path Analysis
| Location | Issue | Impact | Severity |
|----------|-------|--------|----------|
| file:line | Description | Estimated impact | High/Med/Low |

### Benchmark Results (if applicable)
| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| p50 latency | Xms | Yms | +/-Z% |
| p99 latency | Xms | Yms | +/-Z% |
| Memory (RSS) | XMB | YMB | +/-Z% |
| Binary size | XMB | YMB | +/-Z% |

### Recommendations
1. [Actionable fix with code reference]
```

---

## Quick Reference: Performance Budgets

| Metric | Budget | Measurement |
|--------|--------|-------------|
| SSR render (p95) | < 100ms | `withSpan("ssr.*")` traces |
| API route (p95) | < 50ms | Request tracker logs |
| Data fetch (p95) | < 200ms | `data.fetch_server` spans |
| Module load | < 500ms | `render.load_modules` spans |
| Cold start (first request) | < 3s | Time to first 200 |
| Binary size | < 1.2GB | `ls -lh bin/veryfront` |
| Build time (compile) | < 3min | `time deno task build` |
| Memory (idle) | < 200MB RSS | `Deno.memoryUsage()` |
| Memory (under load) | < 1GB RSS | Load test + monitoring |
