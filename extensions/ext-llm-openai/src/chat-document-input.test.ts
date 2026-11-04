import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { registerModelProvider } from "veryfront/provider";
import { generate } from "veryfront/llm";
import { buildModelCallContextRequest } from "#veryfront/runtime/model-call-context-request.ts";
import { createOpenAIModelRuntime, OpenAIProvider } from "./openai-provider.ts";

const pdfPart = {
  type: "file" as const,
  url: "data:application/pdf;base64,JVBERi0xLjQK",
  mediaType: "application/pdf",
  filename: "request.pdf",
};

describe("OpenAI-compatible Chat Completions document input", () => {
  it("rejects a PDF before inference and sends no provider request", async () => {
    const requests: string[] = [];
    const runtime = createOpenAIModelRuntime({
      apiKey: "test-local-key",
      baseURL: "https://example.compatible.test/v1",
      fetch: (input) => {
        requests.push(String(input));
        return Promise.resolve(Response.json({ choices: [] }));
      },
    }, "compatible-model");
    const dispose = registerModelProvider("compatible-recording", () => runtime);
    try {
      await assertRejects(
        () =>
          generate({
            model: "compatible-recording/compatible-model",
            input: [{
              id: "document-request",
              role: "user",
              parts: [
                { type: "text", text: "Classify" },
                {
                  type: "file",
                  url: "data:application/pdf;base64,JVBERi0xLjQK",
                  mediaType: "application/pdf",
                  filename: "request.pdf",
                },
              ],
            }],
          }),
        TypeError,
        'Chat Completions does not support file input "request.pdf" (application/pdf). ' +
          'Use openAITransport: "responses"',
      );
      assertEquals(requests, []);
    } finally {
      dispose();
    }
  });

  for (const providerName of ["mistral", "openai-compatible"]) {
    it(`auto transport keeps a ${providerName} PDF off Responses and fails before inference`, async () => {
      const requests: string[] = [];
      const runtime = new OpenAIProvider().createModel("compatible-model", {
        credential: "test-local-key",
        baseURL: "https://example.compatible.test/v1",
        providerName,
        fetch: (input) => {
          requests.push(String(input));
          return Promise.resolve(Response.json({}, { status: 400 }));
        },
      });
      await assertRejects(
        () =>
          runtime.doGenerate({
            prompt: [{
              role: "user",
              content: [{
                type: "file",
                url: "data:application/pdf;base64,JVBERi0xLjQK",
                mediaType: "application/pdf",
                filename: "request.pdf",
              }],
            }],
          }),
        TypeError,
        'Chat Completions does not support file input "request.pdf" (application/pdf)',
      );
      assertEquals(requests, []);
    });
  }

  it("auto transport sends a veryfront-cloud PDF to /responses", async () => {
    const requests: string[] = [];
    const runtime = new OpenAIProvider().createModel("gpt-4.1", {
      credential: "test-local-key",
      baseURL: "https://example.gateway.test/v1",
      providerName: "veryfront-cloud",
      fetch: (input) => {
        requests.push(String(input));
        return Promise.resolve(Response.json({}, { status: 400 }));
      },
    });
    await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [{
          type: "file",
          url: "data:application/pdf;base64,JVBERi0xLjQK",
          mediaType: "application/pdf",
          filename: "request.pdf",
        }],
      }],
    }).catch(() => undefined);
    assertEquals(requests, ["https://example.gateway.test/v1/responses"]);
  });

  for (
    const [label, file, endpoint] of [
      ["a PDF", {
        type: "file" as const,
        url: "data:application/pdf;base64,JVBERi0xLjQK",
        mediaType: "application/pdf",
        filename: "request.pdf",
      }, "/responses"],
      ["an image", {
        type: "file" as const,
        url: "https://example.test/photo.png",
        mediaType: "IMAGE/PNG",
      }, "/chat/completions"],
    ] as const
  ) {
    it(`auto transport sends ${label} on a non-reasoning model to ${endpoint}`, async () => {
      const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
      const runtime = new OpenAIProvider().createModel("gpt-4.1", {
        credential: "test-local-key",
        fetch: (input, init) => {
          requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
          return Promise.resolve(Response.json({}, { status: 400 }));
        },
      });
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Classify" }, file] }],
      }).catch(() => undefined);
      assertEquals(requests.map(({ url }) => url), [`https://api.openai.com/v1${endpoint}`]);
      if (endpoint === "/responses") {
        assertEquals((requests[0]!.body.input as Array<{ content: unknown[] }>)[0]!.content[1], {
          type: "input_file",
          file_data: "data:application/pdf;base64,JVBERi0xLjQK",
          filename: "request.pdf",
        });
      }
    });
  }

  for (const providerName of [undefined, "openai"]) {
    it(`auto transport keeps a PDF off Responses on a custom base URL, providerName ${providerName}`, async () => {
      const requests: string[] = [];
      const runtime = new OpenAIProvider().createModel("gpt-4.1", {
        credential: "test-local-key",
        baseURL: "https://example.compatible.test/v1",
        ...(providerName ? { providerName } : {}),
        fetch: (input) => {
          requests.push(String(input));
          return Promise.resolve(Response.json({}, { status: 400 }));
        },
      });
      const options = { prompt: [{ role: "user" as const, content: [pdfPart] }] };
      await assertRejects(
        () => runtime.doGenerate(options),
        TypeError,
        'Chat Completions does not support file input "request.pdf" (application/pdf)',
      );
      assertEquals(requests, []);
      // The durable model-call context projects the same Chat Completions route.
      assertEquals(
        buildModelCallContextRequest(runtime, {
          ...options,
          maxOutputTokens: 100,
          providerOptions: { openai: { max_output_tokens: 666, max_tokens: 777 } },
        })?.maxOutputTokens,
        777,
      );
    });
  }

  it("auto transport sends a PDF to Responses on an OpenAI host base URL", async () => {
    const requests: string[] = [];
    const runtime = new OpenAIProvider().createModel("gpt-4.1", {
      credential: "test-local-key",
      baseURL: "https://eu.api.openai.com/v1",
      fetch: (input) => {
        requests.push(String(input));
        return Promise.resolve(Response.json({}, { status: 400 }));
      },
    });
    const options = { prompt: [{ role: "user" as const, content: [pdfPart] }] };
    await runtime.doGenerate(options).catch(() => undefined);
    assertEquals(requests, ["https://eu.api.openai.com/v1/responses"]);
    assertEquals(
      buildModelCallContextRequest(runtime, {
        ...options,
        maxOutputTokens: 100,
        providerOptions: { openai: { max_output_tokens: 666, max_tokens: 777 } },
      })?.maxOutputTokens,
      666,
    );
  });
});
