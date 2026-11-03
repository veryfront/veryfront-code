import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectDeclaredIntegrations,
  unconnectedIntegrationLines,
} from "./unconnected-integrations.ts";

const caseIngest = {
  agentId: "case-ingest",
  tools: { salesforce__get_case: true, gmail__list_emails: true },
};
const caseDispose = {
  agentId: "case-dispose",
  tools: { salesforce__update_case: true },
};

describe("commands/dev/unconnected-integrations", () => {
  it("collects declared integrations with the agents that use them", () => {
    assertEquals(collectDeclaredIntegrations([caseIngest, caseDispose]), [
      { integration: "gmail", agentIds: ["case-ingest"] },
      { integration: "salesforce", agentIds: ["case-dispose", "case-ingest"] },
    ]);
  });

  it("ignores explicitly disabled integration tools", () => {
    assertEquals(
      collectDeclaredIntegrations([{ agentId: "a", tools: { gmail__delete_email: false } }]),
      [],
    );
  });

  it("collects enabled tools without using replaceable array iterators", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
    let result: unknown;
    try {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        value: () => {
          throw new Error("project iterator");
        },
        configurable: true,
      });
      result = collectDeclaredIntegrations([caseDispose]);
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, descriptor);
    }
    assertEquals(result, [{ integration: "salesforce", agentIds: ["case-dispose"] }]);
  });

  it("ignores names that are not catalog integrations", () => {
    assertEquals(
      collectDeclaredIntegrations([{ agentId: "a", tools: { my_helper__run: true } }]),
      [],
    );
  });

  it("prints a line for every integration without a connected tool", () => {
    assertEquals(
      unconnectedIntegrationLines(
        collectDeclaredIntegrations([caseIngest, caseDispose]),
        ["gmail__list_emails"],
        "case-demo",
      ),
      [
        "Salesforce isn't connected. Agents case-dispose and case-ingest need it.",
        "  Connect: npx veryfront integration connect salesforce --project case-demo",
      ],
    );
  });

  it("uses the singular for one agent", () => {
    assertEquals(
      unconnectedIntegrationLines(collectDeclaredIntegrations([caseDispose]), [], "case-demo"),
      [
        "Salesforce isn't connected. Agent case-dispose needs it.",
        "  Connect: npx veryfront integration connect salesforce --project case-demo",
      ],
    );
  });

  it("sanitizes and bounds agent names without hiding the connect command", () => {
    const lines = unconnectedIntegrationLines(
      [
        {
          integration: "salesforce",
          agentIds: ["\u001b]52;c;Y2xpcGJvYXJk\u0007spoof", "a".repeat(3000)],
        },
      ],
      [],
      "case-demo",
    );
    // deno-lint-ignore no-control-regex
    assertEquals(/[\u0000-\u001f\u007f-\u009f]/.test(lines[0]!), false);
    assertEquals(lines[0]!.length < 2200, true);
    assertEquals(
      lines[1],
      "  Connect: npx veryfront integration connect salesforce --project case-demo",
    );
  });

  it("prints nothing when every declared integration is connected", () => {
    assertEquals(
      unconnectedIntegrationLines(
        collectDeclaredIntegrations([caseIngest, caseDispose]),
        ["gmail__list_emails", "salesforce__get_case"],
        "case-demo",
      ),
      [],
    );
  });
});
