import { TestContext, withTestContext } from "./context.ts";

export interface TenantConfig {
  name: string;
  projectId?: string;
  env?: Record<string, string>;
}

export interface ConcurrentResult<T> {
  results: Map<string, T>;
  ordered: T[];
  errors: Map<string, Error>;
}

export interface IsolationCheck {
  markerA: string;
  markerB: string;
  extract?: (result: unknown) => string;
}

export async function withTenants<T>(
  tenants: (string | TenantConfig)[],
  fn: (contexts: TestContext[]) => Promise<T>,
): Promise<T> {
  const configs: TenantConfig[] = tenants.map((t) =>
    typeof t === "string" ? { name: t } : t,
  );

  async function nest(
    index: number,
    accumulated: TestContext[],
  ): Promise<T> {
    if (index >= configs.length) {
      return fn(accumulated);
    }

    const current = configs[index]!;
    return withTestContext(`tenant-${current.name}`, async (context) => {
      if (current.env) {
        context.setEnv(current.env);
      }
      return nest(index + 1, [...accumulated, context]);
    });
  }

  return nest(0, []);
}

export async function runConcurrently<T>(
  contexts: TestContext[],
  operation: (context: TestContext, index: number) => Promise<T>,
): Promise<T[]> {
  return Promise.all(contexts.map((ctx, i) => operation(ctx, i)));
}

export function assertIsolated(
  outputA: string,
  outputB: string,
  check: IsolationCheck,
): void {
  const { markerA, markerB } = check;

  if (!outputA.includes(markerA)) {
    throw new Error(
      `Tenant A output missing its own marker "${markerA}". ` +
        `Output (first 200 chars): ${outputA.substring(0, 200)}`,
    );
  }

  if (!outputB.includes(markerB)) {
    throw new Error(
      `Tenant B output missing its own marker "${markerB}". ` +
        `Output (first 200 chars): ${outputB.substring(0, 200)}`,
    );
  }

  if (outputA.includes(markerB)) {
    throw new Error(
      `Cross-tenant leakage: Tenant A output contains Tenant B marker "${markerB}".`,
    );
  }

  if (outputB.includes(markerA)) {
    throw new Error(
      `Cross-tenant leakage: Tenant B output contains Tenant A marker "${markerA}".`,
    );
  }
}

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

    if (!output.includes(ownMarker)) {
      throw new Error(
        `Tenant ${i} output missing its own marker "${ownMarker}".`,
      );
    }

    for (let j = 0; j < markers.length; j++) {
      if (i === j) continue;

      const otherMarker = markers[j]!;
      if (output.includes(otherMarker)) {
        throw new Error(
          `Cross-tenant leakage: Tenant ${i} output contains Tenant ${j} marker "${otherMarker}".`,
        );
      }
    }
  }
}
