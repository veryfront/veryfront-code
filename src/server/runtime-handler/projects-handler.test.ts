import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";
import { shouldHandleProjectsUI } from "./projects-handler.ts";

function requestFromPeer(hostname: string): Request {
  const request = new Request("http://localhost/", {
    headers: { host: "localhost" },
  });
  recordRequestPeerFromTransport(request, {
    runtime: "deno",
    transport: "tcp",
    hostname,
  });
  return request;
}

describe("shouldHandleProjectsUI", () => {
  it("admits the project chooser only from a direct loopback peer", () => {
    const parsedDomain = parseProjectDomain("localhost");

    assertEquals(
      shouldHandleProjectsUI(requestFromPeer("127.0.0.1"), "/", undefined, parsedDomain),
      true,
    );
    assertEquals(
      shouldHandleProjectsUI(requestFromPeer("192.168.1.25"), "/", undefined, parsedDomain),
      false,
    );
  });

  it("rejects proxy-marked local requests", () => {
    const request = requestFromPeer("127.0.0.1");
    request.headers.set("x-forwarded-for", "203.0.113.8");

    assertEquals(
      shouldHandleProjectsUI(
        request,
        "/_projects/api/config",
        undefined,
        parseProjectDomain(
          "localhost",
        ),
      ),
      false,
    );
  });
});
