import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";
import {
  buildIpv4Url,
  buildLocalhostUrl,
  HTTP_DEFAULTS,
  LOCALHOST,
  REDIS_DEFAULTS,
} from "./network-defaults.ts";

describe("network-defaults", () => {
  it("LOCALHOST should have correct values", () => {
    assertEquals(LOCALHOST.IPV4, "127.0.0.1");
    assertEquals(LOCALHOST.IPV6, "::1");
    assertEquals(LOCALHOST.HOSTNAME, "localhost");
  });

  it("HTTP_DEFAULTS should have correct default port", () => {
    assertEquals(HTTP_DEFAULTS.PORT, 3000);
  });

  it("REDIS_DEFAULTS should have correct default URL", () => {
    assertEquals(REDIS_DEFAULTS.URL, "redis://127.0.0.1:6379");
  });

  describe("buildLocalhostUrl", () => {
    it("should build HTTP URL with port", () => {
      assertEquals(buildLocalhostUrl(3000), "http://localhost:3000");
    });

    it("should build HTTPS URL with port", () => {
      assertEquals(buildLocalhostUrl(8443, "https"), "https://localhost:8443");
    });
  });

  describe("buildIpv4Url", () => {
    it("should build HTTP URL with IPv4", () => {
      assertEquals(buildIpv4Url(3000), "http://127.0.0.1:3000");
    });

    it("should build HTTPS URL with IPv4", () => {
      assertEquals(buildIpv4Url(8443, "https"), "https://127.0.0.1:8443");
    });
  });
});
