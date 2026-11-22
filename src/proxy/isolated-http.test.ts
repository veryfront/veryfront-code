import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HostedHttpComposition } from "#veryfront/server/isolated-http/hosted-http-composition.ts";
import { createHostedHttpFixture } from "../../tests/fixtures/hosted-http-broker.ts";
import { CHANNEL_INVOKE_PATH } from "#veryfront/channels/control-plane.ts";
import { createProxyHttpIsolation, startProxyHttpIsolation } from "./isolated-http.ts";
import type { ProxyContext } from "./handler.ts";
import { DedicatedServerLookupUnavailable } from "./server-resolver.ts";

function context(): ProxyContext {
  return {
    projectId: "project-a",
    projectSlug: "project-a",
    releaseId: "release-a",
    environmentId: "environment-a",
    environmentName: "staging",
    environment: "production",
    contentSourceId: "release-a",
    token: "private-source-reader",
    host: "app.example",
    requestAuthority: "app.example",
    isLocalProject: false,
    parsedDomain: {
      slug: "project-a",
      branch: null,
      environment: "production",
      isVeryfrontDomain: false,
      isDraft: false,
      allowIframeEmbed: false,
    },
  };
}

function composition() {
  let resolutions = 0;
  let dispatches = 0;
  let retirements = 0;
  let authority: unknown;
  let forwarded: Request | undefined;
  const host: HostedHttpComposition = {
    ingress: {
      resolve(input) {
        resolutions++;
        authority = input;
        return Promise.resolve({
          ...createHostedHttpFixture(() => new Response("unused")).input,
          configuration: {
            projectId: "project-a",
            projectSlug: "project-a",
            releaseId: "release-a",
            environmentId: "environment-a",
            environmentName: "staging",
            configurationId: "config-a",
            variables: {},
          },
        });
      },
      broker: {
        fetch(request) {
          dispatches++;
          forwarded = request;
          return Promise.resolve(new Response("isolated"));
        },
      },
    },
    shutdown() {
      retirements++;
      return Promise.resolve();
    },
  };
  return {
    host,
    get resolutions() {
      return resolutions;
    },
    get dispatches() {
      return dispatches;
    },
    get retirements() {
      return retirements;
    },
    get authority() {
      return authority;
    },
    get forwarded() {
      return forwarded;
    },
  };
}

