type RuntimeGlobals = typeof globalThis & {
  Deno?: { env?: { get?: (name: string) => string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};

/** Read one environment variable without binding generated code to Node or Deno. */
export function readEnvironmentVariable(name: string): string | undefined {
  const runtime = globalThis as RuntimeGlobals;
  try {
    const denoValue = runtime.Deno?.env?.get?.(name);
    if (denoValue !== undefined) return denoValue;
  } catch {
    // Deno may intentionally deny environment access. Do not infer a value.
  }
  return runtime.process?.env?.[name];
}
