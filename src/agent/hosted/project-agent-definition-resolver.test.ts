import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { API_AGENT_SOURCE_DOCUMENTS as DOCS } from "./fixtures/api-agent-source-documents.fixture.ts";
import {
  fetchHostedProjectAgentDefinition,
  HostedChildAgentResolutionError,
  toRuntimeAgentDefinitionFromAgentDocument,
} from "./project-agent-definition-resolver.ts";

const BRANCH_ID = "00000000-0000-4000-8000-000000000001";

function stubFetch(response: Response, urls: string[] = []): typeof fetch {
  return (input) => {
    urls.push(String(input instanceof Request ? input.url : input));
    return Promise.resolve(response);
  };
}

function hangingFetch(
  onSignal: (signal: AbortSignal | undefined) => void = () => {},
): typeof fetch {
  return ((_input: unknown, init?: { signal?: AbortSignal | null }) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal ?? undefined;
      onSignal(signal);
      signal?.addEventListener("abort", () => reject(signal.reason));
    })) as unknown as typeof fetch;
}

async function rejection<T extends Error>(
  run: () => Promise<unknown>,
  type: abstract new (...args: never[]) => T,
): Promise<T> {
  try {
    await run();
  } catch (error) {
    assert(error instanceof type);
    return error;
  }
  throw new Error("expected the lookup to reject");
}

function resolutionError(run: () => unknown): HostedChildAgentResolutionError {
  try {
    run();
  } catch (error) {
    assert(error instanceof HostedChildAgentResolutionError);
    return error;
  }
  throw new Error("expected a HostedChildAgentResolutionError");
}

describe("project agent definition resolver (API getAgentSource documents)", () => {
  it("maps Markdown tools: false to deny-all with the skill loader denied", () => {
    const doc = DOCS.tools_false_markdown;
    const definition = toRuntimeAgentDefinitionFromAgentDocument(doc, doc.id);

    assertEquals(definition.tools, []);
    assertEquals(definition.deniedTools, ["load_skill", "veryfront__load_skill"]);
    assertEquals(definition.instructions, "You are Lifecycle Eval Triage. Do not use tools.");
    assertEquals(definition.temperature, 0.2);
    // skill_selection "omitted" keeps every visible skill; deny-all still denies the loader.
    assertEquals(definition.skills, undefined);
  });

  it("maps TypeScript tools: false the same way and keeps provider-native tools", () => {
    const plain = toRuntimeAgentDefinitionFromAgentDocument(
      DOCS.tools_false_typescript,
      DOCS.tools_false_typescript.id,
    );
    assertEquals(plain.tools, []);
    assertEquals(plain.deniedTools, ["load_skill", "veryfront__load_skill"]);
    assertEquals(plain.providerTools, undefined);

    const searcher = toRuntimeAgentDefinitionFromAgentDocument(
      DOCS.tools_false_provider_tools_typescript,
      DOCS.tools_false_provider_tools_typescript.id,
    );
    assertEquals(searcher.tools, []);
    assertEquals(searcher.providerTools, ["web_search"]);
    assertEquals(searcher.deniedTools, ["load_skill", "veryfront__load_skill"]);
  });

  it("maps tool_ids, map denials, all tools and an empty selector", () => {
    const reader = toRuntimeAgentDefinitionFromAgentDocument(
      DOCS.tool_ids_typescript,
      DOCS.tool_ids_typescript.id,
    );
    assertEquals(reader.tools, ["get_file"]);
    assertEquals(reader.skills, []);
    assertEquals(reader.deniedTools, undefined);

    const mapped = toRuntimeAgentDefinitionFromAgentDocument(
      DOCS.tool_map_typescript,
      DOCS.tool_map_typescript.id,
    );
    assertEquals(mapped.tools, ["get_file"]);
    assertEquals(mapped.deniedTools, ["load_skill"]);

    const everything = toRuntimeAgentDefinitionFromAgentDocument(
      DOCS.all_tools_typescript,
      DOCS.all_tools_typescript.id,
    );
    assertEquals(everything.tools, true);

    // `tools: []` selects no project tools but is not deny-all.
    const plain = toRuntimeAgentDefinitionFromAgentDocument(
      DOCS.omitted_tools_markdown,
      DOCS.omitted_tools_markdown.id,
    );
    assertEquals(plain.tools, []);
    assertEquals(plain.deniedTools, undefined);
  });

  it("fails closed on a source_only TypeScript agent instead of running empty instructions", () => {
    const hollow = resolutionError(() =>
      toRuntimeAgentDefinitionFromAgentDocument(
        DOCS.source_only_typescript,
        DOCS.source_only_typescript.id,
      )
    );
    assertEquals(DOCS.source_only_typescript.system_prompt, null);
    assertEquals(hollow.code, "CHILD_AGENT_SOURCE_UNSUPPORTED");
    assert(hollow.message.includes("agents/dynamic.ts"));
    assert(hollow.message.includes("not statically readable"));

    // A projected source_only document may be incomplete, so it fails closed too.
    const projected = resolutionError(() =>
      toRuntimeAgentDefinitionFromAgentDocument(
        DOCS.source_only_typescript_projected,
        DOCS.source_only_typescript_projected.id,
      )
    );
    assertEquals(projected.code, "CHILD_AGENT_SOURCE_UNSUPPORTED");
    assert(projected.message.includes("unsupported top-level statements"));
  });

  it("reads a source_only Markdown agent with the runtime parser or fails closed", () => {
    const invalid = resolutionError(() =>
      toRuntimeAgentDefinitionFromAgentDocument(
        DOCS.source_only_markdown,
        DOCS.source_only_markdown.id,
      )
    );
    assertEquals(invalid.code, "CHILD_AGENT_SOURCE_UNSUPPORTED");
    assert(invalid.message.includes("Markdown source is invalid"));

    const readable = toRuntimeAgentDefinitionFromAgentDocument({
      ...DOCS.source_only_markdown,
      source: "---\nname: Hand Written\ntools:\n  - get_file\n---\nYou are Hand Written.\n",
    }, DOCS.source_only_markdown.id);
    assertEquals(readable.instructions, "You are Hand Written.");
    assertEquals(readable.tools, ["get_file"]);

    const empty = resolutionError(() =>
      toRuntimeAgentDefinitionFromAgentDocument({
        ...DOCS.source_only_markdown,
        source: "---\nname: Hand Written\n---\n",
      }, DOCS.source_only_markdown.id)
    );
    assert(empty.message.includes("has no instructions"));
  });

  it("rejects a document for a different agent", () => {
    const error = resolutionError(() =>
      toRuntimeAgentDefinitionFromAgentDocument(DOCS.tools_false_markdown, "triage")
    );
    assertEquals(error.code, "CHILD_AGENT_LOOKUP_FAILED");
  });
});

