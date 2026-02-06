export function getEnv(key: string): string | undefined {
  // Deno
  if (typeof Deno !== "undefined" && Deno.env?.get) {
    return Deno.env.get(key);
  }

  // Node.js / Bun
  const nodeProcess = (globalThis as { process?: { env?: Record<string, string> } }).process;
  return nodeProcess?.env?.[key];
}
