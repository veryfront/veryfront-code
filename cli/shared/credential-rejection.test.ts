import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { checkCredential } from "./credential-rejection.ts";

const API_URL = "https://api.example.test";

/** A transport that answers `status` and records each request URL. */
function answer(status: number): { transport: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const transport = ((input: URL | Request | string) => {
    urls.push(String(input));
    return Promise.resolve(new Response(status === 200 ? "{}" : null, { status }));
  }) as typeof fetch;
  return { transport, urls };
}

describe("cli/shared/credential-rejection", () => {
  for (const status of [401, 403]) {
    it(`reports a login rejected with ${status}`, async () => {
      const { transport, urls } = answer(status);

      assertEquals(await checkCredential("login-token", API_URL, transport, 5_000), "rejected");
      assertEquals(urls, [`${API_URL}/me`]);
    });
  }

  it("reports a login answered with 200 as accepted", async () => {
    const { transport } = answer(200);

    assertEquals(await checkCredential("login-token", API_URL, transport, 5_000), "accepted");
  });

  for (const status of [404, 503]) {
    it(`reports a login answered with ${status} as unknown`, async () => {
      const { transport } = answer(status);

      assertEquals(await checkCredential("login-token", API_URL, transport, 5_000), "unknown");
    });
  }

  it("checks an API key against the endpoint API keys can read", async () => {
    const { transport, urls } = answer(401);

    assertEquals(await checkCredential("vf_api_key", API_URL, transport, 5_000), "rejected");
    assertEquals(urls, [`${API_URL}/projects?limit=1`]);
  });

  it("joins an API URL that ends in slashes without doubling them", async () => {
    const { transport, urls } = answer(401);

    await checkCredential("login-token", `${API_URL}//`, transport, 5_000);

    assertEquals(urls, [`${API_URL}/me`]);
  });

  it("lets a failed request throw, so callers keep the login", async () => {
    const transport = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;

    await assertRejects(
      () => checkCredential("login-token", API_URL, transport, 5_000),
      TypeError,
    );
  });
});
