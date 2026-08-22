const HOSTNAMES = [
  "veryfront-probe.localhost",
  "veryfront-probe.preview.localhost",
];

function readErrorCode(error) {
  if (error && typeof error === "object") {
    if (typeof error.code === "string" && error.code.length > 0) return error.code;
    if (typeof error.name === "string" && error.name.length > 0) return error.name;
  }
  return "UNKNOWN";
}

async function resolveWithDeno(hostname) {
  const addresses = [];
  const errorCodes = new Set();
  for (const recordType of ["A", "AAAA"]) {
    try {
      addresses.push(...await globalThis.Deno.resolveDns(hostname, recordType));
    } catch (error) {
      errorCodes.add(readErrorCode(error));
    }
  }
  return { addresses, errorCode: [...errorCodes].sort().join(",") || undefined };
}

async function resolveWithNode(hostname) {
  const { lookup } = await import("node:dns/promises");
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return { addresses: records.map((record) => record.address) };
  } catch (error) {
    return { addresses: [], errorCode: readErrorCode(error) };
  }
}

const isDeno = typeof globalThis.Deno?.resolveDns === "function";
const runtime = isDeno
  ? `deno@${globalThis.Deno.version.deno}`
  : `node@${globalThis.process.version.replace(/^v/, "")}`;

for (const hostname of HOSTNAMES) {
  const result = isDeno
    ? await resolveWithDeno(hostname)
    : await resolveWithNode(hostname);
  const addresses = [...new Set(result.addresses)].sort();
  const addressFamilies = [...new Set(
    addresses.map((address) => address.includes(":") ? "IPv6" : "IPv4"),
  )].sort();
  console.log(JSON.stringify({
    runtime,
    hostname,
    resolved: addresses.length > 0,
    addressFamilies,
    ...(addresses.length > 0
      ? { loopbackOnly: addresses.every((address) => address === "127.0.0.1" || address === "::1") }
      : {}),
    ...(addresses.length === 0 ? { errorCode: result.errorCode ?? "UNKNOWN" } : {}),
  }));
}
