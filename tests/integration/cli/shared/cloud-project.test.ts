import { makeTempDirWithOptions } from "#veryfront/testing/deno-compat.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { saveSharedProjectAssociation } from "../../../../cli/shared/project-link.ts";

it("persists only association while preserving existing configuration", async () => {
  const directory = await makeTempDirWithOptions();
  try {
    await Deno.writeTextFile(
      `${directory}/veryfront.json`,
      JSON.stringify({ projects: ["other"] }),
    );
    await saveSharedProjectAssociation(directory, "demo");
    assertEquals(JSON.parse(await Deno.readTextFile(`${directory}/veryfront.json`)), {
      projects: ["other"],
      projectSlug: "demo",
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("refuses association writes through a veryfront.json symlink", async () => {
  const directory = await makeTempDirWithOptions();
  try {
    await Deno.writeTextFile(`${directory}/outside.json`, "{}");
    await Deno.symlink(`${directory}/outside.json`, `${directory}/veryfront.json`);
    let rejected = false;
    try {
      await saveSharedProjectAssociation(directory, "demo");
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true);
    assertEquals(await Deno.readTextFile(`${directory}/outside.json`), "{}");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("retains the write failure and cleans its temporary association", async () => {
  const directory = await makeTempDirWithOptions();
  const originalRename = Deno.rename;
  const failure = new Error("association rename failed");
  try {
    Deno.rename = (() => Promise.reject(failure)) as typeof Deno.rename;
    let caught: unknown;
    try {
      await saveSharedProjectAssociation(directory, "demo");
    } catch (error) {
      caught = error;
    }
    assertEquals(caught, failure);
    assertEquals(await Array.fromAsync(Deno.readDir(directory)), []);
  } finally {
    Deno.rename = originalRename;
    await Deno.remove(directory, { recursive: true });
  }
});

it("preserves the original failure when temporary cleanup also fails", async () => {
  const directory = await makeTempDirWithOptions();
  const originalRename = Deno.rename;
  const originalRemove = Deno.remove;
  const failure = new Error("association rename failed");
  const cleanupFailure = new Error("association cleanup failed");
  try {
    Deno.rename = (() => Promise.reject(failure)) as typeof Deno.rename;
    Deno.remove = (() => Promise.reject(cleanupFailure)) as typeof Deno.remove;
    let caught: unknown;
    try {
      await saveSharedProjectAssociation(directory, "demo");
    } catch (error) {
      caught = error;
    }
    assertEquals(caught instanceof AggregateError, true);
    assertEquals((caught as AggregateError).cause, failure);
    assertEquals((caught as AggregateError).errors, [failure, cleanupFailure]);
  } finally {
    Deno.rename = originalRename;
    Deno.remove = originalRemove;
    await Deno.remove(directory, { recursive: true });
  }
});

it("asks Yes/No before project selection and skips Cloud setup on No", async () => {
  const { chooseCloudProject } = await import("../../../../cli/shared/cloud-project.ts");
  const directory = await makeTempDirWithOptions();
  const prompts: Array<{ question: string; labels: string[] }> = [];
  try {
    await chooseCloudProject(directory, (question, options) => {
      prompts.push({ question, labels: options.map((option) => option.label) });
      return Promise.resolve("no");
    });
    assertEquals(prompts, [{ question: "Use Veryfront Cloud?", labels: ["Yes", "No"] }]);
    assertEquals(await Array.fromAsync(Deno.readDir(directory)), []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("asks new or existing project only after choosing Yes", async () => {
  const { chooseCloudProject } = await import("../../../../cli/shared/cloud-project.ts");
  const prompts: Array<{ question: string; labels: string[] }> = [];
  await chooseCloudProject("unused", (question, options) => {
    prompts.push({ question, labels: options.map((option) => option.label) });
    return Promise.resolve(prompts.length === 1 ? "yes" : null);
  });
  assertEquals(prompts, [
    { question: "Use Veryfront Cloud?", labels: ["Yes", "No"] },
    {
      question: "Choose a cloud project:",
      labels: ["Create a new cloud project", "Use an existing cloud project"],
    },
  ]);
});
