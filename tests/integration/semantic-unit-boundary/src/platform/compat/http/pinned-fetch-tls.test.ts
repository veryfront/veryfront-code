import { assertEquals } from "#veryfront/testing/assert.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";

const REPOSITORY_ROOT = new URL("../../../../../../../", import.meta.url);
const PINNED_FETCH_MODULE = new URL(
  "src/platform/compat/http/pinned-fetch.ts",
  REPOSITORY_ROOT,
);
const ASSERT_MODULE = new URL("src/testing/assert.ts", REPOSITORY_ROOT);
const CHILD_TIMEOUT_MS = 10_000;

const ROOT_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDMzCCAhugAwIBAgIUBrZVX3+J9M9MPdncBXVJp2HDBtAwDQYJKoZIhvcNAQEL
BQAwITEfMB0GA1UEAwwWVmVyeWZyb250IFRlc3QgUm9vdCBDQTAeFw0yNjEwMDkw
MjIzMTBaFw00MDA2MTcwMjIzMTBaMCExHzAdBgNVBAMMFlZlcnlmcm9udCBUZXN0
IFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCqcn/YPI8L
72uzbf2cyf0wO4StovOGXzCBs3WL5zSM9vaNVaFmCWzD16gQXKgEipXVjoZ84EWi
cJPN5Kel09AmXLi159zyFl29CzzKSuQ93tIKXHfw7/YVYQ2b0AGXzUkw/xNSp3Ah
WPHG9DpLRcU1h3mMKW0tzNlld7T0StINc1ECBJM1A+6Qx/HLJblg0u8sgEE0/Avy
D3QqZn1Dgy8XE3Au5UppzprRNbb7eCoKsgJLstclD2OPNMe+dAEljycYPtpHHAkn
b/ieDCEB7FNw7rN6vvl7nxeYBtlH6AevlbrWAIPjLR3GlIixfFbwT2SWabrtDblu
ri3v6xGMF9mDAgMBAAGjYzBhMB0GA1UdDgQWBBR9QBdQrdQouiYA4ydlX51FNVba
8zAfBgNVHSMEGDAWgBR9QBdQrdQouiYA4ydlX51FNVba8zAPBgNVHRMBAf8EBTAD
AQH/MA4GA1UdDwEB/wQEAwIBBjANBgkqhkiG9w0BAQsFAAOCAQEAAYzF3NobqotM
8VqBWXsIQcmqD9fAzg3qH46QOhAyyMX2E+6A6TjDLhsM8AaybeBmvd8XlsHIm3rv
pJAk1J4NEDMTeuN/vhXYMasaL3McyDrgnHiV3WJq4EIJ5dFgj9WBRRLF76llUONs
CM4t38KCrEBsxLGO5eRT/SmEqGXqW43tkgWVYe68YzNZq8/wIBmgpLnBMkOoCouN
i5Zf23k3WJWpq3Mg1gh9tNQ6rJxhbG5LWqCPRcj0L4QzZVqNBEhS6g6gkOF2cxNe
qZk17mhzJ4nI8uk7IFmMFyRnCGOc0EpWxrKjjuxpWVk3liZNN2vrwEClcP6/NTQg
5E1YLPnIZQ==
-----END CERTIFICATE-----
`;

const LEAF_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDZjCCAk6gAwIBAgIUJL8mb+HY8lMitr7rTAuWyT6iRX0wDQYJKoZIhvcNAQEL
BQAwITEfMB0GA1UEAwwWVmVyeWZyb250IFRlc3QgUm9vdCBDQTAeFw0yNjEwMDkw
MjIzMTBaFw00MDA2MTcwMjIzMTBaMB8xHTAbBgNVBAMMFHBpbm5lZC1jZXJ0LWVu
di50ZXN0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA/fr9vZ5l+B4l
xMgQFjjPmOqAnlZGfMqbqe87KZXTVTlzqI8XKvV7DsoD5so81PZMY3tlQie19qD0
LNUWD2wGqBOOIpNRnb7CUe4OhWVDLH3gU0A7XBcz43GdjpmLRKj6BBJ+bioN2x77
osS4boUVY3Cd7E+2sU0EsnR2mI8LGZVILci7xIIzT9LA49lb6CoGRiGJI2dTkfBK
wmmDgSSmS73rdCmugBgZP+y9gretupOxD2TY8pdOG3t4Wp4iUW4K4d3LMvK3GjmC
Ggrwf2ckm1R42Um/Ds4cmLE7KTqi3iypN0boecAuTQ7qp/yL0j5GLaK9J7fufYLP
K6NbE8n2EQIDAQABo4GXMIGUMCUGA1UdEQQeMByCFHBpbm5lZC1jZXJ0LWVudi50
ZXN0hwR/AAABMAkGA1UdEwQCMAAwCwYDVR0PBAQDAgWgMBMGA1UdJQQMMAoGCCsG
AQUFBwMBMB0GA1UdDgQWBBRBqXstr7+y4U7MySkuIih9sc9c6DAfBgNVHSMEGDAW
gBR9QBdQrdQouiYA4ydlX51FNVba8zANBgkqhkiG9w0BAQsFAAOCAQEAWXumRq/k
43URcQw8GzZDwpZHdbugGvK0a0Qx3MYs1rbwWx9MtglBP+9QWgjsOpd0neZEttwN
yPjN7+ifUiB5/Gnz/irpgu7BgjZo2WCSZbF9hPEsf59EzVpGPr2mplq7hGubktDC
RKBGrkt1uUm2Qe7CxpPJj+mJLu19HIn4CZdeHc9xMyLpd1Ro3CLDNDgF44XjFGaP
Ij/wJ6KRcYD4+NiUElep+9ZCoQVBCzxDP4xVFatUVmIaxG2oC2QQJU1cDX3DZn/9
mp+DSaLZrsE9GBdGZbVaqBo9Df1io5kxtIJRVgu/xH5B6AphNH/8VMug8ZLxAJMW
fnptFbnkt1ydcQ==
-----END CERTIFICATE-----
`;

