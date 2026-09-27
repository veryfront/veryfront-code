import { assertEquals } from "#veryfront/testing/assert.ts";
import OpenAI from "npm:openai@7.23.0";
import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";

// Run the guide's actual JavaScript with the official clients. Only transport
// and credentials are supplied by the test; the constructor and call stay in
// the extracted example, so client path or authentication changes are visible.
Deno.test("provider guide client snippets send their documented requests", async () => {
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
  const requests: Request[] = [];
  const clientFetch: typeof fetch = (input, init) => {
    requests.push(new Request(input, init));
    return Promise.resolve(
      Response.json({ id: "example", content: [], choices: [] }),
    );
  };
  const clients = {
    OpenAI: class extends OpenAI {
      constructor(options: ConstructorParameters<typeof OpenAI>[0]) {
        super({ ...options, fetch: clientFetch });
      }
    },
    Anthropic: class extends Anthropic {
      constructor(options: ConstructorParameters<typeof Anthropic>[0]) {
        super({ ...options, fetch: clientFetch });
      }
    },
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const snippet of snippets) {
    const executable = snippet.replace(/^import .*;\n/gm, "");
    await new AsyncFunction("OpenAI", "Anthropic", "process", executable)(
      clients.OpenAI,
      clients.Anthropic,
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
  assertEquals(requests[1]!.headers.get("x-api-key"), "example-project-key");
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
