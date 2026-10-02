import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";

type RecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

async function runSnippetsWithOfficialClients(
  snippets: string[],
  options: { includeVeryfrontApiKey?: boolean } = {},
): Promise<RecordedRequest[]> {
  const tempDir = await makeTempDir({ prefix: "vf-provider-docs-" });
  try {
    const modulePath = `${tempDir}/provider-snippets.ts`;
    const lockPath = `${tempDir}/deno.lock`;
    await Deno.copyFile(
      new URL("./provider-client-examples.deno.lock", import.meta.url),
      lockPath,
    );
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

    const denoCacheDirectory = Deno.env.get("DENO_DIR");
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--quiet",
        "--frozen",
        "--config",
        configPath,
        "--allow-env",
        // The Vercel AI SDK (`ai`) reads the host name while it loads.
        "--allow-sys=hostname",
        modulePath,
      ],
      clearEnv: true,
      env: {
        ...(denoCacheDirectory === undefined ? {} : { DENO_DIR: denoCacheDirectory }),
        ...(options.includeVeryfrontApiKey === false
          ? {}
          : { VERYFRONT_API_KEY: "example-project-key" }),
        OPENAI_API_KEY: "openai-vendor-key-must-not-be-sent",
        ANTHROPIC_API_KEY: "vendor-key-must-not-be-sent",
      },
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
    const recorded = stdout.split("\n").find((line) => line.startsWith(REQUESTS_MARKER));
    if (recorded === undefined) {
      throw new Error(`Provider snippet subprocess recorded no requests:\n${stdout}`);
    }
    return JSON.parse(recorded.slice(REQUESTS_MARKER.length)) as RecordedRequest[];
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

/** The client versions the documented snippets are exercised against. */
const PINNED_CLIENT_IMPORTS: ReadonlyArray<readonly [string, string]> = [
  ['from "openai";', 'from "npm:openai@7.23.0";'],
  ['from "@anthropic-ai/sdk";', 'from "npm:@anthropic-ai/sdk@0.128.0";'],
  ['from "ai";', 'from "npm:ai@7.0.127";'],
  ['from "@ai-sdk/openai";', 'from "npm:@ai-sdk/openai@4.0.83";'],
  ['from "@ai-sdk/anthropic";', 'from "npm:@ai-sdk/anthropic@4.0.71";'],
  ['from "@google/genai";', 'from "npm:@google/genai@2.25.0";'],
];

const REQUESTS_MARKER = "__recorded_requests__";

function pinClientImports(snippet: string): string {
  return PINNED_CLIENT_IMPORTS.reduce(
    (pinned, [bare, versioned]) => pinned.replaceAll(bare, versioned),
    snippet,
  );
}

function buildSnippetModule(snippets: string[]): string {
  const imports = new Set<string>();
  const bodies = snippets.map((snippet) => {
    const lines = pinClientImports(snippet).split("\n");
    for (const line of lines.filter((line) => line.startsWith("import "))) {
      imports.add(line);
    }
    return lines.filter((line) => !line.startsWith("import ")).join("\n");
  });

  return `
${[...imports].join("\n")}

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
  let body;
  if (request.url.endsWith("/chat/completions")) {
    body = {
      id: "chatcmpl_example",
      object: "chat.completion",
      created: 0,
      model: "mistral/mistral-small-2503",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Hello." },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  } else if (request.url.endsWith(":generateContent")) {
    body = {
      candidates: [{
        index: 0,
        content: { role: "model", parts: [{ text: "Hello." }] },
        finishReason: "STOP",
      }],
    };
  } else {
    body = {
      id: "msg_example",
      type: "message",
      role: "assistant",
      model: "anthropic/claude-sonnet-4-6",
      content: [{ type: "text", text: "Hello." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  }
  return new Response(encoder.encode(JSON.stringify(body)), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

${bodies.map((body) => `{\n${body}\n}`).join("\n\n")}

console.log(${JSON.stringify(REQUESTS_MARKER)} + JSON.stringify(requests));
`;
}

describe("provider guide client snippets", () => {
  async function getSnippets(): Promise<string[]> {
    const guide = await Deno.readTextFile(
      new URL("../../../docs/guides/providers.md", import.meta.url),
    );
    const section = guide.split("### Call the AI Gateway from other clients")[1]!
      .split("\n## ")[0]!;
    return [...section.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]!);
  }

  it("sends the documented gateway requests", async () => {
    const snippets = await getSnippets();
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
    assertEquals(requests[1]!.headers["x-api-key"], undefined);
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

  it("passes an unknown vendor model id through the OpenAI client", async () => {
    const [openAiSnippet] = await getSnippets();
    const unknownVendorSnippet = openAiSnippet!.replace(
      "mistral/mistral-small-2503",
      "acme-labs/model-not-in-the-built-in-catalog",
    );

    const [request] = await runSnippetsWithOfficialClients([unknownVendorSnippet]);

    assertEquals(request!.url, "https://api.veryfront.com/ai/v1/chat/completions");
    assertEquals(
      (request!.body as { model: string }).model,
      "acme-labs/model-not-in-the-built-in-catalog",
    );
  });

  it("requires a Veryfront key instead of falling back to a vendor key", async () => {
    const error = await assertRejects(
      async () =>
        runSnippetsWithOfficialClients(await getSnippets(), { includeVeryfrontApiKey: false }),
      Error,
    );

    if (!(error instanceof Error)) {
      throw new Error("Expected the missing-project-key guard to reject with an Error");
    }
    assertEquals(error.message.includes("Set VERYFRONT_API_KEY"), true);
  });
});

describe("AI Gateway quickstart SDK snippets", () => {
  async function getSnippets(): Promise<string[]> {
    const guide = await Deno.readTextFile(
      new URL("../../../docs/guides/ai-gateway-quickstart.md", import.meta.url),
    );
    const section = guide.split("\n## SDKs\n")[1]!.split("\n## ")[0]!;
    return [...section.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]!);
  }

  it("sends each documented SDK request to the gateway route with the project key", async () => {
    const snippets = await getSnippets();
    assertEquals(snippets.length, 5);

    const requests = await runSnippetsWithOfficialClients(snippets);

    assertEquals(
      requests.map((request) => `${request.method} ${request.url}`),
      [
        "POST https://api.veryfront.com/ai/v1/chat/completions",
        "POST https://api.veryfront.com/ai/v1/messages",
        "POST https://api.veryfront.com/ai/v1/chat/completions",
        "POST https://api.veryfront.com/ai/v1/messages",
        "POST https://api.veryfront.com/ai/v1beta/models/gemini-2.5-flash:generateContent",
      ],
    );
    for (const request of requests.slice(0, 4)) {
      assertEquals(request.headers.authorization, "Bearer example-project-key");
      assertEquals(request.headers["x-api-key"], undefined);
    }
    assertEquals(requests[4]!.headers["x-goog-api-key"], "example-project-key");
    assertEquals(
      requests.slice(0, 4).map((request) => (request.body as { model: string }).model),
      [
        "mistral/mistral-small-2503",
        "anthropic/claude-sonnet-4-6",
        "mistral/mistral-small-2503",
        "anthropic/claude-sonnet-4-6",
      ],
    );
  });

  it("sends the project header when the account-key line is uncommented", async () => {
    const snippets = (await getSnippets()).map((snippet) => {
      const accountKey = snippet.replace(
        /^(\s*)\/\/ ((?:defaultHeaders|headers): \{ "x-veryfront-project-slug": )"<PROJECT_SLUG>"/m,
        '$1$2"example-project"',
      );
      assert(accountKey !== snippet, `snippet has an account-key line:\n${snippet}`);
      return accountKey;
    });

    const requests = await runSnippetsWithOfficialClients(snippets);

    assertEquals(requests.length, 5);
    for (const request of requests) {
      assertEquals(request.headers["x-veryfront-project-slug"], "example-project");
    }
  });
});
