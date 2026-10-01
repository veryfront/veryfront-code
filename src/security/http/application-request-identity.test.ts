import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  createApplicationRequestHeaders,
  getApplicationPreflightHeaders,
} from "./application-request.ts";

it("withholds environment and default-branch routing identity from applications and preflights", () => {
  const request = new Request("https://app.example", {
    headers: {
      "x-environment-name": "staging",
      "x-default-branch-name": "main",
      authorization: "Bearer application",
      "access-control-request-headers": "Authorization, X-Environment-Name, X-Default-Branch-Name",
    },
  });
  const headers = createApplicationRequestHeaders(request.headers);
  assertEquals(headers.get("x-environment-name"), null);
  assertEquals(headers.get("x-default-branch-name"), null);
  assertEquals(headers.get("authorization"), "Bearer application");
  assertEquals(getApplicationPreflightHeaders(request), "Authorization");
});
