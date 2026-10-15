import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { connectedDevApiBaseUrl, prepareConnectedDev } from "./connected-dev.ts";

describe("connected local development", () => {
  it("leaves unlinked projects standalone without authentication", async () => {
    assertEquals(
      await prepareConnectedDev(undefined, "preview", {
        authenticate: () => {
          throw new Error("must not authenticate");
        },
        resolve: () => {
          throw new Error("must not resolve");
        },
      }),
      undefined,
    );
  });

  it("requires login before a linked server starts", async () => {
    await assertRejects(
      () =>
        prepareConnectedDev("demo", "preview", {
          authenticate: () => Promise.resolve(false),
          resolve: () => {
            throw new Error("must not resolve");
          },
        }),
      Error,
      "veryfront login",
    );
  });

  it("passes explicit environment selection to the project resolver", async () => {
    const calls: string[][] = [];
    const result = await prepareConnectedDev("demo", "staging", {
      authenticate: () => Promise.resolve(true),
      resolve: (project, environment) => {
        calls.push([project, environment]);
        return Promise.resolve({
          projectId: "p",
          projectSlug: "demo",
          environmentId: "e",
          environmentName: "staging",
        });
      },
    });
    assertEquals(calls, [["demo", "staging"]]);
    assertEquals(result?.environmentId, "e");
  });
});

it("uses the official API for an implicitly qualified default credential", () => {
  assertEquals(connectedDevApiBaseUrl(), "https://api.veryfront.com");
  assertEquals(connectedDevApiBaseUrl("http://localhost:4400"), "http://localhost:4400");
});

it("excludes proxy projects from local Cloud admission", async () => {
  assertEquals(
    await prepareConnectedDev("proxy-project", "preview", {
      authenticate: () => {
        throw new Error("must not authenticate local Cloud runtime");
      },
      resolve: () => {
        throw new Error("must not resolve or mutate association");
      },
    }, true),
    undefined,
  );
});