describe("project agent definition lookup", () => {
  it("reports a missing agent as not found and reads preview branches", async () => {
    const urls: string[] = [];
    const error = await rejection(
      () =>
        fetchHostedProjectAgentDefinition({
          apiUrl: "https://api.example.com",
          authToken: "token-1",
          projectId: "project-1",
          agentId: "missing",
          branchId: BRANCH_ID,
          fetch: stubFetch(new Response(null, { status: 404 }), urls),
        }),
      HostedChildAgentResolutionError,
    );
    assert(error.message.includes('Agent "missing" was not found in project "project-1"'));

    assertEquals(error.code, "CHILD_AGENT_NOT_FOUND");
    assertEquals(urls, [
      `https://api.example.com/projects/project-1/agents/missing?source_target_kind=preview_branch&target_branch_id=${BRANCH_ID}`,
    ]);
  });

  it("returns the definition for a real API document", async () => {
    const definition = await fetchHostedProjectAgentDefinition({
      apiUrl: "https://api.example.com",
      authToken: "token-1",
      projectId: "project-1",
      agentId: DOCS.tools_false_markdown.id,
      fetch: stubFetch(Response.json(DOCS.tools_false_markdown)),
    });
    assertEquals(definition.tools, []);
  });

  it("fails closed when the lookup fails", async () => {
    const error = await rejection(
      () =>
        fetchHostedProjectAgentDefinition({
          apiUrl: "https://api.example.com",
          authToken: "token-1",
          projectId: "project-1",
          agentId: "triage",
          fetch: stubFetch(new Response(null, { status: 503 })),
        }),
      HostedChildAgentResolutionError,
    );
    assert(error.message.includes("Project agent lookup failed (503)"));
    assertEquals(error.code, "CHILD_AGENT_LOOKUP_FAILED");
  });

  it("bounds the lookup with a timeout", async () => {
    const error = await rejection(
      () =>
        fetchHostedProjectAgentDefinition({
          apiUrl: "https://api.example.com",
          authToken: "token-1",
          projectId: "project-1",
          agentId: "slow",
          timeoutMs: 5,
          fetch: hangingFetch(),
        }),
      HostedChildAgentResolutionError,
    );
    assert(error.message.includes('Project agent lookup for "slow" timed out after 5ms'));
    assertEquals(error.code, "CHILD_AGENT_LOOKUP_TIMEOUT");
  });

  it("propagates the parent abort into the lookup", async () => {
    const parent = new AbortController();
    let lookupSignal: AbortSignal | undefined;
    const lookup = fetchHostedProjectAgentDefinition({
      apiUrl: "https://api.example.com",
      authToken: "token-1",
      projectId: "project-1",
      agentId: "slow",
      abortSignal: parent.signal,
      fetch: hangingFetch((signal) => {
        lookupSignal = signal;
      }),
    });
    parent.abort(new DOMException("Parent run cancelled", "AbortError"));

    const error = await rejection(() => lookup, DOMException);
    assertEquals(error.message, "Parent run cancelled");
    assertEquals(error.name, "AbortError");
    assertEquals(lookupSignal?.aborted, true);
  });

  it("does not start a lookup for an already cancelled parent", async () => {
    let fetched = false;
    await assertRejects(
      () =>
        fetchHostedProjectAgentDefinition({
          apiUrl: "https://api.example.com",
          authToken: "token-1",
          projectId: "project-1",
          agentId: "triage",
          abortSignal: AbortSignal.abort(new DOMException("cancelled", "AbortError")),
          fetch: () => {
            fetched = true;
            return Promise.resolve(Response.json(DOCS.tools_false_markdown));
          },
        }),
      DOMException,
      "cancelled",
    );
    assertEquals(fetched, false);
  });
});
