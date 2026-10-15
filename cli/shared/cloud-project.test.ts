import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { saveSharedProjectAssociation } from "./project-link.ts";

it("persists only association while preserving existing configuration", async () => {
  const directory = await Deno.makeTempDir();
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
  const directory = await Deno.makeTempDir();
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
