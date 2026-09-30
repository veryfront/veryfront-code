import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const SOURCE = new URL("../../../src/agent/child-run/result-summary.ts", import.meta.url);
const SCANNER =
  "function findToolTranscriptTag(text: string, from: number): ToolTranscriptTag | undefined {";
const UNCLOSED_GUARD = "if ((lastClosing.get(opener.name) ?? -1) < opener.end) {";

async function measureScans(count: number, repeatUnclosedScans = false): Promise<number> {
  let source = await Deno.readTextFile(SOURCE);
  assertEquals(source.split(SCANNER).length, 2, "instrument exactly one scanner");
  if (repeatUnclosedScans) {
    assertEquals(source.split(UNCLOSED_GUARD).length, 2, "mutate exactly one guard");
    const stop = "if (closing === undefined) break;";
    assertEquals(source.split(stop).length, 2, "mutate exactly one stop condition");
    source = source.replace(UNCLOSED_GUARD, "if (false) {").replace(
      stop,
      "if (closing === undefined) { cursor = opener.end; opener = findToolTranscriptTag(text, cursor); continue; }",
    );
  }
  // Instrument a separate module, never the shared realm's string prototypes.
  // A scan budget fails fast on quadratic work, even on a heavily loaded host.
  const budget = count * 20 + 20;
  source = "export let transcriptTagScans = 0;\n" + source.replace(
    SCANNER,
    `${SCANNER}\nif (++transcriptTagScans > ${budget}) throw new Error("Transcript scan budget exceeded");`,
  );
  const module = await import(`data:application/typescript,${encodeURIComponent(source)}`);
  const text = "<tool_response>".repeat(count) + "<tool_call>".repeat(count);
  assertEquals(module.buildChildRunResultSummary(text).text, "");
  return module.transcriptTagScans;
}

describe("child-run transcript scan complexity", () => {
  it("scales linearly across many unclosed transcript tags without wall-clock timing", async () => {
    const shorterScans = await measureScans(8_000);
    const longerScans = await measureScans(16_000);
    assertEquals(shorterScans > 0, true);
    assertEquals(
      longerScans <= shorterScans * 2,
      true,
      JSON.stringify({ shorterScans, longerScans }),
    );
  });

  it("detects repeated scans for unclosed tags when missing closers are rescanned", async () => {
    await assertRejects(
      () => measureScans(64, true),
      Error,
      "Transcript scan budget exceeded",
    );
  });
});
