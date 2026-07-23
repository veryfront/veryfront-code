import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { parseSourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";

/** Apply one request-scoped project environment overlay and restore it afterward. */
export async function withWorkerProjectEnv<T>(
  env: Record<string, string> | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!env) return await operation();

  const previousValues = new Map<string, string | undefined>();
  try {
    for (const [key, value] of Object.entries(env)) {
      previousValues.set(key, Deno.env.get(key));
      Deno.env.set(key, value);
    }
    return await operation();
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

/** Run Worker-owned framework logic under one exact source integration policy. */
export function runWithWorkerSourceIntegrationPolicy<T>(
  policy: unknown,
  operation: () => T,
): T {
  return runWithExactSourceIntegrationPolicy(
    parseSourceIntegrationPolicyManifest(policy),
    operation,
  );
}
