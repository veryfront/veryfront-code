import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

type RecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

async function runSnippetsWithOfficialClients(
  snippets: string[],
): Promise<RecordedRequest[]> {
  const tempDir = await Deno.makeTempDir({ prefix: "vf-provider-docs-" });
  try {
    const modulePath = `${tempDir}/provider-snippets.ts`;
    const lockPath = `${tempDir}/deno.lock`;
    const configPath = `${tempDir}/deno.json`;
    await Deno.writeTextFile(
      configPath,
      JSON.stringify(
        {
          lock: lockPath,
          nodeModulesDir: "none",
        },
        null,
        2,
      ),
    );
    await Deno.writeTextFile(modulePath, buildSnippetModule(snippets));

    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--quiet",
        "--config",
        configPath,
        "--allow-env",
        modulePath,
      ],
      clearEnv: true,
      env: { VERYFRONT_API_KEY: "example-project-key" },
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    const decoder = new TextDecoder();
    const stdout = decoder.decode(output.stdout);
    const stderr = decoder.decode(output.stderr);
    if (!output.success) {
      throw new Error(
        `Provider snippet subprocess failed with ${output.code}:\n${stderr}\n${stdout}`,
      );
    }
    return JSON.parse(stdout) as RecordedRequest[];
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

function buildSnippetModule(snippets: string[]): string {
  const transformedSnippets = snippets.map((snippet) =>
    snippet
      .replace(
        'import OpenAI from "openai";',
        'import OpenAI from "npm:openai@7.23.0";',
      )
      .replace(
        'import Anthropic from "@anthropic-ai/sdk";',
        'import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";',
      )
  );
  const imports = transformedSnippets.map((snippet) => snippet.split("\n")[0]);
  const bodies = transformedSnippets.map((snippet) => snippet.split("\n").slice(1).join("\n"));

  return `
${imports.join("\n")}

const requests = [];
const encoder = new TextEncoder();
globalThis.fetch = async (input, init = {}) => {
  const request = new Request(input, init);
  requests.push({
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: request.body ? JSON.parse(await request.text()) : null,
  });
  const body = request.url.endsWith("/chat/completions")
    ? { id: "chatcmpl_example", object: "chat.completion", choices: [] }
    : {
      id: "msg_example",
      type: "message",
      role: "assistant",
      model: "anthropic/claude-sonnet-4-6",
      content: [],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  return new Response(encoder.encode(JSON.stringify(body)), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

${bodies.map((body) => `{\n${body}\n}`).join("\n\n")}

console.log(JSON.stringify(requests));
`;
}

describe("provider guide client snippets", () => {
  it("sends the documented gateway requests", async () => {
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

    const requests = await runSnippetsWithOfficialClients(snippets);

    assertEquals(requests.length, 2);
    assertEquals(requests.map((request) => request.method), ["POST", "POST"]);
    assertEquals(requests.map((request) => request.url), [
      "https://api.veryfront.com/ai/v1/chat/completions",
      "https://api.veryfront.com/ai/v1/messages",
    ]);
    assertEquals(
      requests[0]!.headers.authorization,
      "Bearer example-project-key",
    );
    assertEquals(
      requests[1]!.headers.authorization,
      "Bearer example-project-key",
    );
    assertEquals(requests[1]!.headers["anthropic-version"], "2023-06-01");
    assertEquals(requests[0]!.body, {
      model: "mistral/mistral-small-2503",
      messages: [{ role: "user", content: "Say hello." }],
    });
    assertEquals(requests[1]!.body, {
      model: "anthropic/claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Say hello." }],
    });
  });
});
