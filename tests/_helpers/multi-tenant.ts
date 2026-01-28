/**
 * Multi-Tenant Test Utilities
 *
 * Provides helpers for testing multi-tenant isolation with reduced boilerplate.
 * These utilities run multiple tenant contexts concurrently and verify isolation.
 *
 * Usage:
 * ```typescript
 * await withTenants(["alpha", "beta"], async ([a, b]) => {
 *   // Both contexts set up in parallel, isolated via AsyncLocalStorage
 *   await writeTextFile(join(a.projectDir, "pages/index.tsx"), sourceA);
 *   await writeTextFile(join(b.projectDir, "pages/index.tsx"), sourceB);
 *
 *   const [resultA, resultB] = await renderConcurrently(
 *     [a, b],
 *     (ctx) => renderPage(ctx, "/"),
 *   );
 *
 *   assertIsolated(resultA, resultB, {
 *     markerA: "alpha-marker",
 *     markerB: "beta-marker",
 *   });
 * });
 * ```
 *
 * @module
 */

import { TestContext, withTestContext } from "./context.ts";

/**
 * Tenant configuration for multi-tenant test setup.
 */
export interface TenantConfig {
  /** Tenant name (used for test context naming) */
  name: string;
  /** Optional project ID override */
  projectId?: string;
  /** Optional environment variables for this tenant */
  env?: Record<string, string>;
}

/**
 * Result of concurrent operations across tenants.
 */
export interface ConcurrentResult<T> {
  /** Results indexed by tenant name */
  results: Map<string, T>;
  /** Array of results in order of input tenants */
  ordered: T[];
  /** Any errors encountered, indexed by tenant name */
  errors: Map<string, Error>;
}

/**
 * Isolation assertion options.
 */
export interface IsolationCheck {
  /** Marker string that should appear in tenant A's output */
  markerA: string;
  /** Marker string that should appear in tenant B's output */
  markerB: string;
  /** Optional: extract string content from result for checking */
  extract?: (result: unknown) => string;
}

/**
 * Run a test with multiple tenant contexts set up concurrently.
 *
 * Each tenant gets its own TestContext with isolated:
 * - Project directory (temp dir)
 * - Cache directory (AsyncLocalStorage-scoped)
 * - Project ID
 *
 * Contexts are set up in sequence (required by AsyncLocalStorage nesting)
 * but the test function receives all contexts at once.
 *
 * @example
 * ```typescript
 * await withTenants(["alpha", "beta"], async ([a, b]) => {
 *   // Both fully set up, run concurrent operations
 *   const [resultA, resultB] = await Promise.all([
 *     doWork(a), doWork(b),
 *   ]);
 * });
 * ```
 */
export async function withTenants<T>(
  tenants: (string | TenantConfig)[],
  fn: (contexts: TestContext[]) => Promise<T>,
): Promise<T> {
  const configs = tenants.map((t) =>
    typeof t === "string" ? { name: t } : t
  );

  // Build nested withTestContext calls
  async function nest(
    remaining: TenantConfig[],
    accumulated: TestContext[],
  ): Promise<T> {
    if (remaining.length === 0) {
      return await fn(accumulated);
    }

    const current = remaining[0]!;
    const rest = remaining.slice(1);
    return await withTestContext(
      `tenant-${current.name}`,
      async (context) => {
        if (current.env) {
          context.setEnv(current.env);
        }
        return await nest(rest, [...accumulated, context]);
      },
    );
  }

  return await nest(configs, []);
}

/**
 * Run an async operation concurrently across multiple tenant contexts.
 *
 * @example
 * ```typescript
 * const results = await runConcurrently(
 *   [contextA, contextB],
 *   async (ctx) => {
 *     const resp = await fetch(`http://127.0.0.1:${server.port}/`);
 *     return await resp.text();
 *   },
 * );
 * // results[0] = tenant A output, results[1] = tenant B output
 * ```
 */
export async function runConcurrently<T>(
  contexts: TestContext[],
  operation: (context: TestContext, index: number) => Promise<T>,
): Promise<T[]> {
  return await Promise.all(
    contexts.map((ctx, i) => operation(ctx, i)),
  );
}

/**
 * Assert that two string outputs are isolated — each contains its own
 * marker but not the other tenant's marker.
 *
 * @example
 * ```typescript
 * assertIsolated(htmlA, htmlB, {
 *   markerA: "tenant-alpha-content",
 *   markerB: "tenant-beta-content",
 * });
 * ```
 */
export function assertIsolated(
  outputA: string,
  outputB: string,
  check: IsolationCheck,
): void {
  const { markerA, markerB } = check;

  // A should contain its marker
  if (!outputA.includes(markerA)) {
    throw new Error(
      `Tenant A output missing its own marker "${markerA}". ` +
        `Output (first 200 chars): ${outputA.substring(0, 200)}`,
    );
  }

  // B should contain its marker
  if (!outputB.includes(markerB)) {
    throw new Error(
      `Tenant B output missing its own marker "${markerB}". ` +
        `Output (first 200 chars): ${outputB.substring(0, 200)}`,
    );
  }

  // A should NOT contain B's marker
  if (outputA.includes(markerB)) {
    throw new Error(
      `Cross-tenant leakage: Tenant A output contains Tenant B marker "${markerB}".`,
    );
  }

  // B should NOT contain A's marker
  if (outputB.includes(markerA)) {
    throw new Error(
      `Cross-tenant leakage: Tenant B output contains Tenant A marker "${markerA}".`,
    );
  }
}

/**
 * Assert isolation across an arbitrary number of tenants.
 * Each output should contain only its own marker, not any other tenant's.
 *
 * @example
 * ```typescript
 * assertMultiTenantIsolation(
 *   [htmlA, htmlB, htmlC],
 *   ["marker-a", "marker-b", "marker-c"],
 * );
 * ```
 */
export function assertMultiTenantIsolation(
  outputs: string[],
  markers: string[],
): void {
  if (outputs.length !== markers.length) {
    throw new Error(
      `Mismatched outputs (${outputs.length}) and markers (${markers.length})`,
    );
  }

  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i]!;
    const ownMarker = markers[i]!;

    // Should contain own marker
    if (!output.includes(ownMarker)) {
      throw new Error(
        `Tenant ${i} output missing its own marker "${ownMarker}".`,
      );
    }

    // Should not contain other tenants' markers
    for (let j = 0; j < markers.length; j++) {
      if (i === j) continue;
      if (output.includes(markers[j]!)) {
        throw new Error(
          `Cross-tenant leakage: Tenant ${i} output contains Tenant ${j} marker "${markers[j]}".`,
        );
      }
    }
  }
}
