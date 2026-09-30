import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createHostedHttpIngress, isHostedHttpApplicationRequest } from "./hosted-http-ingress.ts";
import { createHostedHttpFixture } from "../../../tests/fixtures/hosted-http-broker.ts";
import { CHANNEL_INVOKE_PATH } from "#veryfront/channels/control-plane.ts";

const identity = {
  projectId: "project-a",
  projectSlug: "project-a",
  releaseId: "release-a",
  environmentId: "environment-a",
  environmentName: "staging",
};
const selection = {
  ...identity,
  sourceToken: "source-only",
  mode: "production" as const,
  proxyTrusted: true,
};
const request = () => new Request("https://app.example/api/proof");

function resolvedInput() {
  return {
    ...createHostedHttpFixture(() => new Response("app")).input,
    configuration: {
      ...identity,
      configurationId: "config-a",
      variables: {},
    },
  };
}

describe("hosted HTTP ingress", () => {
  for (
    const key of [
      "projectId",
      "projectSlug",
      "releaseId",
      "environmentId",
      "environmentName",
    ] as const
  ) {
    it(`refuses a missing ${key} before resolving source`, async () => {
      let resolutions = 0;
      const fetch = createHostedHttpIngress({
        broker: {
          fetch() {
            throw new Error("Must not allocate");
          },
        },
        resolve() {
          resolutions++;
          return Promise.resolve(resolvedInput());
        },
      });
      const response = await fetch(request(), { ...selection, [key]: undefined });
      assertEquals(response.status, 503);
      assertEquals(resolutions, 0);
    });
    it(`refuses a resolver's foreign ${key} before dispatch`, async () => {
      let dispatches = 0;
      const fetch = createHostedHttpIngress({
        broker: {
          fetch() {
            dispatches++;
            return Promise.resolve(new Response("must not dispatch"));
          },
        },
        resolve() {
          const input = resolvedInput();
          return Promise.resolve({
            ...input,
            configuration: { ...input.configuration, [key]: "foreign" },
          });
        },
      });
      assertEquals((await fetch(request(), selection)).status, 503);
      assertEquals(dispatches, 0);
    });
  }
  for (
    const extra of [{ mode: "preview" as const }, { proxyTrusted: false }, { sourceToken: "" }]
  ) {
    it(`refuses unsupported selection ${JSON.stringify(extra)} before lookup`, async () => {
      let resolutions = 0;
      const fetch = createHostedHttpIngress({
        broker: {
          fetch() {
            throw new Error("Must not allocate");
          },
        },
        resolve() {
          resolutions++;
          return Promise.resolve(resolvedInput());
        },
      });
      assertEquals((await fetch(request(), { ...selection, ...extra })).status, 503);
      assertEquals(resolutions, 0);
    });
  }
  it("redacts failed source resolution and never falls back", async () => {
    const fetch = createHostedHttpIngress({
      broker: {
        fetch() {
          throw new Error("Must not allocate");
        },
      },
      resolve() {
        throw new Error("synthetic-private-source-credential");
      },
    });
    const response = await fetch(request(), selection);
    assertEquals(response.status, 503);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals((await response.text()).includes("synthetic-private-source-credential"), false);
  });
  it("refuses malformed public origins and unsupported upgrades before lookup", async () => {
    let resolutions = 0;
    const fetch = createHostedHttpIngress({
      broker: {
        fetch() {
          throw new Error("Must not allocate");
        },
      },
      resolve() {
        resolutions++;
        return Promise.resolve(resolvedInput());
      },
    });
    for (
      const headers of [
        new Headers({ "x-forwarded-host": "app.example/path" }),
        new Headers({ upgrade: "websocket" }),
      ]
    ) {
      assertEquals(
        (await fetch(new Request("https://app.example", { headers }), selection)).status,
        503,
      );
    }
    assertEquals(resolutions, 0);
  });
  it("preserves only exact framework control routes on the host", () => {
    for (
      const [method, pathname] of [
        ["POST", "/api/control-plane/agents/list"],
        ["POST", "/api/control-plane/runs/id/execute"],
        ["DELETE", "/api/control-plane/runs/id"],
        ["POST", CHANNEL_INVOKE_PATH],
        ["GET", "/readyz"],
      ]
    ) {
      assertEquals(
        isHostedHttpApplicationRequest(new Request(`https://app.example${pathname}`, { method })),
        false,
      );
    }
    for (
      const [method, pathname] of [
        ["GET", "/api/control-plane/agents/list"],
        ["POST", "/api/control-plane/unknown"],
        ["GET", CHANNEL_INVOKE_PATH],
        ["GET", "/readyz/extra"],
        ["GET", "/_ws"],
        ["OPTIONS", "/api/proof"],
        ["GET", "/_vf_modules/page.js"],
        ["GET", "/"],
      ]
    ) {
      assertEquals(
        isHostedHttpApplicationRequest(new Request(`https://app.example${pathname}`, { method })),
        true,
      );
    }
    assertEquals(
      isHostedHttpApplicationRequest(
        new Request("https://app.example/_ws", { headers: { upgrade: "websocket" } }),
      ),
      false,
    );
    assertEquals(
      isHostedHttpApplicationRequest(
        new Request("https://app.example/_ws", {
          method: "POST",
          headers: { upgrade: "websocket" },
        }),
      ),
      true,
    );
  });
  it("does not allocate after an aborted source lookup returns late", async () => {
    const entered = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<ReturnType<typeof resolvedInput>>();
    let dispatches = 0;
    const fetch = createHostedHttpIngress({
      broker: {
        fetch() {
          dispatches++;
          return Promise.resolve(new Response("must not dispatch"));
        },
      },
      resolve(authority, signal) {
        assertEquals(Object.isFrozen(authority), true);
        assertEquals(signal.aborted, false);
        entered.resolve();
        return ready.promise;
      },
    });
    const abort = new AbortController();
    const response = fetch(new Request("https://app.example", { signal: abort.signal }), selection);
    await entered.promise;
    abort.abort(new Error("Source lookup canceled"));
    ready.resolve(resolvedInput());
    await assertRejects(() => response, Error, "Source lookup canceled");
    assertEquals(dispatches, 0);
  });
  it("replaces the private listener port while preserving public ports and path identity", async () => {
    for (const host of ["app.example", "app.example:8443", "[2001:db8::1]"]) {
      const fetch = createHostedHttpIngress({
        broker: {
          fetch(request) {
            assertEquals(request.url, `https://${host}//path?query=1`);
            assertEquals(request.headers.get("host"), host);
            return Promise.resolve(new Response("matched"));
          },
        },
        resolve: () => Promise.resolve(resolvedInput()),
      });
      const response = await fetch(
        new Request("http://runtime.example:3000//path?query=1", {
          headers: { "x-forwarded-host": host, "x-forwarded-proto": "https" },
        }),
        selection,
      );
      assertEquals(await response.text(), "matched");
    }
  });
  it("bounds preparation without queuing or releasing canceled work before settlement", async () => {
    const entered = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<ReturnType<typeof resolvedInput>>();
    let resolutions = 0;
    let dispatches = 0;
    const fetch = createHostedHttpIngress({
      maxPreparing: 1,
      broker: {
        fetch() {
          dispatches++;
          return Promise.resolve(new Response("admitted"));
        },
      },
      resolve() {
        resolutions++;
        if (resolutions === 1) {
          entered.resolve();
          return ready.promise;
        }
        return Promise.resolve(resolvedInput());
      },
    });
    const abort = new AbortController();
    const pending = fetch(new Request("https://app.example", { signal: abort.signal }), selection);
    void pending.catch(() => {});
    try {
      await entered.promise;
      abort.abort(new Error("Canceled lookup"));
      const busy = await fetch(request(), selection);
      assertEquals(busy.status, 503);
      await busy.body?.cancel();
      assertEquals(resolutions, 1);
      assertEquals(dispatches, 0);
      ready.resolve(resolvedInput());
      await assertRejects(() => pending, Error, "Canceled lookup");
      assertEquals(await (await fetch(request(), selection)).text(), "admitted");
      assertEquals(resolutions, 2);
      assertEquals(dispatches, 1);
    } finally {
      ready.resolve(resolvedInput());
      await pending.catch(() => {});
    }
  });
  it("refuses invalid preparation limits at construction", () => {
    for (const maxPreparing of [0, -1, 1.5, 257, Infinity]) {
      assertThrows(
        () =>
          createHostedHttpIngress({
            maxPreparing,
            broker: { fetch: () => Promise.resolve(new Response()) },
            resolve: () => Promise.resolve(resolvedInput()),
          }),
        TypeError,
        "preparation limit",
      );
    }
  });
});
