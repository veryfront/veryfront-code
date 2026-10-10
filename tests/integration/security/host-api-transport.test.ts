import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing";
import {
  clearEnvFileValueSource,
  markEnvFileValue,
} from "#veryfront/platform/compat/process/env.ts";
import { requireHostPrivateApiHttps } from "#veryfront/config/host-api-base.ts";

const option = "VERYFRONT_HOST_HTTP_API_ORIGIN";
const origin = "http://127.0.0.1:4000";

function configured(value: string | undefined, fn: () => void, apiUrl = origin) {
  return withEnv(
    { [option]: value, VERYFRONT_API_URL: apiUrl, VERYFRONT_API_BASE_URL: undefined },
    fn,
  );
}

describe("host credential API transport", () => {
  it("accepts the explicitly configured numeric loopback API origin", async () => {
    await configured(
      origin,
      () => assertEquals(requireHostPrivateApiHttps(`${origin}/api`), `${origin}/api`),
    );
  });

  it("requires HTTPS by default", async () => {
    await configured(undefined, () => {
      assertThrows(() => requireHostPrivateApiHttps(origin), TypeError);
      assertEquals(
        requireHostPrivateApiHttps("https://api.example/api"),
        "https://api.example/api",
      );
    });
  });

  it("does not authorize another port or hostname", async () => {
    await configured(origin, () => {
      for (
        const value of [
          "http://127.0.0.1:4001",
          "http://localhost:4000",
          "http://192.168.1.1:4000",
          "http://api.example:4000",
        ]
      ) {
        assertThrows(() => requireHostPrivateApiHttps(value), TypeError);
      }
    });
  });

  it("rejects remote origins and malformed permission values", async () => {
    for (
      const value of [
        "true",
        "http://api.example",
        "http://localhost:4000",
        "http://127.0.0.1:4000/path",
        "http://user:pass@127.0.0.1:4000",
        `${origin}?x=1`,
        `${origin}#x`,
      ]
    ) {
      await configured(
        value,
        () => assertThrows(() => requireHostPrivateApiHttps(origin), TypeError),
      );
    }
  });

  it("does not pair a remote API credential with the local permission", async () => {
    await configured(
      origin,
      () => assertThrows(() => requireHostPrivateApiHttps(origin), TypeError),
      "https://api.example",
    );
  });

  it("rejects a permission supplied by a project env file", async () => {
    await configured(origin, () => {
      markEnvFileValue(option);
      try {
        assertThrows(() => requireHostPrivateApiHttps(origin), TypeError);
      } finally {
        clearEnvFileValueSource(option);
      }
    });
  });
  it("supports the explicitly configured IPv6 loopback origin", async () => {
    const value = "http://[::1]:4000";
    await configured(value, () => assertEquals(requireHostPrivateApiHttps(value), value), value);
  });

  it("rejects embedded credentials on an otherwise approved origin", async () => {
    await configured(
      origin,
      () =>
        assertThrows(
          () => requireHostPrivateApiHttps("http://user:pass@127.0.0.1:4000/api"),
          TypeError,
        ),
    );
  });

  it("does not invoke project-replaced URL getters or the global constructor", async () => {
    await configured(origin, () => {
      const original = Object.getOwnPropertyDescriptor(URL.prototype, "origin")!;
      const originalUrl = globalThis.URL;
      let calls = 0;
      Object.defineProperty(URL.prototype, "origin", {
        configurable: true,
        get() {
          calls++;
          return origin;
        },
      });
      Object.defineProperty(globalThis, "URL", {
        configurable: true,
        value: class {
          constructor() {
            calls++;
          }
        },
      });
      try {
        assertEquals(requireHostPrivateApiHttps(`${origin}/api`), `${origin}/api`);
        assertThrows(() => requireHostPrivateApiHttps("http://attacker.example"), TypeError);
        assertEquals(calls, 0);
      } finally {
        Object.defineProperty(globalThis, "URL", {
          configurable: true,
          writable: true,
          value: originalUrl,
        });
        Object.defineProperty(originalUrl.prototype, "origin", original);
      }
    });
  });
});

describe("host credential API transport with both API variables", () => {
  it("accepts the permission when it matches the source-client API base URL", async () => {
    await withEnv(
      {
        [option]: origin,
        VERYFRONT_API_URL: "https://api.example",
        VERYFRONT_API_BASE_URL: `${origin}/api`,
      },
      async () => assertEquals(requireHostPrivateApiHttps(`${origin}/api`), `${origin}/api`),
    );
  });

  it("rejects the permission when neither API variable names it", async () => {
    await withEnv(
      {
        [option]: origin,
        VERYFRONT_API_URL: "https://api.example",
        VERYFRONT_API_BASE_URL: "http://127.0.0.1:4001",
      },
      async () => assertThrows(() => requireHostPrivateApiHttps(origin), TypeError),
    );
  });

  it("rejects an approved origin configured with embedded credentials", async () => {
    await withEnv(
      {
        [option]: origin,
        VERYFRONT_API_URL: "https://api.example",
        VERYFRONT_API_BASE_URL: "http://user:pass@127.0.0.1:4000",
      },
      async () => assertThrows(() => requireHostPrivateApiHttps(origin), TypeError),
    );
  });
});

describe("host credential API transport with ambiguous loopback forms", () => {
  for (
    const value of [
      "http://[::ffff:127.0.0.1]:4000",
      "http://[::ffff:7f00:1]:4000",
      "http://0.0.0.0:4000",
      "http://localhost:4000",
      "http://api.localhost:4000",
      "http://127.0.0.1.nip.io:4000",
      "http://127.0.0.1:4000@api.example",
      "http://api.example#@127.0.0.1:4000",
      "https://127.0.0.1:4000",
    ]
  ) {
    it(`rejects ${value} as the permission and as the target`, async () => {
      await configured(
        value,
        () => {
          assertThrows(() => requireHostPrivateApiHttps(origin), TypeError);
          if (!value.startsWith("https:")) {
            assertThrows(() => requireHostPrivateApiHttps(value), TypeError);
          }
        },
        value,
      );
      await configured(origin, () => {
        if (!value.startsWith("https:")) {
          assertThrows(() => requireHostPrivateApiHttps(value), TypeError);
        }
      });
    });
  }
});
