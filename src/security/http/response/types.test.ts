import { assertEquals } from "#veryfront/testing/assert.ts";
import type { CORSConfig } from "./types.ts";
import { applyCORSHeadersSync, validateOriginSync } from "#veryfront/security/http/cors/index.ts";

function acceptsSynchronousResponseCors(config: boolean | CORSConfig): boolean {
  return Boolean(config);
}

Deno.test("response CORSConfig preserves async origin-validator source compatibility", () => {
  assertEquals(
    acceptsSynchronousResponseCors({
      origin: (origin) => origin === "https://example.com",
    }),
    true,
  );

  assertEquals(
    acceptsSynchronousResponseCors({ origin: async () => true }),
    true,
  );
});

Deno.test("synchronous CORS helper signatures reject async origin validators", () => {
  type SyncHeaderConfig = NonNullable<
    Parameters<typeof applyCORSHeadersSync>[0]["config"]
  >;
  type SyncValidationConfig = NonNullable<Parameters<typeof validateOriginSync>[1]>;

  const headerAcceptsAsync: { origin: () => Promise<boolean> } extends SyncHeaderConfig ? true
    : false = false;
  const validatorAcceptsAsync: { origin: () => Promise<boolean> } extends SyncValidationConfig
    ? true
    : false = false;

  assertEquals(headerAcceptsAsync, false);
  assertEquals(validatorAcceptsAsync, false);
});
