import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createProxyAuthRedirectBuilder } from "#veryfront/proxy/proxy-access-control.ts";
import { resolveProxyRequestHost } from "#veryfront/proxy/request-host.ts";
import {
  clearEnvFileValueSources,
  markEnvFileValue,
} from "#veryfront/platform/compat/process/env.ts";

describe("proxy sign-in routed host", () => {
  it("returns to the routed Host instead of an unrelated absolute request target", () => {
    const previous = Deno.env.get("VERYFRONT_PROXY_SIGN_IN_ORIGIN");
    Deno.env.set("VERYFRONT_PROXY_SIGN_IN_ORIGIN", "https://platform.example.test");
    try {
      const request = new Request("https://other.platform.example.test/dashboard?a=1", {
        headers: { host: "app.platform.example.test" },
      });
      const url = new URL(request.url);
      const routedHost = resolveProxyRequestHost(request, url);
      assertEquals(routedHost, "app.platform.example.test");
      assertEquals(
        createProxyAuthRedirectBuilder("https://platform.example.test")(url, routedHost),
        "https://platform.example.test/sign-in?from=https%3A%2F%2Fapp.platform.example.test%2Fdashboard%3Fa%3D1",
      );
    } finally {
      if (previous === undefined) Deno.env.delete("VERYFRONT_PROXY_SIGN_IN_ORIGIN");
      else Deno.env.set("VERYFRONT_PROXY_SIGN_IN_ORIGIN", previous);
    }
  });
});

describe("proxy sign-in operator configuration", () => {
  it("ignores a sign-in origin copied from project dotenv", async () => {
    const key = "VERYFRONT_PROXY_SIGN_IN_ORIGIN";
    const previous = Deno.env.get(key);
    Deno.env.set(key, "https://attacker.example.test");
    markEnvFileValue(key);
    try {
      const module = await import("#veryfront/proxy/proxy-access-control.ts?dotenv-control");
      assertEquals(
        module.buildProxyAuthRedirectUrl(new URL("https://app.platform.example.test/dashboard")),
        "https://veryfront.com/sign-in?from=%2Fdashboard",
      );
    } finally {
      clearEnvFileValueSources();
      if (previous === undefined) Deno.env.delete(key);
      else Deno.env.set(key, previous);
    }
  });

  it("pins the operator origin before project code replaces URL", async () => {
    const key = "VERYFRONT_PROXY_SIGN_IN_ORIGIN";
    const previous = Deno.env.get(key);
    const OriginalURL = globalThis.URL;
    Deno.env.set(key, "https://platform.example.test");
    try {
      const module = await import("#veryfront/proxy/proxy-access-control.ts?primordial-control");
      const requestUrl = new OriginalURL("https://app.platform.example.test/dashboard");
      Deno.env.set(key, "https://attacker.example.test");
      globalThis.URL = class extends OriginalURL {
        constructor() {
          super("https://attacker.example.test");
        }
      };
      assertEquals(
        module.buildProxyAuthRedirectUrl(requestUrl),
        "https://platform.example.test/sign-in?from=https%3A%2F%2Fapp.platform.example.test%2Fdashboard",
      );
    } finally {
      globalThis.URL = OriginalURL;
      if (previous === undefined) Deno.env.delete(key);
      else Deno.env.set(key, previous);
    }
  });
});
