import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertThrows } from "#veryfront/testing/assert";
import {
  resolveSandboxApiUrl,
  resolveSandboxAuthToken,
  resolveSandboxControlRequestTimeoutMs,
  resolveSandboxProjectId,
  resolveSandboxStartupTimeoutMs,
} from "./config.ts";

Deno.test("sandbox config normalizes explicit credentials and HTTP base URLs", () => {
  assertEquals(
    resolveSandboxApiUrl({ apiUrl: " https://api.example.test/v1/// " }),
    "https://api.example.test/v1",
  );
  assertEquals(resolveSandboxAuthToken({ authToken: " token " }), "token");
  assertEquals(resolveSandboxProjectId(" project-1 "), "project-1");
});

Deno.test("sandbox config rejects ambiguous or credential-bearing API URLs", () => {
  for (
    const apiUrl of [
      "ftp://api.example.test",
      "https://user:secret@api.example.test",
      "https://api.example.test?target=other",
      "https://api.example.test#fragment",
      "not a URL",
    ]
  ) {
    assertThrows(
      () => resolveSandboxApiUrl({ apiUrl }),
      VeryfrontError,
    );
  }

  assertThrows(
    () => resolveSandboxApiUrl({ apiUrl: "   " }),
    VeryfrontError,
    "must be a non-empty string",
  );
  assertThrows(
    () => resolveSandboxAuthToken({ authToken: "   " }),
    VeryfrontError,
    "must be a non-empty string",
  );
  assertThrows(
    () => resolveSandboxAuthToken({ authToken: "token\ninjection" }),
    VeryfrontError,
    "must not contain control characters",
  );
});

Deno.test("sandbox config validates timer and project identifier bounds", () => {
  assertEquals(resolveSandboxStartupTimeoutMs({ startupTimeoutMs: 1 }), 1);
  assertEquals(
    resolveSandboxControlRequestTimeoutMs({ controlRequestTimeoutMs: 0 }, 15_000),
    0,
  );
  assertThrows(
    () => resolveSandboxStartupTimeoutMs({ startupTimeoutMs: 0 }),
    VeryfrontError,
    "between 1",
  );
  assertThrows(
    () => resolveSandboxControlRequestTimeoutMs({ controlRequestTimeoutMs: -1 }, 15_000),
    VeryfrontError,
    "between 0",
  );
  assertThrows(
    () => resolveSandboxProjectId("bad\0project"),
    VeryfrontError,
    "must not contain NUL",
  );
});