const LEAF_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQD9+v29nmX4HiXE
yBAWOM+Y6oCeVkZ8ypup7zspldNVOXOojxcq9XsOygPmyjzU9kxje2VCJ7X2oPQs
1RYPbAaoE44ik1GdvsJR7g6FZUMsfeBTQDtcFzPjcZ2OmYtEqPoEEn5uKg3bHvui
xLhuhRVjcJ3sT7axTQSydHaYjwsZlUgtyLvEgjNP0sDj2VvoKgZGIYkjZ1OR8ErC
aYOBJKZLvet0Ka6AGBk/7L2Ct626k7EPZNjyl04be3haniJRbgrh3csy8rcaOYIa
CvB/ZySbVHjZSb8OzhyYsTspOqLeLKk3Ruh5wC5NDuqn/IvSPkYtor0nt+59gs8r
o1sTyfYRAgMBAAECggEAArwRgCQ7iOFHuDOXLJW+4qX4kwPe1qGul9pBt4IDnxKQ
hLgKMyy77wdE2pw9YpBhQbi1WNc76TB3V+smhY2HkTxD1XUt6GTie3P6C8IGQrKm
BWrJkiq1NNb/RUbbqiuyL0nU8EoYq+Nh85vP7c+LZk6YYmANxDZ+D9nAzBCYZAWL
HkBTjDil9O8GcdsiUMO5hMcmNc78CaCHVw2UyyaAYtafu0FjjKp3cIoFuhOti9FX
atGO6DHx6Q82fkx4onxM1slkmd01hoP06lIEsMyzKsWU1kJEJwi/Lim7eFBEC6OF
UR9PYNHILsuxPJpXGw5/LOX+6PncCeFl/hhFHpSBIQKBgQD/8TbmqOUtK7+YDBrh
+Js1oadCHpYtyh4L6AWVRpl0j8TOcNM79N75HNz21uCyVWNJCS98XP6D7D8vmL3T
KUHr0+FltYTunNAPvMULdI6HRgTKDlwQJOPxhEGlMPf9/ZoVe/BrpSureFkVKhIB
V8Op71V+a1yH79dwTOrvtxRBMQKBgQD+CanTo7GT7l+labUeHn6ACsaiL0aUnBLd
LjU3fvNkV0IH9lEZXHh2OqQ72Jh0ZO9hyo3FGK1z/3/N285E/9nU/8xiArtQ+bva
4gRif0H8hcRHnV5gVEF6IeIYc3o5d1E5KBsHKCjpzepfoyZNegqLp1HbYTy3jptX
MYWx5UzK4QKBgAw1Pz8lUzkiWxMvkKCysQSP32CCAPvSJji/KnUCVxN+QA7wxsKX
XYNYYxnLChC3jfLP41n1PZahUCo/CN7nmuNayeeGDv8qr6nwgR2Yw6ukJVpV8QI8
IDtG6bKtcUbGL/FSZhdcW4bkSKt/xDgYLZcPeW58RH+faxFKOfKRMwAhAoGBAPx9
uk/iWTOBL4uG/z+Ka4z0KO02M96tKYqwzK/1/A/1MmobhgvA/vHz4xygcRbu44a8
/h+yIWQzxGFlYSTvbyDnhcq8kFUxgmdRUa5cccd9ZNMRNKZl2BZ96u0GiaroTtCS
bhq07cVEpvibfgxvil+31AJKKUD/+qG1VP61u5fBAoGAUSa4QejxTMwqHK7kLaqU
2+grd5mLx+ku2hCsbNrAG1/y8vzeAxADSknXctRpONcTKIRJqMQq5076adan+uev
9gKj8vkSyWnMn4wXxSWOLinjYLqxTStXKojjCj8q11TWnJalTD0utI2DUsRSO+e1
b0LkSRyg20jHrxlaRTnkPIY=
-----END PRIVATE KEY-----
`;

function childScript(): string {
  return `
