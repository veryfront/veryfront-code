import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#std/assert";
import { OAuthTokensSchema } from "./index.ts";
import type {
  GetUserIdFn,
  OAuthDisconnectHandlerOptions,
  OAuthFetchOptions,
  OAuthStatusHandlerOptions,
  StoredOAuthState,
} from "./index.ts";

Deno.test("OAuth root exports the public handler and persistence types", () => {
  const getUserId: GetUserIdFn = () => "user-1";
  const state: StoredOAuthState = {
    userId: "user-1",
    serviceId: "github",
    createdAt: 0,
  };
  const status: OAuthStatusHandlerOptions = { getUserId };
  const disconnect: OAuthDisconnectHandlerOptions = { getUserId };
  const fetchOptions: OAuthFetchOptions = { maxResponseBytes: 1_024 };

  assertEquals(state.serviceId, "github");
  assertEquals(status.getUserId, getUserId);
  assertEquals(disconnect.getUserId, getUserId);
  assertEquals(fetchOptions.maxResponseBytes, 1_024);
  assertEquals(OAuthTokensSchema.safeParse({ accessToken: "token" }).success, true);
});
