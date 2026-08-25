import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { decodeAuthBase64Url, encodeAuthBase64Url } from "./base64url.ts";
import { openAuthCookieEnvelope, sealAuthCookieEnvelope } from "./crypto.ts";
import {
  clearSessionCookie,
  clearTransactionCookie,
  createSessionCookie,
  createTransactionCookie,
  getTransactionCookieName,
  readSessionCookie,
  readTransactionCookie,
  SESSION_COOKIE_NAME,
} from "./cookies.ts";

const NOW = 1_900_000_000;
const SESSION_SECRET = "s".repeat(32);
const OTHER_SECRET = "t".repeat(32);
const STATE_A = "A".repeat(43);
const STATE_B = "B".repeat(43);
const FIXED_IV = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const TEST_SALT = new TextEncoder().encode("Veryfront auth-cookie v1");

function fixedRandom(length: number): Uint8Array {
  assertEquals(length, 12);
  return FIXED_IV.slice();
}

async function sealRawTestPlaintext(plaintext: string): Promise<string> {
  const encoder = new TextEncoder();
  const inputKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(SESSION_SECRET)),
    "HKDF",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(TEST_SALT),
      info: toArrayBuffer(encoder.encode("Veryfront auth-cookie session v1")),
    },
    inputKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(FIXED_IV),
      additionalData: toArrayBuffer(encoder.encode(`session\n${SESSION_COOKIE_NAME}`)),
      tagLength: 128,
    },
    key,
    toArrayBuffer(encoder.encode(plaintext)),
  );
  return `v1.${encodeAuthBase64Url(FIXED_IV)}.${encodeAuthBase64Url(new Uint8Array(ciphertext))}`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function cookieValue(setCookie: string): string {
  const first = setCookie.split(";", 1)[0] ?? "";
  const index = first.indexOf("=");
  assert(index > 0, "cookie must contain a name and value");
  return first.slice(index + 1);
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

function replaceLast(input: string, search: string, replacement: string): string {
  const index = input.lastIndexOf(search);
  assert(index >= 0, `expected ${search}`);
  return `${input.slice(0, index)}${replacement}${input.slice(index + search.length)}`;
}

describe("security/application-auth auth cookie envelope", () => {
  it("round-trips bounded JSON without placing plaintext claims in cookie values", async () => {
    const sealed = await sealAuthCookieEnvelope({
      secret: SESSION_SECRET,
      purpose: "session",
      cookieName: SESSION_COOKIE_NAME,
      payload: { subject: "user-123", email: "user@example.com" },
      issuedAt: NOW,
      expiresAt: NOW + 3_600,
      randomBytes: fixedRandom,
    });

    assertEquals(sealed.startsWith("v1."), true);
    assertEquals(sealed.includes("user-123"), false);
    assertEquals(sealed.includes("user@example.com"), false);

    const opened = await openAuthCookieEnvelope({
      secret: SESSION_SECRET,
      purpose: "session",
      cookieName: SESSION_COOKIE_NAME,
      value: sealed,
      now: NOW + 10,
      maxLifetimeSeconds: 3_600,
    });
    assertEquals(opened.payload, { subject: "user-123", email: "user@example.com" });
  });

  it("rejects tampering, wrong keys, purpose confusion, and cookie-name confusion", async () => {
    const sealed = await sealAuthCookieEnvelope({
      secret: SESSION_SECRET,
      purpose: "session",
      cookieName: SESSION_COOKIE_NAME,
      payload: { subject: "user-123" },
      issuedAt: NOW,
      expiresAt: NOW + 300,
      randomBytes: fixedRandom,
    });
    const tampered = `${sealed.slice(0, -1)}${sealed.endsWith("A") ? "B" : "A"}`;

    await assertRejects(
      () =>
        openAuthCookieEnvelope({
          secret: SESSION_SECRET,
          purpose: "session",
          cookieName: SESSION_COOKIE_NAME,
          value: tampered,
          now: NOW,
          maxLifetimeSeconds: 300,
        }),
      TypeError,
      "authenticated",
    );

    for (
      const options of [
        { secret: OTHER_SECRET, purpose: "session" as const, cookieName: SESSION_COOKIE_NAME },
        {
          secret: SESSION_SECRET,
          purpose: "transaction" as const,
          cookieName: SESSION_COOKIE_NAME,
        },
        { secret: SESSION_SECRET, purpose: "session" as const, cookieName: "__Host-vf_session2" },
      ]
    ) {
      await assertRejects(
        () =>
          openAuthCookieEnvelope({
            ...options,
            value: sealed,
            now: NOW,
            maxLifetimeSeconds: 300,
          }),
        TypeError,
        "authenticated",
      );
    }
  });

  it("rejects malformed base64url, padding, non-canonical encodings, wrong versions, and oversized envelopes", async () => {
    assertThrows(() => decodeAuthBase64Url("abcd="), TypeError, "base64url");
    assertThrows(() => decodeAuthBase64Url("abc+"), TypeError, "base64url");
    assertThrows(() => decodeAuthBase64Url("A"), TypeError, "base64url");
    assertThrows(() => decodeAuthBase64Url("__"), TypeError, "canonical");
    assertEquals(encodeAuthBase64Url(new Uint8Array([255])), "_w");

    for (const value of ["v2.abc.def", "v1.abc+def", "v1.abc.def.ghi", `v1.${"a".repeat(3_801)}`]) {
      await assertRejects(
        () =>
          openAuthCookieEnvelope({
            secret: SESSION_SECRET,
            purpose: "session",
            cookieName: SESSION_COOKIE_NAME,
            value,
            now: NOW,
            maxLifetimeSeconds: 300,
          }),
        TypeError,
      );
    }
  });

  it("rejects invalid secrets, version mismatches, invalid timestamps, and lifetime abuse", async () => {
    await assertRejects(
      () =>
        sealAuthCookieEnvelope({
          secret: "short",
          purpose: "session",
          cookieName: SESSION_COOKIE_NAME,
          payload: {},
          issuedAt: NOW,
          expiresAt: NOW + 60,
          randomBytes: fixedRandom,
        }),
      TypeError,
      "secret",
    );

    const cases = [
      { issuedAt: NOW, expiresAt: NOW, message: "positive" },
      { issuedAt: NOW, expiresAt: NOW + 301, message: "lifetime" },
      { issuedAt: NOW + 61, expiresAt: NOW + 120, message: "future" },
      { issuedAt: NOW - 120, expiresAt: NOW - 1, message: "expired" },
    ];

    for (const entry of cases) {
      const sealed = await sealAuthCookieEnvelope({
        secret: SESSION_SECRET,
        purpose: "session",
        cookieName: SESSION_COOKIE_NAME,
        payload: {},
        issuedAt: entry.issuedAt,
        expiresAt: entry.expiresAt,
        randomBytes: fixedRandom,
      });
      await assertRejects(
        () =>
          openAuthCookieEnvelope({
            secret: SESSION_SECRET,
            purpose: "session",
            cookieName: SESSION_COOKIE_NAME,
            value: sealed,
            now: NOW,
            maxLifetimeSeconds: 300,
          }),
        TypeError,
        entry.message,
      );
    }

    const badVersion = await sealRawTestPlaintext(
      JSON.stringify({ v: 2, issuedAt: NOW, expiresAt: NOW + 60, payload: {} }),
    );
    await assertRejects(
      () =>
        openAuthCookieEnvelope({
          secret: SESSION_SECRET,
          purpose: "session",
          cookieName: SESSION_COOKIE_NAME,
          value: badVersion,
          now: NOW,
          maxLifetimeSeconds: 300,
        }),
      TypeError,
      "version",
    );
  });

  it("rejects oversized plaintext JSON and malformed decrypted JSON", async () => {
    await assertRejects(
      () =>
        sealAuthCookieEnvelope({
          secret: SESSION_SECRET,
          purpose: "session",
          cookieName: SESSION_COOKIE_NAME,
          payload: { large: "x".repeat(2_751) },
          issuedAt: NOW,
          expiresAt: NOW + 60,
          randomBytes: fixedRandom,
        }),
      TypeError,
      "plaintext",
    );

    const malformed = await sealRawTestPlaintext("{");
    await assertRejects(
      () =>
        openAuthCookieEnvelope({
          secret: SESSION_SECRET,
          purpose: "session",
          cookieName: SESSION_COOKIE_NAME,
          value: malformed,
          now: NOW,
          maxLifetimeSeconds: 60,
        }),
      TypeError,
      "JSON",
    );
  });
});

describe("security/application-auth cookie serialization", () => {
  it("sets session cookies with bounded __Host attributes and always keeps Secure on loopback", async () => {
    const setCookie = await createSessionCookie({
      secret: SESSION_SECRET,
      payload: { subject: "user-123" },
      maxAgeSeconds: 3_600,
      now: NOW,
      randomBytes: fixedRandom,
    });

    assertEquals(setCookie.startsWith(`${SESSION_COOKIE_NAME}=`), true);
    assertEquals(setCookie.includes("; Path=/"), true);
    assertEquals(setCookie.includes("; HttpOnly"), true);
    assertEquals(setCookie.includes("; Secure"), true);
    assertEquals(setCookie.includes("; SameSite=Lax"), true);
    assertEquals(setCookie.includes("; Domain="), false);
    assertEquals(setCookie.includes("; Max-Age=3600"), true);

    const loopback = await createSessionCookie({
      secret: SESSION_SECRET,
      payload: { subject: "user-123" },
      maxAgeSeconds: 60,
      now: NOW,
      requestUrl: "http://127.0.0.1:3000/",
      randomBytes: fixedRandom,
    });
    assertEquals(loopback.includes("; Secure"), true);
  });

  it("validates transaction state suffixes and supports parallel transaction names", async () => {
    assertThrows(() => getTransactionCookieName("short"), TypeError, "state");
    assertThrows(() => getTransactionCookieName(`${"A".repeat(42)}=`), TypeError, "state");

    const txA = await createTransactionCookie({
      secret: SESSION_SECRET,
      state: STATE_A,
      payload: { nonce: "nonce-a" },
      maxAgeSeconds: 600,
      now: NOW,
      randomBytes: fixedRandom,
    });
    const txB = await createTransactionCookie({
      secret: SESSION_SECRET,
      state: STATE_B,
      payload: { nonce: "nonce-b" },
      maxAgeSeconds: 600,
      now: NOW,
      randomBytes: fixedRandom,
    });

    assertEquals(cookiePair(txA).startsWith(`__Host-vf_oidc_tx_${STATE_A}=`), true);
    assertEquals(cookiePair(txB).startsWith(`__Host-vf_oidc_tx_${STATE_B}=`), true);

    const header = `${cookiePair(txA)}; other=value; ${cookiePair(txB)}`;
    assertEquals(
      await readTransactionCookie({
        secret: SESSION_SECRET,
        state: STATE_A,
        cookieHeader: header,
        now: NOW,
        maxLifetimeSeconds: 600,
      }),
      { nonce: "nonce-a" },
    );
    assertEquals(
      await readTransactionCookie({
        secret: SESSION_SECRET,
        state: STATE_B,
        cookieHeader: header,
        now: NOW,
        maxLifetimeSeconds: 600,
      }),
      { nonce: "nonce-b" },
    );
  });

  it("uses clearing cookies with matching attributes and Max-Age zero", () => {
    assertEquals(
      clearSessionCookie(),
      `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    );
    assertEquals(
      clearTransactionCookie(STATE_A),
      `__Host-vf_oidc_tx_${STATE_A}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    );
  });

  it("bounds cookie headers and treats malformed or absent cookies as missing", async () => {
    const setCookie = await createSessionCookie({
      secret: SESSION_SECRET,
      payload: { subject: "user-123" },
      maxAgeSeconds: 60,
      now: NOW,
      randomBytes: fixedRandom,
    });

    assertEquals(cookieValue(setCookie).includes("user-123"), false);
    assertEquals(
      await readSessionCookie({
        secret: SESSION_SECRET,
        cookieHeader: cookiePair(setCookie),
        now: NOW,
        maxLifetimeSeconds: 60,
      }),
      { subject: "user-123" },
    );
    assertEquals(
      await readSessionCookie({
        secret: SESSION_SECRET,
        cookieHeader: "other=value",
        now: NOW,
        maxLifetimeSeconds: 60,
      }),
      null,
    );
    assertEquals(
      await readSessionCookie({
        secret: SESSION_SECRET,
        cookieHeader: replaceLast(cookiePair(setCookie), "A", "+"),
        now: NOW,
        maxLifetimeSeconds: 60,
      }),
      null,
    );
    assertEquals(
      await readSessionCookie({
        secret: SESSION_SECRET,
        cookieHeader: `other=${"x".repeat(8_193)}`,
        now: NOW,
        maxLifetimeSeconds: 60,
      }),
      null,
    );
  });

  it("honors bounded custom session cookie names and rejects duplicate target cookies", async () => {
    const cookieName = "__Host-custom_session";
    const setCookie = await createSessionCookie({
      secret: SESSION_SECRET,
      payload: { subject: "user-123" },
      maxAgeSeconds: 300,
      now: NOW,
      cookieName,
      randomBytes: fixedRandom,
    });
    const pair = cookiePair(setCookie);

    assertEquals(setCookie.startsWith(`${cookieName}=`), true);
    assertEquals(
      await readSessionCookie({
        secret: SESSION_SECRET,
        cookieHeader: pair,
        now: NOW,
        maxLifetimeSeconds: 300,
        cookieName,
      }),
      { subject: "user-123" },
    );
    assertEquals(
      await readSessionCookie({
        secret: SESSION_SECRET,
        cookieHeader: `${pair}; ${pair}`,
        now: NOW,
        maxLifetimeSeconds: 300,
        cookieName,
      }),
      null,
    );
    assertThrows(
      () => clearSessionCookie("vf_session"),
      TypeError,
      "__Host-",
    );
  });
});
