import { getDenoRuntime, isBun, isDeno, isNode } from "./runtime.ts";

export type DnsAddressRecordType = "A" | "AAAA";

export interface ResolveHostAddressesOptions {
  recordTypes?: readonly DnsAddressRecordType[];
}

export async function resolveHostAddresses(
  hostname: string,
  options: ResolveHostAddressesOptions = {},
): Promise<string[]> {
  const recordTypes = options.recordTypes ?? ["A", "AAAA"];
  const results: string[] = [];

  if (isDeno) {
    const deno = getDenoRuntime();
    if (!deno) return results;

    for (const recordType of recordTypes) {
      try {
        results.push(...await deno.resolveDns(hostname, recordType));
      } catch {
        // A host may legitimately have only one address family.
      }
    }
    return results;
  }

  if (isNode || isBun) {
    const dns = await import("node:dns/promises");
    for (const recordType of recordTypes) {
      try {
        const addresses = recordType === "A"
          ? await dns.resolve4(hostname)
          : await dns.resolve6(hostname);
        results.push(...addresses);
      } catch {
        // A host may legitimately have only one address family.
      }
    }
  }

  return results;
}
