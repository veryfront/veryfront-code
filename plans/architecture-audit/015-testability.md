# Chapter 015: Testability and Preventing Breaking Changes

## Executive Summary

The veryfront-renderer codebase has **significant testing gaps** in critical areas identified by this architecture audit. While there is a good foundation of integration tests (~100+ test files), the tests are primarily **happy-path focused** and do not adequately cover:

1. Cross-adapter consistency (Local vs API vs GitHub)
2. Multi-tenant isolation under concurrent load
3. Cache consistency (hit vs miss behavior)
4. Bundle dependency invalidation
5. Router divergence edge cases
6. Deployment mode misconfigurations

**Key Finding**: Many of the bugs documented in chapters 001-014 would have been caught with proper test coverage. This chapter defines the test patterns needed to prevent these issues from recurring.

---

## Table of Contents

1. [Current Test Coverage Analysis](#1-current-test-coverage-analysis)
2. [Missing Critical Tests](#2-missing-critical-tests-based-on-audit-findings)
3. [Test Patterns Needed](#3-test-patterns-needed)
4. [CI/CD Requirements](#4-cicd-requirements)
5. [Test Infrastructure Gaps](#5-test-infrastructure-gaps)
6. [Recommended Test Files](#6-recommended-test-files-to-create)

---

## 1. Current Test Coverage Analysis

### 1.1 Test Inventory

The codebase contains approximately **120+ test files** across several categories:

| Category | Location | Files | Coverage Quality |
|----------|----------|-------|------------------|
| Integration | `tests/integration/` | ~90 | Good for happy paths |
| Unit | `src/**/*.test.ts` | ~15 | Sparse |
| AI/Agent | `tests/ai/` | 3 | Minimal |
| Helpers | `tests/_helpers/` | 5 | Good infrastructure |
| Examples | `tests/_examples/` | 2 | Reference patterns |

### 1.2 Areas with Good Coverage

**Renderer Core** (`tests/integration/renderer/`):
- State isolation between renderers: `state-isolation.test.ts`
- Tenant module isolation: `tenant-module-isolation.test.ts`
- Tenant MDX cache isolation: `tenant-mdx-cache-isolation.test.ts`
- Cache isolation (partial): `cache-isolation.test.ts`
- Reserved components: `reserved-components.test.ts`
- Nested streaming: `app-router-nested-streaming.test.ts`

**Server/RSC** (`tests/integration/server/rsc/`):
- Handler isolation: `handler-isolation.test.ts`
- Flight streaming: `flight.test.ts`, `streaming.test.ts`
- Client modules: `client-modules.test.ts`
- Hydration: `hydration.test.ts`

**Routing** (`tests/integration/routing/`):
- Router detection: `router-detection.test.ts`

**Full Lifecycle** (`tests/integration/`):
- End-to-end rendering: `full-lifecycle.test.ts`

### 1.3 Critical Areas with NO or INSUFFICIENT Tests

| Area | Risk | Current State |
|------|------|---------------|
| **Cross-Adapter Consistency** | HIGH | No tests comparing Local vs API vs GitHub adapter output |
| **Concurrent Multi-Tenant** | HIGH | Only sequential tests, no concurrent stress tests |
| **Cache HIT/MISS Parity** | HIGH | No tests verifying cached vs fresh responses match |
| **Bundle Dependency Invalidation** | HIGH | No tests for dependency change detection |
| **Deployment Mode Combinations** | MEDIUM | No tests for NODE_ENV/PROXY_MODE/productionMode combinations |
| **Semaphore Exhaustion** | HIGH | No tests for global resource contention |
| **Error State Leakage** | MEDIUM | No tests for `failedComponents` map cross-project leakage |
| **TTL Mismatch Effects** | MEDIUM | No tests for cache tier TTL inconsistencies |
| **FRAMEWORK_ROOT Path** | MEDIUM | No tests for path portability across environments |

### 1.4 Integration Tests That Run Through Full Render Pipeline

The following tests exercise the full SSR pipeline:

1. `tests/integration/full-lifecycle.test.ts` - Most comprehensive
2. `tests/integration/renderer/state-isolation.test.ts` - Multi-renderer
3. `tests/integration/renderer/tenant-mdx-cache-isolation.test.ts` - Multi-tenant
4. `tests/integration/server/rsc/streaming.test.ts` - RSC path

**Gap**: None of these tests compare results across different adapter types or deployment modes.

---

## 2. Missing Critical Tests (Based on Audit Findings)

### 2.1 Adapter Divergence (Chapter 001)

**Issues Identified**:
- Layout discovery differs between Local and API adapters
- `collectAPILayoutConfiguration()` ignores nested App Router layouts
- Entity ID resolution differs by adapter

**Tests Needed**:

```typescript
// tests/integration/cross-adapter/layout-consistency.test.ts
describe.each(['local', 'veryfront-api'])('Layout Discovery: %s adapter', (adapterType) => {
  it('discovers root layout.tsx', async () => {
    const adapter = await createAdapterWithFixture(adapterType, {
      'app/layout.tsx': 'export default function Root({children}) { return <div className="root">{children}</div> }',
      'app/page.tsx': 'export default function Home() { return <h1>Home</h1> }',
    });

    const layouts = await collectLayouts('', adapter);
    expect(layouts.map(l => l.path)).toContain('app/layout.tsx');
  });

  it('discovers nested layouts in app router', async () => {
    const adapter = await createAdapterWithFixture(adapterType, {
      'app/layout.tsx': 'export default function Root({children}) { return children }',
      'app/dashboard/layout.tsx': 'export default function Dashboard({children}) { return <div className="dashboard">{children}</div> }',
      'app/dashboard/page.tsx': 'export default function Page() { return <h1>Dashboard</h1> }',
    });

    const layouts = await collectLayouts('dashboard', adapter);
    expect(layouts.map(l => l.path)).toEqual([
      'app/layout.tsx',
      'app/dashboard/layout.tsx',
    ]);
  });
});

// tests/integration/cross-adapter/render-consistency.test.ts
describe('Cross-Adapter Render Consistency', () => {
  const fixture = {
    'app/layout.tsx': `export default function Layout({children}) { return <html><body>{children}</body></html> }`,
    'app/page.tsx': `export default function Home() { return <h1>Hello World</h1> }`,
    'app/about/page.tsx': `export default function About() { return <h1>About</h1> }`,
  };

  it('produces identical HTML across adapters', async () => {
    const [localResult, apiResult] = await Promise.all([
      renderWithAdapter('local', fixture, '/'),
      renderWithAdapter('veryfront-api', fixture, '/'),
    ]);

    // Normalize HTML (remove timestamps, IDs) and compare
    expect(normalizeHtml(localResult.html)).toEqual(normalizeHtml(apiResult.html));
  });
});
```

### 2.2 Global State / Blast Radius (Chapter 002)

**Issues Identified**:
- `transformSemaphore` shared across all projects
- `failedComponents` map can leak errors between projects
- `globalCrossProjectCache` corruption affects all projects
- `globalInProgress` hanging promises cause deadlocks

**Tests Needed**:

```typescript
// tests/integration/multi-tenant/concurrent-isolation.test.ts
describe('Multi-Tenant Concurrent Isolation', () => {
  it('concurrent requests to different projects have zero data leakage', async () => {
    await withTestContext('tenant-alpha', async (ctxAlpha) => {
      await withTestContext('tenant-beta', async (ctxBeta) => {
        // Set up distinct content
        await writeTextFile(join(ctxAlpha.projectDir, 'app/page.tsx'),
          `export default function() { return <div data-project="alpha">Alpha Content</div> }`);
        await writeTextFile(join(ctxBeta.projectDir, 'app/page.tsx'),
          `export default function() { return <div data-project="beta">Beta Content</div> }`);

        // Run 50 concurrent requests to each project
        const requests = [];
        for (let i = 0; i < 50; i++) {
          requests.push(renderWithProject(ctxAlpha, '/'));
          requests.push(renderWithProject(ctxBeta, '/'));
        }

        const results = await Promise.all(requests);

        // Verify NO cross-contamination
        const alphaResults = results.filter((_, i) => i % 2 === 0);
        const betaResults = results.filter((_, i) => i % 2 === 1);

        for (const r of alphaResults) {
          expect(r.html).toContain('data-project="alpha"');
          expect(r.html).not.toContain('data-project="beta"');
        }
        for (const r of betaResults) {
          expect(r.html).toContain('data-project="beta"');
          expect(r.html).not.toContain('data-project="alpha"');
        }
      });
    });
  });

  it('one project failure does not block other projects', async () => {
    await withTestContext('tenant-good', async (ctxGood) => {
      await withTestContext('tenant-bad', async (ctxBad) => {
        // Good project has valid content
        await writeTextFile(join(ctxGood.projectDir, 'app/page.tsx'),
          `export default function() { return <h1>Good</h1> }`);

        // Bad project has syntax error
        await writeTextFile(join(ctxBad.projectDir, 'app/page.tsx'),
          `export default function() { return <h1>Unclosed`); // Intentional error

        // Render bad project first (should fail)
        const badResult = await renderWithProject(ctxBad, '/').catch(e => ({ error: e }));
        expect(badResult.error).toBeDefined();

        // Good project should still work
        const goodResult = await renderWithProject(ctxGood, '/');
        expect(goodResult.html).toContain('Good');
      });
    });
  });

  it('semaphore exhaustion is per-project', async () => {
    // This test requires mocking the semaphore or measuring timing
    await withTestContext('tenant-heavy', async (ctxHeavy) => {
      await withTestContext('tenant-light', async (ctxLight) => {
        // Create heavy project with many components
        for (let i = 0; i < 20; i++) {
          await writeTextFile(
            join(ctxHeavy.projectDir, `app/comp${i}/page.tsx`),
            `export default function() { return <h1>Component ${i}</h1> }`
          );
        }

        // Light project has simple page
        await writeTextFile(join(ctxLight.projectDir, 'app/page.tsx'),
          `export default function() { return <h1>Light</h1> }`);

        // Start heavy renders
        const heavyPromises = Array.from({ length: 20 }, (_, i) =>
          renderWithProject(ctxHeavy, `/comp${i}`)
        );

        // Light project should not be blocked
        const startTime = Date.now();
        const lightResult = await renderWithProject(ctxLight, '/');
        const duration = Date.now() - startTime;

        expect(lightResult.html).toContain('Light');
        expect(duration).toBeLessThan(5000); // Should not wait for heavy project

        await Promise.all(heavyPromises);
      });
    });
  });
});
```

### 2.3 Cache Behavior (Chapter 003)

**Issues Identified**:
- Cache HITs skip validation that MISSes perform
- File paths in cache may reference non-existent locations
- TTL mismatches between tiers

**Tests Needed**:

```typescript
// tests/integration/cache/hit-miss-consistency.test.ts
describe('Cache HIT vs MISS Consistency', () => {
  it('cache hit produces same result as cache miss', async () => {
    await withTestContext('cache-test', async (ctx) => {
      await writeTextFile(join(ctx.projectDir, 'app/page.tsx'),
        `export default function() { return <h1>Hello</h1> }`);

      // First request - cache MISS
      const missResult = await renderWithProject(ctx, '/');

      // Second request - cache HIT
      const hitResult = await renderWithProject(ctx, '/');

      // Results should be identical
      expect(normalizeHtml(hitResult.html)).toEqual(normalizeHtml(missResult.html));
    });
  });

  it('stale cache paths are detected and rejected', async () => {
    await withTestContext('cache-stale', async (ctx) => {
      await writeTextFile(join(ctx.projectDir, 'app/page.tsx'),
        `export default function() { return <h1>Original</h1> }`);

      // Render to populate cache
      await renderWithProject(ctx, '/');

      // Simulate cache entry with invalid path (from different environment)
      await injectStaleCacheEntry(ctx.projectId, '/fake/path/module.js');

      // Render should fallback to fresh transform, not crash
      const result = await renderWithProject(ctx, '/');
      expect(result.html).toContain('Original');
    });
  });

  it('transform cache invalidates when source changes', async () => {
    await withTestContext('cache-invalidate', async (ctx) => {
      const pagePath = join(ctx.projectDir, 'app/page.tsx');
      await writeTextFile(pagePath, `export default function() { return <h1>Version 1</h1> }`);

      // First render
      const v1 = await renderWithProject(ctx, '/');
      expect(v1.html).toContain('Version 1');

      // Clear cache and update file
      await clearProjectCache(ctx.projectId);
      await writeTextFile(pagePath, `export default function() { return <h1>Version 2</h1> }`);

      // Second render should reflect change
      const v2 = await renderWithProject(ctx, '/');
      expect(v2.html).toContain('Version 2');
      expect(v2.html).not.toContain('Version 1');
    });
  });
});
```

### 2.4 Bundle Dependencies (Chapter 004)

**Issues Identified**:
- `depsHash` field defined but never used
- Changing a dependency does not invalidate dependent bundles

**Tests Needed**:

```typescript
// tests/integration/cache/dependency-invalidation.test.ts
describe('Bundle Dependency Invalidation', () => {
  it('changing a dependency invalidates dependent bundles', async () => {
    await withTestContext('dep-test', async (ctx) => {
      // Create a shared utility
      await writeTextFile(
        join(ctx.projectDir, 'lib/utils.ts'),
        `export const greeting = 'Hello';`
      );

      // Create page that imports utility
      await writeTextFile(
        join(ctx.projectDir, 'app/page.tsx'),
        `import { greeting } from '../lib/utils';
         export default function() { return <h1>{greeting}</h1> }`
      );

      // First render
      const v1 = await renderWithProject(ctx, '/');
      expect(v1.html).toContain('Hello');

      // Update the dependency (NOT the page)
      await writeTextFile(
        join(ctx.projectDir, 'lib/utils.ts'),
        `export const greeting = 'Goodbye';`
      );

      // Clear cache to simulate invalidation
      await clearProjectCache(ctx.projectId);

      // Second render should reflect dependency change
      const v2 = await renderWithProject(ctx, '/');
      expect(v2.html).toContain('Goodbye');
      expect(v2.html).not.toContain('Hello');
    });
  });

  it('transitive dependency changes propagate', async () => {
    await withTestContext('transitive-dep', async (ctx) => {
      // A -> B -> C dependency chain
      await writeTextFile(join(ctx.projectDir, 'lib/c.ts'), `export const value = 'C1';`);
      await writeTextFile(join(ctx.projectDir, 'lib/b.ts'),
        `import { value } from './c'; export const derived = value + '-B';`);
      await writeTextFile(join(ctx.projectDir, 'app/page.tsx'),
        `import { derived } from '../lib/b';
         export default function() { return <p>{derived}</p> }`);

      const v1 = await renderWithProject(ctx, '/');
      expect(v1.html).toContain('C1-B');

      // Update C (transitive dependency)
      await writeTextFile(join(ctx.projectDir, 'lib/c.ts'), `export const value = 'C2';`);
      await clearProjectCache(ctx.projectId);

      const v2 = await renderWithProject(ctx, '/');
      expect(v2.html).toContain('C2-B');
    });
  });
});
```

### 2.5 Router Divergence (Chapter 005)

**Issues Identified**:
- App Router and Pages Router have different implementations
- `getAllPages()` misses App Router pages
- Dynamic route handling differs

**Tests Needed**:

```typescript
// tests/integration/routing/router-equivalence.test.ts
describe('App Router vs Pages Router Equivalence', () => {
  it('same route produces equivalent results in both routers', async () => {
    await withTestContext('router-app', async (ctxApp) => {
      // App Router: app/about/page.tsx
      await writeTextFile(
        join(ctxApp.projectDir, 'app/about/page.tsx'),
        `export default function() { return <h1>About Page</h1> }`
      );

      await withTestContext('router-pages', async (ctxPages) => {
        // Remove app directory to force Pages Router
        await remove(join(ctxPages.projectDir, 'app'), { recursive: true });

        // Pages Router: pages/about.tsx
        await writeTextFile(
          join(ctxPages.projectDir, 'pages/about.tsx'),
          `export default function() { return <h1>About Page</h1> }`
        );

        const appResult = await renderWithProject(ctxApp, '/about');
        const pagesResult = await renderWithProject(ctxPages, '/about');

        // Core content should match
        expect(appResult.html).toContain('About Page');
        expect(pagesResult.html).toContain('About Page');
      });
    });
  });

  it('getAllPages() includes App Router pages', async () => {
    await withTestContext('getallpages', async (ctx) => {
      await writeTextFile(join(ctx.projectDir, 'app/page.tsx'),
        `export default function() { return <h1>Home</h1> }`);
      await writeTextFile(join(ctx.projectDir, 'app/about/page.tsx'),
        `export default function() { return <h1>About</h1> }`);
      await writeTextFile(join(ctx.projectDir, 'app/blog/[slug]/page.tsx'),
        `export default function() { return <h1>Blog Post</h1> }`);

      const pages = await getAllPages(ctx.projectDir);

      expect(pages).toContain('/');
      expect(pages).toContain('/about');
      // Dynamic routes may or may not be included depending on implementation
    });
  });

  it('dynamic params work identically in both routers', async () => {
    await withTestContext('dynamic-app', async (ctxApp) => {
      await writeTextFile(
        join(ctxApp.projectDir, 'app/posts/[id]/page.tsx'),
        `export default function({ params }) { return <p>Post: {params.id}</p> }`
      );

      await withTestContext('dynamic-pages', async (ctxPages) => {
        await remove(join(ctxPages.projectDir, 'app'), { recursive: true });
        await writeTextFile(
          join(ctxPages.projectDir, 'pages/posts/[id].tsx'),
          `export default function({ params }) { return <p>Post: {params.id}</p> }`
        );

        const appResult = await renderWithProject(ctxApp, '/posts/42');
        const pagesResult = await renderWithProject(ctxPages, '/posts/42');

        expect(appResult.html).toContain('Post:');
        expect(appResult.html).toContain('42');
        expect(pagesResult.html).toContain('Post:');
        expect(pagesResult.html).toContain('42');
      });
    });
  });
});
```

### 2.6 Deployment Modes (Chapter 014)

**Issues Identified**:
- Missing `NODE_ENV` defaults to development
- Missing `releaseId` in production mode causes errors
- `isLocalDev` can leak features to production

**Tests Needed**:

```typescript
// tests/integration/deployment/mode-combinations.test.ts
describe('Deployment Mode Combinations', () => {
  it('preview mode serves draft content', async () => {
    await withTestContext('preview-mode', async (ctx) => {
      ctx.setEnv({ NODE_ENV: 'production' });

      await writeTextFile(join(ctx.projectDir, 'app/page.tsx'),
        `export default function() { return <h1>Draft Content</h1> }`);

      const result = await renderWithProject(ctx, '/', {
        headers: { 'x-environment': 'preview' },
      });

      expect(result.html).toContain('Draft Content');
    });
  });

  it('production mode serves published content', async () => {
    // This test requires mocking the API adapter
    await withTestContext('production-mode', async (ctx) => {
      ctx.setEnv({
        NODE_ENV: 'production',
        PROXY_MODE: '1',
        PRODUCTION_MODE: '1',
      });

      const result = await renderWithProject(ctx, '/', {
        headers: {
          'x-environment': 'production',
          'x-release-id': 'release-123',
        },
      });

      // Should not throw "Missing releaseId" error
      expect(result.status).toBe(200);
    });
  });

  it('missing NODE_ENV defaults safely', async () => {
    await withTestContext('missing-env', async (ctx) => {
      // Ensure NODE_ENV is not set
      ctx.setEnv({ NODE_ENV: undefined });

      await writeTextFile(join(ctx.projectDir, 'app/page.tsx'),
        `export default function() { return <h1>Works</h1> }`);

      // Should default to development mode, not crash
      const result = await renderWithProject(ctx, '/');
      expect(result.html).toContain('Works');
    });
  });

  it('isLocalDev is false when NODE_ENV=production', async () => {
    await withTestContext('localdev-check', async (ctx) => {
      ctx.setEnv({ NODE_ENV: 'production' });

      const envConfig = createEnvConfig();
      expect(envConfig.isLocalDev).toBe(false);
    });
  });

  it('error overlay is hidden in production', async () => {
    await withTestContext('error-prod', async (ctx) => {
      ctx.setEnv({ NODE_ENV: 'production' });

      await writeTextFile(join(ctx.projectDir, 'app/page.tsx'),
        `export default function() { throw new Error('Test error'); }`);

      const result = await renderWithProject(ctx, '/');

      expect(result.status).toBe(500);
      // Should NOT contain stack trace
      expect(result.html).not.toContain('Test error');
      expect(result.html).not.toContain('.tsx:');
    });
  });
});
```

---

## 3. Test Patterns Needed

### 3.1 Cross-Adapter Consistency Tests

```typescript
// Pattern: Run same test across all adapter types
describe.each(['local', 'veryfront-api', 'github'])('Feature: %s adapter', (adapterType) => {
  it('behaves identically', async () => {
    const adapter = await createAdapter(adapterType, fixtures);
    const result = await exerciseFeature(adapter);
    expect(result).toMatchSnapshot(); // Snapshot per adapter should match
  });
});
```

### 3.2 Multi-Tenant Isolation Tests

```typescript
// Pattern: Concurrent requests to different projects
it('concurrent requests to different projects are isolated', async () => {
  const [resultA, resultB] = await Promise.all([
    renderProject('alpha', '/page'),
    renderProject('beta', '/page'),
  ]);
  expect(resultA.html).not.toContain('beta');
  expect(resultB.html).not.toContain('alpha');
});
```

### 3.3 Cache Consistency Tests

```typescript
// Pattern: Compare cache hit vs miss
it('cache hit equals cache miss', async () => {
  const miss = await render('/page'); // Cold
  const hit = await render('/page');  // Cached
  expect(hit.html).toEqual(miss.html);
});
```

### 3.4 Breaking Change Detection Tests

**Snapshot Tests for Public API Surfaces**:
```typescript
// tests/api-surface/renderer-options.test.ts
it('RendererOptions interface is stable', () => {
  const schema = generateSchema<RendererOptions>();
  expect(schema).toMatchSnapshot();
});
```

**Contract Tests for Config Schema**:
```typescript
// tests/contracts/config-schema.test.ts
it('accepts valid veryfront.config.ts', () => {
  const config = loadConfig('./fixtures/valid-config.ts');
  expect(validateConfig(config).valid).toBe(true);
});

it('rejects invalid config with helpful error', () => {
  const result = validateConfig({ invalid: true });
  expect(result.valid).toBe(false);
  expect(result.errors[0]).toContain('unknown property');
});
```

**Golden File Tests for Render Output**:
```typescript
// tests/golden/render-output.test.ts
it('renders homepage matching golden file', async () => {
  const result = await render('/');
  expect(normalizeHtml(result.html)).toMatchFile('./golden/homepage.html');
});
```

---

## 4. CI/CD Requirements

### 4.1 Tests to Run on Every PR

| Test Category | Command | Timeout | Required |
|---------------|---------|---------|----------|
| Unit Tests | `deno task test:unit` | 2 min | Yes |
| Fast Integration | `deno task test:integration --filter=fast` | 5 min | Yes |
| Type Check | `deno task typecheck` | 3 min | Yes |
| Lint | `deno task lint` | 1 min | Yes |

### 4.2 Tests to Run Before Release

| Test Category | Command | Timeout | Required |
|---------------|---------|---------|----------|
| Full Integration | `deno task test:integration` | 30 min | Yes |
| Cross-Adapter | `deno task test:cross-adapter` | 15 min | Yes |
| Multi-Tenant Stress | `deno task test:stress` | 10 min | Yes |
| Performance Regression | `deno task test:perf` | 5 min | Yes |
| Snapshot Update Check | `deno task test:snapshots --ci` | 5 min | Yes |

### 4.3 Performance Regression Tests

```typescript
// tests/performance/render-benchmark.test.ts
describe('Performance Regression', () => {
  it('renders simple page in < 100ms', async () => {
    const start = performance.now();
    await render('/simple');
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(100);
  });

  it('renders complex page in < 500ms', async () => {
    const start = performance.now();
    await render('/complex-with-data');
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(500);
  });

  it('cold start time < 2s', async () => {
    await clearAllCaches();

    const start = performance.now();
    await render('/');
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(2000);
  });
});
```

### 4.4 Multi-Project Smoke Tests

```typescript
// tests/smoke/multi-project.test.ts
describe('Multi-Project Smoke Tests', () => {
  const projectFixtures = [
    'minimal',
    'with-tailwind',
    'with-mdx',
    'with-api-routes',
    'with-rsc',
    'with-nested-layouts',
  ];

  for (const fixture of projectFixtures) {
    it(`renders ${fixture} project without errors`, async () => {
      const projectDir = `./fixtures/${fixture}`;
      const result = await renderProject(projectDir, '/');

      expect(result.status).toBe(200);
      expect(result.html).toContain('<!DOCTYPE html>');
    });
  }
});
```

---

## 5. Test Infrastructure Gaps

### 5.1 Current Infrastructure Capabilities

**Available** (`tests/_helpers/`):
- `TestContext` class for isolated test environments
- `withTestContext()` helper for automatic cleanup
- Port allocation without conflicts
- Environment variable management
- Server lifecycle management (dev/production)
- `cleanupBundler()` for resource cleanup

**Partially Available**:
- Cross-adapter testing (local adapter only)
- Concurrent test execution (resource leaks possible)

### 5.2 Infrastructure Needed

| Capability | Current State | Needed |
|------------|--------------|--------|
| Create API adapter in tests | Not available | Mock adapter or test API |
| Create GitHub adapter in tests | Not available | Mock adapter |
| Inject cache entries | Not available | Cache manipulation API |
| Simulate cross-pod scenario | Not available | Multiple server instances |
| Measure performance | Manual only | Automated benchmark harness |
| Generate test fixtures | Manual files | Programmatic generation |

### 5.3 Questions to Answer

1. **Can we easily spin up different adapters in tests?**
   - Local adapter: Yes, via `getLocalAdapter()`
   - API adapter: No, requires real API or mocking
   - GitHub adapter: No, requires GitHub API

2. **Can we simulate multi-tenant scenarios?**
   - Sequential: Yes, via `withTestContext()`
   - Concurrent: Partially, resource leaks possible

3. **Do we have fixtures for all project types?**
   - Basic fixtures: Yes
   - Complex real-world: No
   - API adapter content: No

---

## 6. Recommended Test Files to Create

### 6.1 Critical (Must Have)

| File | Purpose | Priority |
|------|---------|----------|
| `tests/integration/cross-adapter/render-consistency.test.ts` | Verify identical output across adapters | P0 |
| `tests/integration/cross-adapter/layout-consistency.test.ts` | Verify layout discovery works for all adapters | P0 |
| `tests/integration/multi-tenant/concurrent-isolation.test.ts` | Concurrent multi-tenant isolation | P0 |
| `tests/integration/cache/hit-miss-consistency.test.ts` | Cache HIT equals MISS | P0 |
| `tests/integration/cache/dependency-invalidation.test.ts` | Dependency changes invalidate cache | P0 |

### 6.2 High Priority

| File | Purpose | Priority |
|------|---------|----------|
| `tests/integration/routing/router-equivalence.test.ts` | App Router vs Pages Router parity | P1 |
| `tests/integration/deployment/mode-combinations.test.ts` | All deployment mode permutations | P1 |
| `tests/integration/multi-tenant/blast-radius.test.ts` | One project failure doesn't affect others | P1 |
| `tests/regression/breaking-changes.test.ts` | Public API stability | P1 |

### 6.3 Medium Priority

| File | Purpose | Priority |
|------|---------|----------|
| `tests/performance/render-benchmark.test.ts` | Performance regression detection | P2 |
| `tests/smoke/multi-project.test.ts` | Smoke tests for various project types | P2 |
| `tests/contracts/config-schema.test.ts` | Config validation contracts | P2 |
| `tests/golden/render-output.test.ts` | Golden file comparisons | P2 |

### 6.4 Example Implementation: Cross-Adapter Consistency Test

```typescript
// tests/integration/cross-adapter/render-consistency.test.ts

import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { withTestContext } from "../../_helpers/context.ts";
import { createRenderer } from "../../../src/rendering/index.ts";
import { getLocalAdapter } from "@veryfront/platform/adapters/registry.ts";
import { join } from "@veryfront/compat/path";
import { writeTextFile, mkdir } from "@veryfront/compat/fs.ts";

/**
 * Helper to normalize HTML for comparison
 * Removes dynamic content like timestamps, UUIDs, etc.
 */
function normalizeHtml(html: string): string {
  return html
    .replace(/data-vf-[a-z]+="[^"]*"/g, '') // Remove veryfront data attributes
    .replace(/<!--.*?-->/gs, '') // Remove comments
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

describe("Cross-Adapter Render Consistency", {
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  describe("Basic Page Rendering", () => {
    it("local adapter renders simple page correctly", async () => {
      await withTestContext("cross-adapter-local-simple", async (ctx) => {
        await writeTextFile(
          join(ctx.projectDir, "app", "page.tsx"),
          `export default function Home() { return <h1>Hello World</h1> }`
        );

        const renderer = await createRenderer({
          projectDir: ctx.projectDir,
          mode: "development",
        });

        const result = await renderer.renderPage("");
        assertEquals(result.html.includes("Hello World"), true);

        if (renderer.clearAllState) await renderer.clearAllState();
      });
    });

    // When API adapter testing is available:
    // it("api adapter produces same output as local adapter", async () => {
    //   const fixture = { 'app/page.tsx': `export default function() { return <h1>Test</h1> }` };
    //   const [localResult, apiResult] = await Promise.all([
    //     renderWithAdapter('local', fixture, '/'),
    //     renderWithAdapter('veryfront-api', fixture, '/'),
    //   ]);
    //   assertEquals(normalizeHtml(localResult.html), normalizeHtml(apiResult.html));
    // });
  });

  describe("Nested Layout Discovery", () => {
    it("discovers all nested layouts in app router", async () => {
      await withTestContext("cross-adapter-nested-layouts", async (ctx) => {
        // Create nested layout structure
        await mkdir(join(ctx.projectDir, "app", "dashboard", "settings"), { recursive: true });

        await writeTextFile(
          join(ctx.projectDir, "app", "layout.tsx"),
          `export default function RootLayout({ children }) {
            return <html><body><div data-layout="root">{children}</div></body></html>
          }`
        );

        await writeTextFile(
          join(ctx.projectDir, "app", "dashboard", "layout.tsx"),
          `export default function DashboardLayout({ children }) {
            return <div data-layout="dashboard">{children}</div>
          }`
        );

        await writeTextFile(
          join(ctx.projectDir, "app", "dashboard", "settings", "page.tsx"),
          `export default function Settings() { return <h1>Settings</h1> }`
        );

        const renderer = await createRenderer({
          projectDir: ctx.projectDir,
          mode: "development",
        });

        const result = await renderer.renderPage("dashboard/settings");

        // Verify both layouts are applied
        assertEquals(result.html.includes('data-layout="root"'), true);
        assertEquals(result.html.includes('data-layout="dashboard"'), true);
        assertEquals(result.html.includes("Settings"), true);

        if (renderer.clearAllState) await renderer.clearAllState();
      });
    });
  });
});
```

### 6.5 Example Implementation: Multi-Tenant Concurrent Isolation Test

```typescript
// tests/integration/multi-tenant/concurrent-isolation.test.ts

import { assert, assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { withTestContext } from "../../_helpers/context.ts";
import { createRenderer } from "../../../src/rendering/index.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { join } from "@veryfront/compat/path";
import { writeTextFile } from "@veryfront/compat/fs.ts";

describe("Multi-Tenant Concurrent Isolation", {
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  it("concurrent requests to different projects have zero data leakage", async () => {
    await withTestContext("tenant-alpha", async (ctxAlpha) => {
      await withTestContext("tenant-beta", async (ctxBeta) => {
        // Set up distinct content for each tenant
        await writeTextFile(
          join(ctxAlpha.projectDir, "app", "page.tsx"),
          `export default function() { return <div data-tenant="alpha">Alpha Content - Secret Alpha Data</div> }`
        );

        await writeTextFile(
          join(ctxBeta.projectDir, "app", "page.tsx"),
          `export default function() { return <div data-tenant="beta">Beta Content - Secret Beta Data</div> }`
        );

        // Create renderers for each tenant
        const rendererAlpha = await createRenderer({
          projectDir: ctxAlpha.projectDir,
          mode: "development",
          projectId: "alpha",
        });

        const rendererBeta = await createRenderer({
          projectDir: ctxBeta.projectDir,
          mode: "development",
          projectId: "beta",
        });

        // Run concurrent requests
        const concurrentRequests: Promise<{ tenant: string; html: string }>[] = [];

        for (let i = 0; i < 20; i++) {
          concurrentRequests.push(
            rendererAlpha.renderPage("").then(r => ({ tenant: "alpha", html: r.html }))
          );
          concurrentRequests.push(
            rendererBeta.renderPage("").then(r => ({ tenant: "beta", html: r.html }))
          );
        }

        const results = await Promise.all(concurrentRequests);

        // Verify NO cross-contamination
        for (const result of results) {
          if (result.tenant === "alpha") {
            assert(result.html.includes('data-tenant="alpha"'), "Alpha response should have alpha marker");
            assert(result.html.includes("Alpha Content"), "Alpha response should have alpha content");
            assert(!result.html.includes("Beta Content"), "Alpha response should NOT have beta content");
            assert(!result.html.includes("Secret Beta Data"), "Alpha response should NOT have beta secrets");
          } else {
            assert(result.html.includes('data-tenant="beta"'), "Beta response should have beta marker");
            assert(result.html.includes("Beta Content"), "Beta response should have beta content");
            assert(!result.html.includes("Alpha Content"), "Beta response should NOT have alpha content");
            assert(!result.html.includes("Secret Alpha Data"), "Beta response should NOT have alpha secrets");
          }
        }

        // Cleanup
        if (rendererAlpha.clearAllState) await rendererAlpha.clearAllState();
        if (rendererBeta.clearAllState) await rendererBeta.clearAllState();
        await cleanupBundler();
      });
    });
  });

  it("one project failure does not block other projects", async () => {
    await withTestContext("tenant-good", async (ctxGood) => {
      await withTestContext("tenant-bad", async (ctxBad) => {
        // Good project has valid content
        await writeTextFile(
          join(ctxGood.projectDir, "app", "page.tsx"),
          `export default function() { return <h1>Good Project Works</h1> }`
        );

        // Bad project has intentional syntax error
        await writeTextFile(
          join(ctxBad.projectDir, "app", "page.tsx"),
          `export default function() { return <h1>Unclosed JSX` // Intentional error
        );

        const rendererGood = await createRenderer({
          projectDir: ctxGood.projectDir,
          mode: "development",
          projectId: "good",
        });

        const rendererBad = await createRenderer({
          projectDir: ctxBad.projectDir,
          mode: "development",
          projectId: "bad",
        });

        // Render bad project first (should fail gracefully)
        let badResult: { error?: Error; html?: string } = {};
        try {
          const result = await rendererBad.renderPage("");
          badResult.html = result.html;
        } catch (e) {
          badResult.error = e as Error;
        }

        // Bad project should have errored
        assert(badResult.error !== undefined || badResult.html?.includes("error"),
          "Bad project should fail or show error");

        // Good project should STILL work - not affected by bad project
        const goodResult = await rendererGood.renderPage("");
        assert(goodResult.html.includes("Good Project Works"),
          "Good project should render correctly despite bad project failure");

        // Cleanup
        if (rendererGood.clearAllState) await rendererGood.clearAllState();
        if (rendererBad.clearAllState) await rendererBad.clearAllState();
        await cleanupBundler();
      });
    });
  });
});
```

### 6.6 Example Implementation: Cache Consistency Test

```typescript
// tests/integration/cache/hit-miss-consistency.test.ts

import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { withTestContext } from "../../_helpers/context.ts";
import { createRenderer } from "../../../src/rendering/index.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { join } from "@veryfront/compat/path";
import { writeTextFile } from "@veryfront/compat/fs.ts";

/**
 * Normalize HTML for comparison by removing dynamic/non-deterministic content
 */
function normalizeHtml(html: string): string {
  return html
    // Remove data attributes that may vary
    .replace(/data-vf-[a-z-]+="[^"]*"/g, '')
    // Remove React root markers
    .replace(/data-reactroot="[^"]*"/g, '')
    // Remove comments (including React hydration markers)
    .replace(/<!--[\s\S]*?-->/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

describe("Cache HIT vs MISS Consistency", {
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  it("cache hit produces same result as cache miss", async () => {
    await withTestContext("cache-consistency", async (ctx) => {
      await writeTextFile(
        join(ctx.projectDir, "app", "page.tsx"),
        `export default function Home() {
          return (
            <div>
              <h1>Cached Page</h1>
              <p>This content should be identical on cache hit and miss</p>
            </div>
          )
        }`
      );

      const renderer = await createRenderer({
        projectDir: ctx.projectDir,
        mode: "development",
        projectId: ctx.projectId,
      });

      // First request - cache MISS
      const missResult = await renderer.renderPage("");
      const missHtml = normalizeHtml(missResult.html);

      // Second request - cache HIT
      const hitResult = await renderer.renderPage("");
      const hitHtml = normalizeHtml(hitResult.html);

      // Results should be identical
      assertEquals(hitHtml, missHtml, "Cache hit should produce identical HTML to cache miss");

      // Also verify the content is actually there
      assertEquals(missResult.html.includes("Cached Page"), true);
      assertEquals(hitResult.html.includes("Cached Page"), true);

      if (renderer.clearAllState) await renderer.clearAllState();
      await cleanupBundler();
    });
  });

  it("multiple sequential renders produce consistent results", async () => {
    await withTestContext("cache-sequential", async (ctx) => {
      await writeTextFile(
        join(ctx.projectDir, "app", "page.tsx"),
        `export default function() { return <h1>Sequential Test</h1> }`
      );

      const renderer = await createRenderer({
        projectDir: ctx.projectDir,
        mode: "development",
        projectId: ctx.projectId,
      });

      const results: string[] = [];

      // Render 5 times sequentially
      for (let i = 0; i < 5; i++) {
        const result = await renderer.renderPage("");
        results.push(normalizeHtml(result.html));
      }

      // All results should be identical
      const first = results[0];
      for (let i = 1; i < results.length; i++) {
        assertEquals(results[i], first, `Render ${i + 1} should match render 1`);
      }

      if (renderer.clearAllState) await renderer.clearAllState();
      await cleanupBundler();
    });
  });

  it("cache updates when source changes", async () => {
    await withTestContext("cache-invalidation", async (ctx) => {
      const pagePath = join(ctx.projectDir, "app", "page.tsx");

      // Version 1
      await writeTextFile(pagePath, `export default function() { return <h1>Version 1</h1> }`);

      const renderer = await createRenderer({
        projectDir: ctx.projectDir,
        mode: "development",
        projectId: ctx.projectId,
      });

      const v1Result = await renderer.renderPage("");
      assertEquals(v1Result.html.includes("Version 1"), true);

      // Clear renderer cache and update file
      renderer.clearCache();

      await writeTextFile(pagePath, `export default function() { return <h1>Version 2</h1> }`);

      // Small delay to ensure file system updates are visible
      await new Promise(resolve => setTimeout(resolve, 100));

      const v2Result = await renderer.renderPage("");

      // Should reflect the new content
      assertEquals(v2Result.html.includes("Version 2"), true, "Should see Version 2 after cache clear");
      assertEquals(v2Result.html.includes("Version 1"), false, "Should NOT see Version 1 after update");

      if (renderer.clearAllState) await renderer.clearAllState();
      await cleanupBundler();
    });
  });
});
```

---

## Summary

### Key Takeaways

1. **Testing gaps are the root cause** of many production bugs documented in this audit
2. **Cross-adapter consistency tests are critical** - the adapter divergence issues (Chapter 001) would be caught immediately
3. **Concurrent multi-tenant tests are essential** - the global state issues (Chapter 002) require stress testing
4. **Cache hit/miss parity tests prevent silent bugs** - the cache behavior issues (Chapter 003) only surface on cold starts

### Recommended Implementation Order

1. **Week 1**: Implement `concurrent-isolation.test.ts` and `hit-miss-consistency.test.ts`
2. **Week 2**: Implement `render-consistency.test.ts` (requires adapter mocking infrastructure)
3. **Week 3**: Implement `dependency-invalidation.test.ts` and `router-equivalence.test.ts`
4. **Week 4**: Implement `mode-combinations.test.ts` and regression tests

### Success Metrics

| Metric | Target |
|--------|--------|
| Integration test files | > 150 |
| Cross-adapter tests | > 20 |
| Multi-tenant stress tests | > 10 |
| Cache consistency tests | > 15 |
| Line coverage on critical paths | > 80% |
| CI time for full test suite | < 30 minutes |
