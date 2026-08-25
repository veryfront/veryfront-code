import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  formatArtifactSize,
  parseNpmPackOutput,
  renderArtifactSizeReport,
} from "./report-artifact-sizes.ts";

const workflowPath = new URL(
  "../../.github/workflows/cicd.yml",
  import.meta.url,
);

describe("artifact size reporting", () => {
  it("formats release sizes with decimal units", () => {
    assertEquals(formatArtifactSize(999), "999 B");
    assertEquals(formatArtifactSize(5_944_908), "5.94 MB");
    assertEquals(formatArtifactSize(1_002_222_451), "1.00 GB");
  });

  it("reads npm tarball and unpacked sizes from npm pack output", () => {
    assertEquals(
      parseNpmPackOutput(JSON.stringify([{
        name: "veryfront",
        version: "0.1.1234",
        size: 5_944_908,
        unpackedSize: 27_719_595,
      }])),
      [
        {
          artifact: "veryfront@0.1.1234",
          kind: "npm tarball",
          bytes: 5_944_908,
        },
        {
          artifact: "veryfront@0.1.1234",
          kind: "npm unpacked",
          bytes: 27_719_595,
        },
      ],
    );
  });

  it("rejects incomplete npm pack output", () => {
    assertThrows(
      () => parseNpmPackOutput('[{"name":"veryfront"}]'),
      Error,
      "npm pack did not return package size metadata",
    );
  });

  it("renders a non-blocking Markdown report", () => {
    const report = renderArtifactSizeReport([
      {
        artifact: "veryfront-linux-x64",
        kind: "CLI binary",
        bytes: 1_002_222_451,
      },
      {
        artifact: "veryfront-proxy-linux-x64",
        kind: "Proxy binary",
        bytes: 180_691_065,
      },
    ]);

    assertEquals(
      report,
      [
        "## Artifact sizes",
        "",
        "| Artifact | Kind | Bytes | Size |",
        "| --- | --- | ---: | ---: |",
        "| `veryfront-linux-x64` | CLI binary | 1,002,222,451 | 1.00 GB |",
        "| `veryfront-proxy-linux-x64` | Proxy binary | 180,691,065 | 180.69 MB |",
      ].join("\n"),
    );
  });

  it("reports npm and binary sizes in CI without size thresholds", async () => {
    const workflow = await Deno.readTextFile(workflowPath);
    const npmReport =
      "deno run --allow-read --allow-run=npm scripts/build/report-artifact-sizes.ts --npm-package npm";
    const binaryReport =
      "deno run --allow-read scripts/build/report-artifact-sizes.ts ./${{ matrix.name }}";

    assertEquals(
      workflow.split(npmReport).length - 1,
      3,
      "npm smoke, prerelease, and release jobs must report package sizes",
    );
    assertEquals(
      workflow.split(binaryReport).length - 1,
      1,
      "the binary matrix must report every compiled artifact",
    );
    assertEquals(
      workflow.includes("ARTIFACT_SIZE_MAX_BYTES"),
      false,
      "artifact reporting must remain observational until a size budget is approved",
    );
  });
});
