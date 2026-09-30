import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  INGRESS_API_TOKEN_HEADER,
  INGRESS_INFERENCE_TOKEN_HEADER,
  readIngressCredential,
  requestForWebSocketUpgrade,
  sealIngressCredentials,
} from "../../../src/security/http/ingress-credentials.ts";

const API_TOKEN = "vf-proxy-token-a1b2c3";
const INFERENCE_TOKEN = "vf-inference-token-d4e5f6";

describe("security/http/ingress-credentials over Deno.serve", () => {
  it("seals a request received from Deno.serve, whose headers are immutable", async () => {
    let observed: {
      headers: [string, string][];
      apiToken: string | null;
      inferenceToken: string | null;
      body: string;
    } | undefined;
    const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, async (req) => {
      const sealed = sealIngressCredentials(req);
      observed = {
        headers: [...sealed.headers].filter(([name]) => name.startsWith("x-")),
        apiToken: readIngressCredential(sealed, INGRESS_API_TOKEN_HEADER),
        inferenceToken: readIngressCredential(sealed, INGRESS_INFERENCE_TOKEN_HEADER),
        body: await sealed.text(),
      };
      return new Response("ok");
    });
    try {
      const response = await fetch(`http://127.0.0.1:${server.addr.port}/execute`, {
        method: "POST",
        headers: {
          "x-token": API_TOKEN,
          "x-veryfront-inference-token": INFERENCE_TOKEN,
          "x-veryfront-project-slug": "demo",
        },
        body: "streamed body",
      });
      assertEquals(await response.text(), "ok");
    } finally {
      await server.shutdown();
    }

    assertEquals(observed, {
      headers: [["x-veryfront-project-slug", "demo"]],
      apiToken: API_TOKEN,
      inferenceToken: INFERENCE_TOKEN,
      body: "streamed body",
    });
  });
  it("upgrades a sealed WebSocket request through the server request it came from", async () => {
    let sealedToken: string | null = "unset";
    let headerToken: string | null = "unset";
    const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, (req) => {
      const sealed = sealIngressCredentials(req);
      sealedToken = readIngressCredential(sealed, INGRESS_API_TOKEN_HEADER);
      headerToken = sealed.headers.get("x-token");
      const { socket, response } = Deno.upgradeWebSocket(requestForWebSocketUpgrade(sealed));
      socket.onopen = () => socket.send("hello");
      return response;
    });
    try {
      // Deno's WebSocket client takes custom headers through this option.
      const client = new WebSocket(`ws://127.0.0.1:${server.addr.port}/_ws`, {
        headers: { "x-token": API_TOKEN },
      } as unknown as string[]);
      const message = await new Promise<string>((resolve, reject) => {
        client.onmessage = (event) => resolve(String(event.data));
        client.onerror = () => reject(new Error("WebSocket failed"));
      });
      const closed = new Promise((resolve) => client.onclose = resolve);
      client.close();
      await closed;
      assertEquals(message, "hello");
    } finally {
      await server.shutdown();
    }

    assertEquals(sealedToken, API_TOKEN);
    assertEquals(headerToken, null);
  });
});
