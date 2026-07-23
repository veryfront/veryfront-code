import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { datasets } from "veryfront/eval";

describe("eval/datasets", () => {
  it("normalizes inline examples and preserves reference plus metadata", async () => {
    const dataset = datasets.inline([
      {
        id: "q1",
        input: { prompt: "Summarize the project" },
        reference: { includes: ["Veryfront"] },
        metadata: { difficulty: "smoke" },
      },
    ]);

    assertEquals(dataset.kind, "inline");
    assertEquals(await dataset.load({ baseDir: Deno.cwd() }), [
      {
        id: "q1",
        input: { prompt: "Summarize the project" },
        reference: { includes: ["Veryfront"] },
        metadata: { difficulty: "smoke" },
      },
    ]);
  });

  it("loads JSON and JSONL datasets relative to a base directory", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-eval-dataset-" });
    try {
      await Deno.mkdir(`${root}/datasets`, { recursive: true });
      await Deno.writeTextFile(
        `${root}/datasets/cases.json`,
        JSON.stringify([
          { id: "json-1", input: "alpha", reference: "A" },
          { id: "json-2", input: "beta", metadata: { split: "regression" } },
        ]),
      );
      await Deno.writeTextFile(
        `${root}/datasets/cases.jsonl`,
        [
          JSON.stringify({ id: "jsonl-1", input: "gamma", reference: "G" }),
          JSON.stringify({ id: "jsonl-2", input: "delta" }),
          "",
        ].join("\n"),
      );

      assertEquals(await datasets.json("datasets/cases.json").load({ baseDir: root }), [
        { id: "json-1", input: "alpha", reference: "A" },
        { id: "json-2", input: "beta", metadata: { split: "regression" } },
      ]);
      assertEquals(await datasets.jsonl("datasets/cases.jsonl").load({ baseDir: root }), [
        { id: "jsonl-1", input: "gamma", reference: "G" },
        { id: "jsonl-2", input: "delta" },
      ]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("rejects duplicate ids and missing input", async () => {
    assertThrows(
      () =>
        datasets.inline([
          { id: "same", input: "alpha" },
          { id: "same", input: "beta" },
        ]),
      Error,
      "Duplicate",
    );

    assertThrows(
      () => datasets.inline([{ id: "missing-input" } as never]),
      Error,
      "input",
    );

    const root = await Deno.makeTempDir({ prefix: "vf-eval-dataset-bad-" });
    try {
      await Deno.writeTextFile(
        `${root}/bad.jsonl`,
        JSON.stringify({ id: "bad", reference: "missing input" }),
      );

      await assertRejects(
        () => datasets.jsonl("bad.jsonl").load({ baseDir: root }),
        Error,
        "input",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("rejects invalid paths, malformed JSON, and oversized dataset files", async () => {
    assertThrows(() => datasets.json(""), Error, "path");
    assertThrows(() => datasets.jsonl("bad\0path"), Error, "path");

    const root = await Deno.makeTempDir({ prefix: "vf-eval-dataset-limits-" });
    try {
      await Deno.writeTextFile(`${root}/malformed.json`, "{");
      await assertRejects(
        () => datasets.json("malformed.json").load({ baseDir: root }),
        Error,
        "malformed.json must be valid JSON",
      );

      const oversized = await Deno.open(`${root}/oversized.json`, {
        create: true,
        write: true,
      });
      try {
        await oversized.truncate(32 * 1024 * 1024 + 1);
      } finally {
        oversized.close();
      }
      await assertRejects(
        () => datasets.json("oversized.json").load({ baseDir: root }),
        Error,
        "exceeds",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
