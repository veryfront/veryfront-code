import { assertEquals } from "#veryfront/testing/assert.ts";
import writerContract from "../../../tests/fixtures/contracts/api-run-event-writer-jwt-payload.json" with {
  type: "json",
};

/** Run isolated protocol checks with a real operator-signed synthetic writer token. */
export async function runCanonicalWriterProgram(
  program: string,
  additionalInput: Record<string, unknown> = {},
) {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const encode = (value: Uint8Array) =>
    btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
      "=",
      "",
    );
  const json = (value: unknown) => encode(new TextEncoder().encode(JSON.stringify(value)));
  const claims = {
    ...writerContract.payload,
    projectId: "00000000-0000-4000-8000-000000000005",
    runId: "run-1",
    agentId: "builder",
    platformToolDependencies: [],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const signingInput = json({ alg: "RS256", typ: "JWT" }) + "." + json(claims);
  const token = signingInput + "." +
    encode(
      new Uint8Array(
        await crypto.subtle.sign(
          "RSASSA-PKCS1-v1_5",
          keyPair.privateKey,
          new TextEncoder().encode(signingInput),
        ),
      ),
    );
  const der = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  const publicKeyPem = "-----BEGIN PUBLIC KEY-----\n" +
    (btoa(String.fromCharCode(...der)).match(/.{1,64}/g) ?? []).join("\n") +
    "\n-----END PUBLIC KEY-----";
  const env: Record<string, string> = {
    OAUTH_PUBLIC_KEY: publicKeyPem,
    SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: writerContract.payload.serviceAccountId,
    NODE_ENV: "production",
    DENO_TESTING: "1",
    VERYFRONT_API_URL: "https://93.184.216.34/api",
    VERYFRONT_API_BASE_URL: "https://93.184.216.34/api",
  };
  for (const key of ["HOME", "DENO_DIR", "DENO_COVERAGE_DIR"]) {
    const value = Deno.env.get(key);
    if (value) env[key] = value;
  }
  const child = new Deno.Command(Deno.execPath(), {
    args: ["eval", "--config", "deno.json", program],
    clearEnv: true,
    env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(30000),
  }).spawn();
  const input = child.stdin.getWriter();
  await input.write(
    new TextEncoder().encode(
      JSON.stringify({
        ...additionalInput,
        token,
        publicKeyPem,
        serverId: writerContract.payload.serviceAccountId,
      }),
    ),
  );
  await input.close();
  const output = await child.output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim();
}
