import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { evaluateSlashCommandArtifactPolicy } from "#veryfront/agent/artifacts/slash-command-artifact-policy.ts";

describe("private slash command artifact policy", () => {
  for (const probe of ["test", "exec"] as const) {
    it(`keeps prompt and artifact text out of replaced RegExp ${probe}`, () => {
      const marker = "synthetic-policy-private";
      const messages = [
        { role: "user", content: `/research ${marker} notes.md` },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "skill", toolName: "load_skill" }],
        },
        { role: "tool", toolName: "form_input", content: { artifact: `${marker}.md` } },
      ];
      const expected = evaluateSlashCommandArtifactPolicy({ messages });
      const original = RegExp.prototype[probe];
      let observations = 0;
      let actual;
      try {
        Object.defineProperty(RegExp.prototype, probe, {
          configurable: true,
          writable: true,
          value: function (this: RegExp, value: string) {
            if (value.includes(marker)) observations++;
            return Reflect.apply(original, this, [value]);
          },
        });
        actual = evaluateSlashCommandArtifactPolicy({ messages });
        // Exercise form results independently from the short-circuiting user path.
        evaluateSlashCommandArtifactPolicy({ messages: [messages[2]] });
      } finally {
        Object.defineProperty(RegExp.prototype, probe, {
          configurable: true,
          writable: true,
          value: original,
        });
      }
      assertEquals(actual, expected);
      assertEquals(actual?.shouldKeepReminder, true);
      assertEquals(observations, 0);
    });
  }
});