import { assertEquals, assertRejects } from ${JSON.stringify(ASSERT_MODULE.href)};
import { fetchWithPinnedAddresses } from ${JSON.stringify(PINNED_FETCH_MODULE.href)};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const listener = Deno.listenTls({
  hostname: "127.0.0.1",
  port: 0,
  cert: ${JSON.stringify(LEAF_CERTIFICATE)},
  key: ${JSON.stringify(LEAF_KEY)},
});
const connections = [];
let requestsReceived = 0;

function responseText(status, body, connection = "keep-alive") {
  return [
    \`HTTP/1.1 \${status} OK\`,
    "content-type: text/plain",
    \`content-length: \${encoder.encode(body).byteLength}\`,
    \`connection: \${connection}\`,
    "",
    body,
  ].join("\\r\\n");
}

async function writeString(connection, value) {
  await connection.write(encoder.encode(value));
}

async function readHeaders(connection) {
  const chunks = [];
  const buffer = new Uint8Array(1024);
  while (true) {
    const read = await connection.read(buffer);
    if (read === null) throw new Error("connection closed before HTTP headers");
    chunks.push(buffer.slice(0, read));
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (let index = 0; index < chunks.length; index++) {
      bytes.set(chunks[index], offset);
      offset += chunks[index].byteLength;
    }
    const text = decoder.decode(bytes);
    if (text.includes("\\r\\n\\r\\n")) return text;
  }
}

async function readUntilEof(connection) {
  const buffer = new Uint8Array(1024);
  while (await connection.read(buffer) !== null) {}
  return true;
}

async function withDeadline(promise, label, timeoutMs = 1000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(label)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function acceptRequest(respond) {
  const connection = await listener.accept();
  connections.push(connection);
  const headers = await readHeaders(connection);
  requestsReceived += 1;
  await respond(connection, headers);
  const eof = readUntilEof(connection).finally(() => {
    try {
      connection.close();
    } catch {
      // already closed
    }
  });
  return { headers, eof };
}

async function observeTlsConnectionForHttpDispatch() {
  let connection;
  try {
    connection = await listener.accept();
    connections.push(connection);
    const headers = await readHeaders(connection);
    requestsReceived += 1;
    return { dispatched: true, headers };
  } catch (error) {
    return { dispatched: false, error: String(error?.message ?? error) };
  } finally {
    try {
      connection?.close();
    } catch {
      // already closed
    }
  }
}

try {
  const address = listener.addr;
  if (typeof address.port !== "number") throw new Error("Missing TLS fixture address");
  const nativeRequest = acceptRequest(async (connection) => {
    await writeString(connection, responseText(200, "native", "close"));
    connection.closeWrite();
  });
  const nativeResponse = await fetch(\`https://127.0.0.1:\${address.port}/native\`);
  assertEquals(nativeResponse.status, 200);
  assertEquals(await nativeResponse.text(), "native");
  await nativeRequest;

  const httpsBuiltin = globalThis.process.getBuiltinModule("node:https");
  const OriginalAgent = httpsBuiltin.Agent;
  let interceptedAgentConstructor = false;
  let interceptedPrivateAgent = false;
  const originalReflectGet = Reflect.get;
  Reflect.get = (target, key, receiver) => {
    if (key === "options" && target instanceof OriginalAgent) interceptedPrivateAgent = true;
    return originalReflectGet(target, key, receiver);
  };
  httpsBuiltin.Agent = class extends OriginalAgent {
    constructor(options) {
      interceptedAgentConstructor = true;
      super(options);
    }
  };

  const completedRequest = acceptRequest(async (connection, headers) => {
    assertEquals(headers.includes("authorization: Bearer synthetic-token"), true);
    await writeString(connection, responseText(200, "Bearer synthetic-token"));
  });
  const pinnedResponse = await fetchWithPinnedAddresses(
    new URL(\`https://pinned-cert-env.test:\${address.port}/pinned\`),
    ["127.0.0.1"],
    { headers: { authorization: "Bearer synthetic-token" } },
  );
  assertEquals(pinnedResponse.status, 200);
  assertEquals(await pinnedResponse.text(), "Bearer synthetic-token");
  const completed = await completedRequest;
  await withDeadline(
    completed.eof,
    "Completed authenticated downloads must release their owned HTTPS socket",
  );
  assertEquals(interceptedAgentConstructor, false, "Authenticated transport must use the bootstrap agent constructor");
  assertEquals(interceptedPrivateAgent, false, "Private agent options must not cross tenant reflection hooks");

  const pendingRequest = acceptRequest(async (connection, headers) => {
    assertEquals(headers.includes("authorization: Bearer synthetic-token"), true);
    await writeString(connection, [
      "HTTP/1.1 200 OK",
      "content-type: text/plain",
      "content-length: 12",
      "connection: keep-alive",
      "",
      "hello",
    ].join("\\r\\n"));
  });
  const pendingResponse = await fetchWithPinnedAddresses(
    new URL(\`https://pinned-cert-env.test:\${address.port}/pending\`),
    ["127.0.0.1"],
    { headers: { authorization: "Bearer synthetic-token" } },
  );
  assertEquals(pendingResponse.status, 200);
  const pending = await pendingRequest;
  await pendingResponse.body?.cancel("cancel pinned response");
  await withDeadline(
    pending.eof,
    "Cancelled authenticated response bodies must release their owned HTTPS socket",
  );

  globalThis.process.getBuiltinModule("node:https").globalAgent.options.rejectUnauthorized = false;
  const wrongHostProbe = observeTlsConnectionForHttpDispatch();
  await assertRejects(() => fetchWithPinnedAddresses(
    new URL(\`https://wrong-host.test:\${address.port}/rejected\`),
    ["127.0.0.1"],
    { headers: { authorization: "Bearer synthetic-token" } },
  ), Error);
  const wrongHost = await withDeadline(
    wrongHostProbe,
    "TLS hostname mismatch probe did not settle",
  );
  assertEquals(wrongHost.dispatched, false, "TLS hostname mismatch must not dispatch credential headers");
  assertEquals(requestsReceived, 3);
} finally {
  try {
    listener.close();
  } catch {
    // already closed
  }
  for (let index = 0; index < connections.length; index++) {
    try {
      connections[index].close();
    } catch {
      // already closed
    }
  }
}
`;
}

Deno.test("Deno pinned HTTPS transport honors the same ambient DENO_CERT root as native fetch", async () => {
  await withTempDir(async (tempDirectory) => {
    const rootPath = `${tempDirectory}/root.pem`;
    const scriptPath = `${tempDirectory}/pinned-fetch-deno-cert.ts`;
    await Deno.writeTextFile(rootPath, ROOT_CERTIFICATE);
    await Deno.writeTextFile(scriptPath, childScript());
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--config=deno.json",
        "--no-check",
        `--allow-read=${new URL(".", REPOSITORY_ROOT).pathname},${rootPath}`,
        "--allow-env=DENO_CERT",
        "--allow-net=127.0.0.1,pinned-cert-env.test,wrong-host.test",
        scriptPath,
      ],
      cwd: new URL(".", REPOSITORY_ROOT).pathname,
      env: { DENO_CERT: rootPath },
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CHILD_TIMEOUT_MS);
    const [status, stdout, stderr] = await Promise.all([
      child.status,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    clearTimeout(timeout);
    assertEquals(
      status.success,
      true,
      [
        "Deno pinned HTTPS transport did not honor ambient DENO_CERT",
        `timed out: ${timedOut}`,
        `stdout: ${stdout}`,
        `stderr: ${stderr}`,
      ].join("\n"),
    );
  });
});
