const SECRET_KEY = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "super-secret-key-change-this-in-production",
);

const ALGORITHM: HmacImportParams = { name: "HMAC", hash: "SHA-256" };

function base64UrlEncode(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecodeToBytes(input: string): Uint8Array {
  return Uint8Array.from(
    atob(input.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
}

function encodeText(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

export async function sign(payload: Record<string, any>): Promise<string> {
  const key = await crypto.subtle.importKey("raw", SECRET_KEY, ALGORITHM, false, [
    "sign",
  ]);

  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(
    JSON.stringify({
      ...payload,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    }),
  );

  const data = encodeText(`${header}.${body}`);
  const signature = await crypto.subtle.sign(ALGORITHM, key, data);

  return `${header}.${body}.${base64UrlEncode(signature)}`;
}

export async function verify(token: string): Promise<Record<string, any> | null> {
  try {
    const [headerB64, bodyB64, signatureB64] = token.split(".");
    if (!headerB64 || !bodyB64 || !signatureB64) return null;

    const key = await crypto.subtle.importKey(
      "raw",
      SECRET_KEY,
      ALGORITHM,
      false,
      ["verify"],
    );

    const signature = base64UrlDecodeToBytes(signatureB64);
    const data = encodeText(`${headerB64}.${bodyB64}`);

    const isValid = await crypto.subtle.verify(ALGORITHM, key, signature, data);
    if (!isValid) return null;

    const payload = JSON.parse(atob(bodyB64));
    if (payload.exp && Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}
