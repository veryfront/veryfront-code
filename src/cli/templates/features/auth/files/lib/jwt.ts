const SECRET_KEY = new TextEncoder().encode(
  process.env.JWT_SECRET || "super-secret-key-change-this-in-production",
);

export async function sign(payload: Record<string, any>): Promise<string> {
  const algorithm = { name: "HMAC", hash: "SHA-256" };
  const key = await crypto.subtle.importKey(
    "raw",
    SECRET_KEY,
    algorithm,
    false,
    ["sign"],
  );

  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify({ ...payload, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }));

  const signature = await crypto.subtle.sign(
    algorithm,
    key,
    new TextEncoder().encode(`${header}.${body}`),
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\
    .replace(/=+$/, "");

  return `${header}.${body}.${signatureB64}`;
}

export async function verify(token: string): Promise<Record<string, any> | null> {
  try {
    const [headerB64, bodyB64, signatureB64] = token.split(".");
    if (!headerB64 || !bodyB64 || !signatureB64) return null;

    const algorithm = { name: "HMAC", hash: "SHA-256" };
    const key = await crypto.subtle.importKey(
      "raw",
      SECRET_KEY,
      algorithm,
      false,
      ["verify"],
    );

    const signature = Uint8Array.from(
      atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );

    const isValid = await crypto.subtle.verify(
      algorithm,
      key,
      signature,
      new TextEncoder().encode(`${headerB64}.${bodyB64}`),
    );

    if (!isValid) return null;

    const payload = JSON.parse(atob(bodyB64));
    if (payload.exp && Date.now() > payload.exp) return null;

    return payload;
  } catch (_e) {
    return null;
  }
}
