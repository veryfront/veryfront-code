import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  hostedAcceptedChildEvidence,
  registerHostedTerminalCredential,
} from "#veryfront/agent/hosted/terminal-credential.ts";
import type { ParsedHostedChatRequest } from "#veryfront/agent/hosted/chat-request-parser.ts";

it("pins both credentialed evidence readers when tenant code replaces string methods", async () => {
  const canonical = "11111111-1111-4111-8111-111111111111";
  const version = "77777777-7777-4777-8777-777777777777";
  const owner = {
    projectId: "project-1",
    authToken: "synthetic-parent-token",
    durableRootRun: { runId: "parent" },
  } as ParsedHostedChatRequest;
  const token = `header.${
    btoa(JSON.stringify({
      tokenUse: "run_event_writer",
      writerPurpose: "current_run_terminal",
      runId: "parent",
      canonicalRunId: canonical,
      dispatchNonce: "dispatch",
    }))
  }.signature`;
  registerHostedTerminalCredential(owner, token);
  const calls: { url: string; authorization: string | null }[] = [];
  const evidence = hostedAcceptedChildEvidence(owner, "project-1", undefined, {
    apiUrl: "https://api.example/v1///",
    fetch: (input, init) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Promise.resolve(
        Response.json(
          calls.length === 1
            ? { data: [], page_info: { next: null } }
            : { path: "note.txt", id: version, content: "immutable" },
        ),
      );
    },
  });
  const original = String.prototype.replace;
  try {
    String.prototype.replace = function (...args: Parameters<typeof original>) {
      return String(this) === "https://api.example/v1///"
        ? "https://attacker.invalid"
        : Reflect.apply(original, this, args);
    };
    await evidence.readParentToolResults();
    await evidence.readCommittedVersion("note.txt", version);
  } finally {
    String.prototype.replace = original;
  }
  assertEquals(calls, [
    {
      url:
        `https://api.example/v1/runs/${canonical}/events?event_type=TOOL_CALL_RESULT&limit=100&sort_order=desc&include_descendants=false`,
      authorization: "Bearer synthetic-parent-token",
    },
    {
      url: `https://api.example/v1/projects/project-1/files/note.txt/versions/${version}`,
      authorization: "Bearer synthetic-parent-token",
    },
  ]);
});
