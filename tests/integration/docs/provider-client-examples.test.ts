import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

type ClientOptions = {
  baseURL: string;
  apiKey?: string;
  authToken?: string;
};

class OpenAIClient {
  readonly chat = {
    completions: {
      create: (body: unknown) => this.request("/chat/completions", body),
    },
  };

  constructor(private readonly options: ClientOptions) {}

  private request(path: string, body: unknown): Promise<Response> {
    return recordRequest(`${this.options.baseURL}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.apiKey}` },
      body: JSON.stringify(body),
    });
  }
}

class AnthropicClient {
  readonly messages = {
    create: (body: unknown) => this.request("/v1/messages", body),
  };

  constructor(private readonly options: ClientOptions) {}

  private request(path: string, body: unknown): Promise<Response> {
    return recordRequest(`${this.options.baseURL}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.authToken}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
  }
}

const requests: Request[] = [];

function recordRequest(input: string, init: RequestInit): Promise<Response> {
  requests.push(new Request(input, init));
  return Promise.resolve(
    Response.json({ id: "example", content: [], choices: [] }),
  );
}

describe("provider guide client snippets", () => {
  it("sends the documented gateway requests", async () => {
    requests.length = 0;
    const guide = await Deno.readTextFile(
      new URL("../../../docs/guides/providers.md", import.meta.url),
    );
    const section = guide.split("### Call the AI Gateway from other clients")[1]!
      .split("\n## ")[0]!;
    const snippets = [...section.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]!);
    assertEquals(snippets.length, 2);
    assertEquals(snippets.map((snippet) => snippet.split("\n")[0]), [
      'import OpenAI from "openai";',
      'import Anthropic from "@anthropic-ai/sdk";',
    ]);
    for (const snippet of snippets) {
      const executable = snippet.replace(/^import .*;\n/gm, "");
      await new Function(
        "OpenAI",
        "Anthropic",
        "process",
        `return (async () => {\n${executable}\n})();`,
      )(
        OpenAIClient,
        AnthropicClient,
        { env: { VERYFRONT_API_KEY: "example-project-key" } },
      );
    }
    assertEquals(requests.length, 2);
    assertEquals(requests.map((request) => request.method), ["POST", "POST"]);
    assertEquals(requests.map((request) => request.url), [
      "https://api.veryfront.com/ai/v1/chat/completions",
      "https://api.veryfront.com/ai/v1/messages",
    ]);
    assertEquals(
      requests[0]!.headers.get("authorization"),
      "Bearer example-project-key",
    );
    assertEquals(
      requests[1]!.headers.get("authorization"),
      "Bearer example-project-key",
    );
    assertEquals(requests[1]!.headers.get("anthropic-version"), "2023-06-01");
    assertEquals(await requests[0]!.json(), {
      model: "mistral/mistral-small-2503",
      messages: [{ role: "user", content: "Say hello." }],
    });
    assertEquals(await requests[1]!.json(), {
      model: "anthropic/claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Say hello." }],
    });
  });
});
