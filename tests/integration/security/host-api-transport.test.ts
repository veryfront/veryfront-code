import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing";
import {
  clearEnvFileValueSource,
  markEnvFileValue,
} from "#veryfront/platform/compat/process/env.ts";
import { requireHostPrivateApiHttps } from "#veryfront/config/host-api-base.ts";

const origin = "http://127.0.0.1:4000";

function configured(apiUrl: string | undefined, fn: () => void) {
  return withEnv(
    { VERYFRONT_API_URL: apiUrl, VERYFRONT_API_BASE_URL: undefined },
    fn,
  );
}

describe("host credential API transport", () => {
  it("accepts either host-configured API origin", async () => {
    await withEnv({ VERYFRONT_API_URL: undefined, VERYFRONT_API_BASE_URL: `${origin}/api` }, () => {
      assertEquals(requireHostPrivateApiHttps(origin), origin);
    });
    await withEnv(
      { VERYFRONT_API_URL: "https://api.example", VERYFRONT_API_BASE_URL: origin },
      () => {
        assertEquals(requireHostPrivateApiHttps(origin), origin);
      },
    );
    await withEnv(
      {
        VERYFRONT_API_URL: "https://api.example",
        VERYFRONT_API_BASE_URL: "http://user:pass@127.0.0.1:4000",
      },
      () => assertThrows(() => requireHostPrivateApiHttps(origin), TypeError),
    );
  });

  it("accepts an operator-approved HTTP service origin", async () => {
    for (const value of ["http://api.svc.example:4000", "http://192.168.1.1:4000"]) {
      await configured(value, () => assertEquals(requireHostPrivateApiHttps(value), value));
    }
  });

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
          `blob:${origin}/id`,
        ]
      ) {
        assertThrows(() => requireHostPrivateApiHttps(value), TypeError);
      }
    });
  });

  it("rejects malformed host API values", async () => {
    for (
      const value of [
        "true",
        "ftp://127.0.0.1:4000",
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

  it("does not redirect a configured API credential to another origin", async () => {
    await configured(
      "https://api.example",
      () => assertThrows(() => requireHostPrivateApiHttps(origin), TypeError),
    );
  });

  it("rejects an API origin supplied by a project env file", async () => {
    await configured(origin, () => {
      markEnvFileValue("VERYFRONT_API_URL");
      try {
        assertThrows(() => requireHostPrivateApiHttps(origin), TypeError);
      } finally {
        clearEnvFileValueSource("VERYFRONT_API_URL");
      }
    });
  });
  it("supports the explicitly configured IPv6 loopback origin", async () => {
    const value = "http://[::1]:4000";
    await configured(value, () => assertEquals(requireHostPrivateApiHttps(value), value));
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