describe("Proxy isolated HTTP composition", () => {
  it("leaves ordinary proxies unchanged and never loads the Node host when disabled", async () => {
    let loads = 0;
    assertEquals(
      await startProxyHttpIsolation({
        requireDedicatedRouting: false,
        localProjects: { local: "/project" },
      }, {
        isEnabled: () => false,
        loadHost: () => {
          loads++;
          return Promise.reject(new Error("must not load"));
        },
      }),
      undefined,
    );
    assertEquals(loads, 0);
  });

  it("requires host-owned strict routing without local project execution before loading", async () => {
    let loads = 0;
    const cases: Parameters<typeof startProxyHttpIsolation>[0][] = [
      { requireDedicatedRouting: false, localProjects: {} },
      { requireDedicatedRouting: true, localProjects: { local: "/project" } },
    ];
    for (const options of cases) {
      await assertRejects(
        () =>
          startProxyHttpIsolation(options, {
            isEnabled: () => true,
            loadHost: () => {
              loads++;
              return Promise.reject(new Error("must not load"));
            },
          }),
        TypeError,
        "strict dedicated routing",
      );
    }
    assertEquals(loads, 0);
    const fixture = composition();
    const isolation = await startProxyHttpIsolation({
      requireDedicatedRouting: true,
      localProjects: {},
    }, {
      isEnabled: () => true,
      loadHost: () => Promise.resolve(fixture.host),
    });
    await isolation?.shutdown();
    assertEquals(fixture.retirements, 1);
  });

  it("settles a created host when invalid ingress makes startup fail", async () => {
    const fixture = composition();
    fixture.host.ingress.resolve = undefined as never;
    await assertRejects(
      () =>
        startProxyHttpIsolation({ requireDedicatedRouting: true, localProjects: {} }, {
          isEnabled: () => true,
          loadHost: () => Promise.resolve(fixture.host),
        }),
      TypeError,
      "authorized resolver",
    );
    assertEquals(fixture.retirements, 1);
  });

  it("uses canonical context and existing header policy for shared application execution", async () => {
    const fixture = composition();
    const isolation = createProxyHttpIsolation(fixture.host);
    const request = new Request("https://app.example/api/proof", {
      headers: {
        "x-token": "forged",
        "x-project-id": "foreign",
        cookie: "authToken=platform; theme=dark",
      },
    });
    const result = await isolation.route(request, context(), () => Promise.resolve(null));
    assertEquals(result.kind, "response");
    if (result.kind !== "response") throw new Error("No isolated response");
    assertEquals(await result.response.text(), "isolated");
    assertEquals(fixture.resolutions, 1);
    assertEquals(fixture.dispatches, 1);
    assertEquals(fixture.forwarded?.headers.get("x-token"), "private-source-reader");
    assertEquals(fixture.forwarded?.headers.get("x-project-id"), "project-a");
    assertEquals(fixture.forwarded?.headers.get("cookie"), "theme=dark");
    await isolation.shutdown();
  });

  it("pins a verified dedicated origin without consuming the original body or using the pool", async () => {
    const fixture = composition();
    const isolation = createProxyHttpIsolation(fixture.host);
    const request = new Request("https://app.example/api/proof", { method: "POST", body: "body" });
    assertEquals(
      await isolation.route(request, context(), () => Promise.resolve("http://dedicated.example")),
      { kind: "assigned", origin: "http://dedicated.example" },
    );
    assertEquals(await request.text(), "body");
    assertEquals(fixture.resolutions, 0);
    await isolation.shutdown();
  });

  it("refuses unqualified surfaces and incomplete authority before assignment or source reads", async () => {
    const fixture = composition();
    const isolation = createProxyHttpIsolation(fixture.host);
    let lookups = 0;
    const lookup = () => {
      lookups++;
      return Promise.resolve("http://dedicated.example");
    };
    const cases: [Request, ProxyContext][] = [
      [new Request("https://app.example/@/component"), context()],
      [new Request("https://app.example/proof", { headers: { upgrade: "websocket" } }), context()],
      [new Request("https://app.example/proof"), { ...context(), environment: "preview" }],
      [new Request("https://app.example/proof"), {
        ...context(),
        parsedDomain: { ...context().parsedDomain, environment: "preview" },
      }],
      [new Request("https://app.example/proof"), { ...context(), token: undefined }],
      [new Request("https://app.example/proof"), { ...context(), releaseId: undefined }],
      [new Request("https://app.example/proof"), { ...context(), isLocalProject: true }],
      [new Request("https://app.example/proof"), {
        ...context(),
        error: { status: 401, message: "Denied" },
      }],
    ];
    for (const [request, ctx] of cases) {
      const result = await isolation.route(request, ctx, lookup);
      assertEquals(result.kind, "response");
      if (result.kind !== "response") throw new Error("Refusal missing");
      assertEquals(result.response.status, 503);
      assertEquals(result.response.headers.get("cache-control"), "no-store");
      await result.response.body?.cancel();
    }
    assertEquals(lookups, 0);
    assertEquals(fixture.resolutions, 0);
    await isolation.shutdown();
  });

  it("retains framework-owned dispatch outside application pooling", async () => {
    const fixture = composition();
    const isolation = createProxyHttpIsolation(fixture.host);
    assertEquals(
      await isolation.route(
        new Request("https://app.example" + CHANNEL_INVOKE_PATH, { method: "POST" }),
        context(),
        () => Promise.reject(new Error("No lookup expected")),
      ),
      { kind: "framework" },
    );
    assertEquals(fixture.dispatches, 0);
    await isolation.shutdown();
  });

  it("does not reinterpret missing or malformed assignment responses as shared hosting", async () => {
    const fixture = composition();
    const isolation = createProxyHttpIsolation(fixture.host);
    for (
      const invalid of [
        undefined,
        "",
        "http://user:pass@dedicated.example",
        "http://dedicated.example/path",
      ]
    ) {
      await assertRejects(
        () =>
          isolation.route(
            new Request("https://app.example/proof"),
            context(),
            () => Promise.resolve(invalid as string),
          ),
        DedicatedServerLookupUnavailable,
      );
    }
    await assertRejects(
      () =>
        isolation.route(
          new Request("https://app.example/proof"),
          context(),
          () => Promise.reject(new DedicatedServerLookupUnavailable()),
        ),
      DedicatedServerLookupUnavailable,
    );
    assertEquals(fixture.dispatches, 0);
    await isolation.shutdown();
  });

  it("snapshots identity and private authority before asynchronous assignment lookup", async () => {
    const fixture = composition();
    const isolation = createProxyHttpIsolation(fixture.host);
    const ctx = context();
    const result = await isolation.route(new Request("https://app.example/proof"), ctx, () => {
      ctx.projectId = "changed";
      ctx.token = "changed";
      return Promise.resolve(null);
    });
    assertEquals(result.kind, "response");
    if (result.kind === "response") await result.response.body?.cancel();
    assertEquals(
      (fixture.authority as { sourceToken: string }).sourceToken,
      "private-source-reader",
    );
    assertEquals(fixture.forwarded?.headers.get("x-project-id"), "project-a");
    await isolation.shutdown();
  });

  it("binds assignment lookup to the captured environment before caller mutation", async () => {
    const fixture = composition();
    const isolation = createProxyHttpIsolation(fixture.host);
    const ctx = context();
    const environments: (string | undefined)[] = [];
    const result = isolation.route(
      new Request("https://app.example/proof"),
      ctx,
      (environmentId?: string) => {
        environments.push(environmentId);
        return Promise.resolve("http://dedicated.example");
      },
    );
    ctx.environmentId = "foreign-environment";
    try {
      assertEquals(await result, { kind: "assigned", origin: "http://dedicated.example" });
      assertEquals(environments, ["environment-a"]);
      assertEquals(fixture.resolutions, 0);
      assertEquals(fixture.dispatches, 0);
    } finally {
      await isolation.shutdown();
    }
  });

  it("detaches a canceled lookup while the shared resolver keeps ownership", async () => {
    const fixture = composition();
    const isolation = createProxyHttpIsolation(fixture.host);
    const pending = Promise.withResolvers<string | null>();
    const cancel = new AbortController();
    const response = isolation.route(
      new Request("https://app.example/proof", { signal: cancel.signal }),
      context(),
      () => pending.promise,
    );
    cancel.abort();
    await assertRejects(() => response, DOMException, "aborted");
    pending.resolve(null);
    assertEquals(fixture.dispatches, 0);
    await isolation.shutdown();
  });

  it("closes admission and retires once without hiding host retirement failure", async () => {
    const fixture = composition();
    fixture.host.shutdown = () => {
      throw new Error("Retirement unconfirmed");
    };
    const isolation = createProxyHttpIsolation(fixture.host);
    await assertRejects(() => isolation.shutdown(), Error, "Retirement unconfirmed");
    await assertRejects(() => isolation.shutdown(), Error, "Retirement unconfirmed");
    const result = await isolation.route(
      new Request("https://app.example/proof"),
      context(),
      () => Promise.resolve(null),
    );
    if (result.kind !== "response") throw new Error("Admission reopened");
    assertEquals(result.response.status, 503);
    await result.response.body?.cancel();
    assertEquals(fixture.resolutions, 0);
  });
});
