import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const manifestUrl = new URL("./manifest.json", import.meta.url);
const compressedManifestUrl = new URL("./manifest.generated.ts", import.meta.url);

async function decompressBase64Gzip(value: string): Promise<string> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  const stream = new Blob([bytes.buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

describe("compressed template manifest artifact", () => {
  it("round-trips the canonical manifest within the package size budget", async () => {
    const manifest = await Deno.readTextFile(manifestUrl);
    const generated = await Deno.readTextFile(compressedManifestUrl).catch(() => "");
    const encoded = generated.match(
      /COMPRESSED_TEMPLATE_MANIFEST_BASE64:\s*string\s*=\s*"([A-Za-z0-9+/=]+)";/,
    )?.[1];

    assertExists(encoded, "generate a typed compressed template manifest artifact");
    assertEquals(
      JSON.parse(await decompressBase64Gzip(encoded)),
      JSON.parse(manifest),
      "the compressed artifact must reproduce the canonical template manifest",
    );
    assertEquals(
      new TextEncoder().encode(generated).byteLength <=
        new TextEncoder().encode(manifest).byteLength * 0.3,
      true,
      "the shipped generated source must stay at or below 30% of the raw manifest size",
    );
  });
});
