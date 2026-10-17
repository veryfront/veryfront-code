/**
 * Real signed control-plane requests under process-global intrinsic replacement.
 * These verification boundaries belong to the semantic integration suite because
 * project code replaces shared crypto, codec, parser, and clock operations.
 */
import { Buffer } from "node:buffer";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import {
  CONTROL_PLANE_AGENTS_LIST_PATH,
  verifyControlPlaneJws,
  verifyControlPlaneJwsRequestSignature,
  verifyControlPlaneJwsSignature,
} from "#veryfront/channels/control-plane.ts";

const encoder = new TextEncoder();

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

async function sha256Base64url(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(body));
  return base64urlEncodeBytes(new Uint8Array(digest));
}

async function createControlPlaneSignature(
  body: string,
  overrides: Partial<{
    algorithm: string;
    audience: string;
    projectId: string;
    requestMethod: string;
    requestPath: string;
    requestId: string;
    surface: "studio" | "channels" | "a2a" | "mcp";
    requestHash: string;
    iat: number;
    exp: number;
    includeRequestBinding: boolean;
  }> = {},
): Promise<{ jws: string; publicKeyPem: string }> {
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKeyDer = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicKeyPem = encodePem("PUBLIC KEY", publicKeyDer);
  const now = Math.floor(Date.now() / 1000);

  const header = base64urlEncode(JSON.stringify({
    alg: overrides.algorithm ?? "EdDSA",
    typ: "JWT",
  }));
  const payload = base64urlEncode(JSON.stringify({
    iss: "veryfront-api",
    aud: overrides.audience ?? "demo-project",
    sub: overrides.requestId ?? "agents-1",
    surface: overrides.surface ?? "studio",
    project_id: overrides.projectId ?? "proj-1",
    request_hash: overrides.requestHash ?? await sha256Base64url(body),
    ...(overrides.includeRequestBinding === false ? {} : {
      request_method: overrides.requestMethod ?? "POST",
      request_path: overrides.requestPath ?? CONTROL_PLANE_AGENTS_LIST_PATH,
    }),
    iat: overrides.iat ?? now,
    exp: overrides.exp ?? now + 60,
  }));

  const signingInput = encoder.encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, signingInput);

  return {
    publicKeyPem,
    jws: `${header}.${payload}.${base64urlEncodeBytes(new Uint8Array(signature))}`,
  };
}

