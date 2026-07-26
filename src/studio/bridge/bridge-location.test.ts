import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_STUDIO_URL_LENGTH } from "../limits.ts";
import { getStudioLocationHref } from "./bridge-location.ts";

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    configurable: true,
  });
});

function installLocation(href: unknown): void {
  Object.defineProperty(globalThis, "window", {
    value: { location: { href } },
    configurable: true,
  });
}

describe("studio/bridge/bridge-location", () => {
  it("returns a bounded HTTP location without credentials", () => {
    installLocation("https://user:secret@preview.example/page?mode=inspect#node");

    assertEquals(
      getStudioLocationHref(),
      "https://preview.example/page?mode=inspect#node",
    );
  });

  it("drops optional URL components instead of returning an invalid truncation", () => {
    installLocation(`https://preview.example/page?query=${"x".repeat(MAX_STUDIO_URL_LENGTH)}#node`);

    assertEquals(getStudioLocationHref(), "https://preview.example/page");
  });

  it("redacts credential-like query and fragment values while preserving route state", () => {
    installLocation(
      "https://preview.example/page?access_token=%3CTOKEN%3E&mode=inspect#token=%3CTOKEN%3E",
    );

    assertEquals(
      getStudioLocationHref(),
      "https://preview.example/page?access_token=[REDACTED]&mode=inspect#[REDACTED]",
    );
  });

  it("redacts percent-encoded credential parameter names without rewriting route state", () => {
    installLocation(
      "https://preview.example/page?%61ccess%5Ftoken=%3CTOKEN%3E&route%5Fstate=canvas#node",
    );

    assertEquals(
      getStudioLocationHref(),
      "https://preview.example/page?%61ccess%5Ftoken=[REDACTED]&route%5Fstate=canvas#node",
    );
  });

  it("redacts repeatedly encoded credential names in query and fragment metadata", () => {
    installLocation(
      "https://preview.example/page?%2561ccess%255Ftoken=%3CTOKEN%3E&mode=inspect#%2574oken=%3CTOKEN%3E",
    );

    assertEquals(
      getStudioLocationHref(),
      "https://preview.example/page?%2561ccess%255Ftoken=[REDACTED]&mode=inspect#[REDACTED]",
    );
  });

  it("redacts bracket-notation credentials without changing benign query state", () => {
    installLocation(
      "https://preview.example/page?access_token[]=secret&auth[token]=nested&mode=inspect",
    );

    assertEquals(
      getStudioLocationHref(),
      "https://preview.example/page?access_token[]=[REDACTED]&auth[token]=[REDACTED]&mode=inspect",
    );
  });

  it("redacts identity and session credentials in query and fragment metadata", () => {
    installLocation(
      "https://preview.example/page?id_token=identity&session_id=session&jwt=token#jwt=fragment",
    );

    assertEquals(
      getStudioLocationHref(),
      "https://preview.example/page?id_token=[REDACTED]&session_id=[REDACTED]&jwt=[REDACTED]#[REDACTED]",
    );
  });

  it("falls back to a valid origin when the pathname exceeds the contract", () => {
    installLocation(`https://preview.example/${"x".repeat(MAX_STUDIO_URL_LENGTH)}`);

    const result = getStudioLocationHref();
    assertEquals(result, "https://preview.example/");
    assertEquals(result.length <= MAX_STUDIO_URL_LENGTH, true);
  });

  it("can redact query and fragment metadata", () => {
    installLocation("https://preview.example/page?token=<TOKEN>#private");

    assertEquals(
      getStudioLocationHref({ includeSearch: false, includeHash: false }),
      "https://preview.example/page",
    );
  });

  it("rejects unavailable and non-HTTP locations", () => {
    installLocation("data:text/plain,hello");
    assertEquals(getStudioLocationHref(), "");

    installLocation(42);
    assertEquals(getStudioLocationHref(), "");
  });
});
