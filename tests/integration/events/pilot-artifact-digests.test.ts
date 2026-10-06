import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import pilotTranscript from "../../../src/events/contracts/pilot-transcript.json" with {
  type: "json",
};

it("matches the digests pinned for the shared event contract artifacts", async () => {
  for (const [filename, expected] of Object.entries(pilotTranscript.artifacts)) {
    const bytes = await Deno.readFile(
      new URL(`../../../src/events/contracts/${filename}`, import.meta.url),
    );
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const actual = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    assertEquals(actual, expected, filename);
  }
});
