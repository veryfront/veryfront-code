import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  LOCALHOST,
  HTTP_DEFAULTS,
  REDIS_DEFAULTS,
  DEV_LOCALHOST_ORIGINS,
  DEV_LOCALHOST_CSP,
  LOCALHOST_URLS,
  buildLocalhostUrl,
  buildIpv4Url,
} from "./network-defaults.ts";

describe("network-defaults", () => {
  describe("LOCALHOST", () => {
    it("should export IPV4 address", () => {
      assertEquals(LOCALHOST.IPV4, "127.0.0.1");
    });

    it("should export IPV6 address", () => {
      assertEquals(LOCALHOST.IPV6, "::1");
    });

    it("should export hostname", () => {
      assertEquals(LOCALHOST.HOSTNAME, "localhost");
    });
  });

  describe("HTTP_DEFAULTS", () => {
    it("should have default port", () => {
      assertEquals(HTTP_DEFAULTS.PORT, 3000);
    });

    it("should have localhost host", () => {
      assertEquals(HTTP_DEFAULTS.HOST, "localhost");
    });

    it("should have production host", () => {
      assertEquals(HTTP_DEFAULTS.PROD_HOST, "0.0.0.0");
    });
  });

  describe("REDIS_DEFAULTS", () => {
    it("should have default Redis URL", () => {
      assertEquals(REDIS_DEFAULTS.URL, "redis://127.0.0.1:6379");
    });

    it("should have default Redis port", () => {
      assertEquals(REDIS_DEFAULTS.PORT, 6379);
    });

    it("should have default Redis host", () => {
      assertEquals(REDIS_DEFAULTS.HOST, "127.0.0.1");
    });
  });

  describe("DEV_LOCALHOST_ORIGINS", () => {
    it("should export array of localhost origins", () => {
      assert(Array.isArray(DEV_LOCALHOST_ORIGINS));
      assertEquals(DEV_LOCALHOST_ORIGINS.length, 4);
    });

    it("should include http localhost", () => {
      assert(DEV_LOCALHOST_ORIGINS.includes("http://localhost"));
    });

    it("should include https localhost", () => {
      assert(DEV_LOCALHOST_ORIGINS.includes("https://localhost"));
    });

    it("should include http IPv4", () => {
      assert(DEV_LOCALHOST_ORIGINS.includes("http://127.0.0.1"));
    });

    it("should include https IPv4", () => {
      assert(DEV_LOCALHOST_ORIGINS.includes("https://127.0.0.1"));
    });
  });

  describe("DEV_LOCALHOST_CSP", () => {
    it("should have WebSocket CSP directive", () => {
      assertEquals(DEV_LOCALHOST_CSP.WS, "ws://localhost:* wss://localhost:*");
    });

    it("should have HTTP CSP directive", () => {
      assertEquals(DEV_LOCALHOST_CSP.HTTP, "http://localhost");
    });
  });

  describe("LOCALHOST_URLS", () => {
    it("should have HTTP localhost URL", () => {
      assertEquals(LOCALHOST_URLS.HTTP, "http://localhost");
    });

    it("should have HTTPS localhost URL", () => {
      assertEquals(LOCALHOST_URLS.HTTPS, "https://localhost");
    });

    it("should have HTTP IPv4 URL", () => {
      assertEquals(LOCALHOST_URLS.HTTP_IPV4, "http://127.0.0.1");
    });

    it("should have HTTPS IPv4 URL", () => {
      assertEquals(LOCALHOST_URLS.HTTPS_IPV4, "https://127.0.0.1");
    });
  });

  describe("buildLocalhostUrl", () => {
    it("should build HTTP localhost URL with port", () => {
      const url = buildLocalhostUrl(3000);
      assertEquals(url, "http://localhost:3000");
    });

    it("should build HTTP localhost URL with custom port", () => {
      const url = buildLocalhostUrl(8080);
      assertEquals(url, "http://localhost:8080");
    });

    it("should build HTTPS localhost URL when specified", () => {
      const url = buildLocalhostUrl(3000, "https");
      assertEquals(url, "https://localhost:3000");
    });

    it("should default to HTTP protocol", () => {
      const url = buildLocalhostUrl(3000);
      assert(url.startsWith("http://"));
    });

    it("should handle different port numbers", () => {
      assertEquals(buildLocalhostUrl(80), "http://localhost:80");
      assertEquals(buildLocalhostUrl(443), "http://localhost:443");
      assertEquals(buildLocalhostUrl(5000), "http://localhost:5000");
    });
  });

  describe("buildIpv4Url", () => {
    it("should build HTTP IPv4 URL with port", () => {
      const url = buildIpv4Url(3000);
      assertEquals(url, "http://127.0.0.1:3000");
    });

    it("should build HTTP IPv4 URL with custom port", () => {
      const url = buildIpv4Url(8080);
      assertEquals(url, "http://127.0.0.1:8080");
    });

    it("should build HTTPS IPv4 URL when specified", () => {
      const url = buildIpv4Url(3000, "https");
      assertEquals(url, "https://127.0.0.1:3000");
    });

    it("should default to HTTP protocol", () => {
      const url = buildIpv4Url(3000);
      assert(url.startsWith("http://"));
    });

    it("should handle different port numbers", () => {
      assertEquals(buildIpv4Url(80), "http://127.0.0.1:80");
      assertEquals(buildIpv4Url(443), "http://127.0.0.1:443");
      assertEquals(buildIpv4Url(5000), "http://127.0.0.1:5000");
    });
  });

  describe("URL builder consistency", () => {
    it("should create valid URLs for both builders", () => {
      const localhostUrl = buildLocalhostUrl(3000);
      const ipv4Url = buildIpv4Url(3000);

      assert(localhostUrl.includes(":3000"));
      assert(ipv4Url.includes(":3000"));
    });

    it("should respect protocol parameter in both builders", () => {
      const localhostHttp = buildLocalhostUrl(3000, "http");
      const localhostHttps = buildLocalhostUrl(3000, "https");
      const ipv4Http = buildIpv4Url(3000, "http");
      const ipv4Https = buildIpv4Url(3000, "https");

      assert(localhostHttp.startsWith("http://"));
      assert(localhostHttps.startsWith("https://"));
      assert(ipv4Http.startsWith("http://"));
      assert(ipv4Https.startsWith("https://"));
    });
  });
});