describe("control-plane signed request authority", () => {
  describe("verifyControlPlaneJws", () => {
    it("accepts a valid control-plane signature", async () => {
      const body = JSON.stringify({
        requestId: "agents-1",
        projectId: "proj-1",
        surface: "studio",
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body);

      const claims = await verifyControlPlaneJws(jws, body, {
        audience: "demo-project",
        expectedProjectId: "proj-1",
        expectedSubject: "agents-1",
        expectedSurface: "studio",
        publicKeyPem,
        maxAgeSeconds: 60,
        requestMethod: "POST",
        requestPath: CONTROL_PLANE_AGENTS_LIST_PATH,
      });

      assertEquals(claims.surface, "studio");
      assertEquals(claims.project_id, "proj-1");
      assertEquals(claims.request_hash, await sha256Base64url(body));
    });

    it("rejects a control-plane signature minted for another surface", async () => {
      const body = JSON.stringify({
        requestId: "agents-1",
        projectId: "proj-1",
        surface: "channels",
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
        surface: "channels",
      });

      await assertRejects(
        () =>
          verifyControlPlaneJws(jws, body, {
            audience: "demo-project",
            expectedProjectId: "proj-1",
            expectedSubject: "agents-1",
            expectedSurface: "studio",
            publicKeyPem,
            maxAgeSeconds: 60,
            requestMethod: "POST",
            requestPath: CONTROL_PLANE_AGENTS_LIST_PATH,
          }),
        Error,
        "surface mismatch",
        "an envelope minted for another surface must not satisfy a studio-scoped verification",
      );
    });

    it("rejects a control-plane signature when the body hash does not match", async () => {
      const body = JSON.stringify({
        requestId: "agents-1",
        projectId: "proj-1",
        surface: "studio",
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body);

      await assertRejects(() =>
        verifyControlPlaneJws(jws, `${body} `, {
          audience: "demo-project",
          expectedProjectId: "proj-1",
          publicKeyPem,
          maxAgeSeconds: 60,
          requestMethod: "POST",
          requestPath: CONTROL_PLANE_AGENTS_LIST_PATH,
        })
      );
    });

    it("binds a signature to its uppercase method and exact pathname without stripping leading segments", async () => {
      const body = JSON.stringify({ runId: "run_1" });
      const requestPath = "/tenant/api/control-plane/runs/run_1/resume";
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
        requestId: "run_1",
        requestMethod: "POST",
        requestPath,
      });

      const claims = await verifyControlPlaneJws(jws, body, {
        audience: "demo-project",
        expectedProjectId: "proj-1",
        expectedSubject: "run_1",
        expectedSurface: "studio",
        publicKeyPem,
        maxAgeSeconds: 60,
        requestMethod: "POST",
        requestPath,
      });
      assertEquals(claims.request_method, "POST");
      assertEquals(claims.request_path, requestPath);

      for (
        const [requestMethod, replayPath] of [
          ["DELETE", requestPath],
          ["POST", "/tenant/api/control-plane/runs/run_1"],
          ["POST", "/tenant/api/control-plane/runs/run_2/resume"],
        ] as const
      ) {
        await assertRejects(() =>
          verifyControlPlaneJws(jws, body, {
            audience: "demo-project",
            expectedProjectId: "proj-1",
            publicKeyPem,
            maxAgeSeconds: 60,
            requestMethod,
            requestPath: replayPath,
          })
        );
      }
    });

    it("rejects missing, non-canonical, and oversized request bindings", async () => {
      const body = "{}";
      const invalidClaims = [
        { includeRequestBinding: false },
        { requestMethod: "post" },
        { requestPath: "/api/control-plane/runs/run_1/./resume" },
        { requestPath: `/${"x".repeat(4 * 1024)}` },
      ] as const;

      for (const overrides of invalidClaims) {
        const { jws, publicKeyPem } = await createControlPlaneSignature(body, overrides);
        await assertRejects(() =>
          verifyControlPlaneJws(jws, body, {
            audience: "demo-project",
            expectedProjectId: "proj-1",
            publicKeyPem,
            maxAgeSeconds: 60,
            requestMethod: "POST",
            requestPath: CONTROL_PLANE_AGENTS_LIST_PATH,
          })
        );
      }

      const { jws, publicKeyPem } = await createControlPlaneSignature(body);
      await assertRejects(() =>
        verifyControlPlaneJws(jws, body, {
          audience: "demo-project",
          expectedProjectId: "proj-1",
          publicKeyPem,
          maxAgeSeconds: 60,
          requestMethod: "POST",
          requestPath: "/api/control-plane/./agents/list",
        })
      );

      const nonCanonicalMethod = await createControlPlaneSignature(body, {
        requestMethod: "post",
      });
      await assertRejects(
        () =>
          verifyControlPlaneJws(nonCanonicalMethod.jws, body, {
            audience: "demo-project",
            expectedProjectId: "proj-1",
            publicKeyPem: nonCanonicalMethod.publicKeyPem,
            maxAgeSeconds: 60,
            requestMethod: "post",
            requestPath: CONTROL_PLANE_AGENTS_LIST_PATH,
          }),
        Error,
        "canonical HTTP method",
        "a lowercase signed method must be rejected as non-canonical, not merely mismatched",
      );

      const nonCanonicalPath = await createControlPlaneSignature(body, {
        requestPath: "/api/control-plane/./agents/list",
      });
      await assertRejects(
        () =>
          verifyControlPlaneJws(nonCanonicalPath.jws, body, {
            audience: "demo-project",
            expectedProjectId: "proj-1",
            publicKeyPem: nonCanonicalPath.publicKeyPem,
            maxAgeSeconds: 60,
            requestMethod: "POST",
            requestPath: "/api/control-plane/./agents/list",
          }),
        Error,
        "canonical URL pathname",
        "a dot-segment signed path must be rejected as non-canonical",
      );

      let bindingGetterCalls = 0;
      const accessorOptions = {
        audience: "demo-project",
        expectedProjectId: "proj-1",
        publicKeyPem,
        maxAgeSeconds: 60,
      } as Record<string, unknown>;
      Object.defineProperties(accessorOptions, {
        requestMethod: {
          enumerable: true,
          get() {
            bindingGetterCalls += 1;
            return "POST";
          },
        },
        requestPath: {
          enumerable: true,
          get() {
            bindingGetterCalls += 1;
            return CONTROL_PLANE_AGENTS_LIST_PATH;
          },
        },
      });
      await assertRejects(() => verifyControlPlaneJws(jws, body, accessorOptions as never));
      assertEquals(
        await verifyControlPlaneJwsSignature(jws, accessorOptions as never),
        false,
      );
      assertEquals(bindingGetterCalls, 0);
    });

    it("signature verification uses host crypto and text methods captured before project code", async () => {
      const body = JSON.stringify({ requestId: "agents-1", authorized: true });
      const tamperedBody = JSON.stringify({ requestId: "agents-1", authorized: false });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body);
      const options = {
        audience: "demo-project",
        expectedProjectId: "proj-1",
        expectedSubject: "agents-1",
        publicKeyPem,
        maxAgeSeconds: 60,
        requestMethod: "POST",
        requestPath: CONTROL_PLANE_AGENTS_LIST_PATH,
      };
      const digest = crypto.subtle.digest;
      const verify = crypto.subtle.verify;
      const importKey = crypto.subtle.importKey;
      const encode = TextEncoder.prototype.encode;
      const decode = TextDecoder.prototype.decode;
      const originalDigest = await digest.call(crypto.subtle, "SHA-256", encoder.encode(body));
      const freshSignature = await createControlPlaneSignature(body);
      const originalPayload = new TextDecoder().decode(
        Uint8Array.from(
          atob(jws.split(".")[1]!.replaceAll("-", "+").replaceAll("_", "/")),
          (char) => char.charCodeAt(0),
        ),
      );
      try {
        crypto.subtle.digest = () => Promise.resolve(originalDigest);
        await assertRejects(() => verifyControlPlaneJws(jws, tamperedBody, options));
        assertEquals(
          await verifyControlPlaneJwsRequestSignature(jws, tamperedBody, options),
          false,
        );
        crypto.subtle.verify = () => Promise.resolve(true);
        crypto.subtle.importKey = () => {
          throw new Error("project key import");
        };
        TextEncoder.prototype.encode = () => encode.call(encoder, body);
        TextDecoder.prototype.decode = () => originalPayload;
        // A fresh key exercises importKey instead of the existing verification cache.
        const valid = await verifyControlPlaneJws(freshSignature.jws, body, {
          ...options,
          publicKeyPem: freshSignature.publicKeyPem,
        });
        assertEquals(valid.project_id, "proj-1");
        assertEquals(await verifyControlPlaneJwsRequestSignature(jws, body, options), true);
        await assertRejects(() => verifyControlPlaneJws(jws, tamperedBody, options));
        const parts = jws.split(".");
        const alteredSignature = `${parts[0]}.${parts[1]}.${"A".repeat(86)}`;
        await assertRejects(() => verifyControlPlaneJws(alteredSignature, body, options));
        assertEquals(await verifyControlPlaneJwsSignature(alteredSignature, options), false);
      } finally {
        crypto.subtle.digest = digest;
        crypto.subtle.verify = verify;
        crypto.subtle.importKey = importKey;
        TextEncoder.prototype.encode = encode;
        TextDecoder.prototype.decode = decode;
      }
    });

    it("decoded signed claims cannot be replaced through the global JSON parser", async () => {
      const body = "original-body";
      const changed = "changed-body";
      const { jws, publicKeyPem } = await createControlPlaneSignature(body);
      const changedHash = await sha256Base64url(changed);
      const parse = JSON.parse;
      const options = {
        audience: "demo-project",
        publicKeyPem,
        maxAgeSeconds: 60,
        requestMethod: "POST",
        requestPath: CONTROL_PLANE_AGENTS_LIST_PATH,
      };
      try {
        JSON.parse = (text, reviver) => {
          const value = parse(text, reviver);
          if (value && typeof value === "object" && "request_hash" in value) {
            value.request_hash = changedHash;
          }
          return value;
        };
        await assertRejects(() => verifyControlPlaneJws(jws, changed, options));
        assertEquals(await verifyControlPlaneJwsRequestSignature(jws, changed, options), false);
      } finally {
        JSON.parse = parse;
      }
    });

    it("signed body hashing does not use mutable Buffer base64 conversion", async () => {
      const body = "original-body";
      const { jws, publicKeyPem } = await createControlPlaneSignature(body);
      const hash = await sha256Base64url(body);
      const original = Buffer.prototype.toString;
      try {
        Buffer.prototype.toString = function (encoding, start, end) {
          return encoding === "base64"
            ? hash.replaceAll("-", "+").replaceAll("_", "/") + "="
            : original.call(this, encoding, start, end);
        };
        await assertRejects(() =>
          verifyControlPlaneJws(jws, "changed-body", {
            audience: "demo-project",
            publicKeyPem,
            maxAgeSeconds: 60,
            requestMethod: "POST",
            requestPath: CONTROL_PLANE_AGENTS_LIST_PATH,
          })
        );
      } finally {
        Buffer.prototype.toString = original;
      }
    });

    it("host verification codecs remain available after project codec replacement", async () => {
      const { jws, publicKeyPem } = await createControlPlaneSignature("body");
      const options = {
        audience: "demo-project",
        publicKeyPem,
        maxAgeSeconds: 60,
        requestMethod: "POST",
        requestPath: CONTROL_PLANE_AGENTS_LIST_PATH,
      };
      const from = Uint8Array.from;
      const set = Uint8Array.prototype.set;
      const decode = globalThis.atob;
      const encode = globalThis.btoa;
      const split = String.prototype.split;
      const charCodeAt = String.prototype.charCodeAt;
      const exec = RegExp.prototype.exec;
      const originalPath = Object.getOwnPropertyDescriptor(URL.prototype, "pathname")!;
      const splitHook = Object.getOwnPropertyDescriptor(String.prototype, Symbol.split);
      const replaceHook = Object.getOwnPropertyDescriptor(String.prototype, Symbol.replace);
      let valid = false;
      let proxyValid = false;
      try {
        Uint8Array.from = () => {
          throw new Error("project byte conversion");
        };
        Uint8Array.prototype.set = () => {
          throw new Error("project byte copy");
        };
        globalThis.atob = () => {
          throw new Error("project base64 decode");
        };
        globalThis.btoa = () => {
          throw new Error("project base64 encode");
        };
        String.prototype.split = function (separator, limit) {
          if (this === jws) throw new Error("project JWS split");
          return split.call(this, separator, limit);
        };
        String.prototype.charCodeAt = () => {
          throw new Error("project byte decode");
        };
        RegExp.prototype.exec = function (input) {
          if (input === "POST") throw new Error("project canonical-method predicate");
          return exec.call(this, input);
        };
        Object.defineProperty(String.prototype, Symbol.split, {
          configurable: true,
          value() {
            throw new Error("project split protocol");
          },
        });
        Object.defineProperty(String.prototype, Symbol.replace, {
          configurable: true,
          value() {
            throw new Error("project replace protocol");
          },
        });
        Object.defineProperty(URL.prototype, "pathname", {
          configurable: true,
          get() {
            return "/project-replaced-path";
          },
        });
        valid = (await verifyControlPlaneJws(jws, "body", options)).project_id === "proj-1";
        proxyValid = await verifyControlPlaneJwsRequestSignature(jws, "body", options);
      } finally {
        Uint8Array.from = from;
        Uint8Array.prototype.set = set;
        globalThis.atob = decode;
        globalThis.btoa = encode;
        String.prototype.split = split;
        String.prototype.charCodeAt = charCodeAt;
        RegExp.prototype.exec = exec;
        Object.defineProperty(URL.prototype, "pathname", originalPath);
        if (splitHook) Object.defineProperty(String.prototype, Symbol.split, splitHook);
        else Reflect.deleteProperty(String.prototype, Symbol.split);
        if (replaceHook) Object.defineProperty(String.prototype, Symbol.replace, replaceHook);
        else Reflect.deleteProperty(String.prototype, Symbol.replace);
      }
      assertEquals(valid, true);
      assertEquals(proxyValid, true);
    });

    it("project clock replacement cannot renew an expired signed request", async () => {
      const now = Math.floor(Date.now() / 1000);
      const { jws, publicKeyPem } = await createControlPlaneSignature("body", {
        iat: now - 120,
        exp: now - 60,
      });
      const dateNow = Date.now;
      const options = {
        audience: "demo-project",
        publicKeyPem,
        maxAgeSeconds: 60,
        requestMethod: "POST",
        requestPath: CONTROL_PLANE_AGENTS_LIST_PATH,
      };
      try {
        Date.now = () => (now - 120) * 1000;
        await assertRejects(() => verifyControlPlaneJws(jws, "body", options));
        assertEquals(await verifyControlPlaneJwsRequestSignature(jws, "body", options), false);
      } finally {
        Date.now = dateNow;
      }
    });

    it("rejects a control-plane signature with an unsupported algorithm header", async () => {
      const body = JSON.stringify({
        requestId: "agents-1",
        projectId: "proj-1",
        surface: "studio",
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
        algorithm: "HS256",
      });

      await assertRejects(() =>
        verifyControlPlaneJws(jws, body, {
          audience: "demo-project",
          expectedProjectId: "proj-1",
          publicKeyPem,
          maxAgeSeconds: 60,
          requestMethod: "POST",
          requestPath: CONTROL_PLANE_AGENTS_LIST_PATH,
        })
      );
    });
  });

  describe("verifyControlPlaneJwsSignature", () => {
    it("accepts an authentic, fresh control-plane signature", async () => {
      const { jws, publicKeyPem } = await createControlPlaneSignature("ignored body");

      assertEquals(
        await verifyControlPlaneJwsSignature(jws, {
          publicKeyPem,
          maxAgeSeconds: 60,
          requestMethod: "POST",
          requestPath: CONTROL_PLANE_AGENTS_LIST_PATH,
        }),
        true,
      );
    });

    it("rejects stale, future, forged, and malformed signatures", async () => {
      const now = Math.floor(Date.now() / 1000);
      const stale = await createControlPlaneSignature("ignored body", {
        iat: now - 120,
        exp: now + 60,
      });
      const future = await createControlPlaneSignature("ignored body", {
        iat: now + 30,
        exp: now + 90,
      });
      const valid = await createControlPlaneSignature("ignored body");
      const signatureStart = valid.jws.lastIndexOf(".") + 1;
      const signature = valid.jws.slice(signatureStart);
      const forged = `${valid.jws.slice(0, signatureStart)}${
        signature.startsWith("A") ? "B" : "A"
      }${signature.slice(1)}`;

      for (
        const { jws, publicKeyPem } of [
          stale,
          future,
          { jws: forged, publicKeyPem: valid.publicKeyPem },
          { jws: "not-a-jws", publicKeyPem: valid.publicKeyPem },
        ]
      ) {
        assertEquals(
          await verifyControlPlaneJwsSignature(jws, {
            publicKeyPem,
            maxAgeSeconds: 60,
            requestMethod: "POST",
            requestPath: CONTROL_PLANE_AGENTS_LIST_PATH,
          }),
          false,
        );
      }
    });

    it("rejects invalid freshness policies", async () => {
      const { jws, publicKeyPem } = await createControlPlaneSignature("ignored body");

      assertEquals(
        await verifyControlPlaneJwsSignature(jws, {
          publicKeyPem,
          maxAgeSeconds: Number.NaN,
          requestMethod: "POST",
          requestPath: CONTROL_PLANE_AGENTS_LIST_PATH,
        }),
        false,
      );
    });

    it("binds the proxy-safe verifier to the exact request body", async () => {
      const body = JSON.stringify({ runtimeTargetKind: "main_branch" });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body);
      const options = {
        audience: "demo-project",
        expectedProjectId: "proj-1",
        publicKeyPem,
        maxAgeSeconds: 60,
        requestMethod: "POST",
        requestPath: CONTROL_PLANE_AGENTS_LIST_PATH,
      };

      assertEquals(
        await verifyControlPlaneJwsRequestSignature(jws, body, options),
        true,
      );
      assertEquals(
        await verifyControlPlaneJwsRequestSignature(jws, `${body} `, options),
        false,
      );
    });
  });
});
