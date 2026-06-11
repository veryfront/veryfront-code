import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { resolve } from "node:path";
import { loadAgentScopedSkillCatalog } from "./agent-scoped-skill-catalog.ts";
import type { FileDiscoveryContext } from "../../discovery/types.ts";

const context: FileDiscoveryContext = { platform: "node" };

function skillDoc(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`;
}

function withAgentDir(fn: (rootPath: string) => Promise<void>): Promise<void> {
  const rootPath = Deno.makeTempDirSync();
  return fn(rootPath).finally(() => Deno.removeSync(rootPath, { recursive: true }));
}

Deno.test("loadAgentScopedSkillCatalog loads own SKILL.md plus colocated skills", async () => {
  await withAgentDir(async (rootPath) => {
    Deno.writeTextFileSync(
      resolve(rootPath, "SKILL.md"),
      skillDoc("Researcher", "Primary research skill."),
    );
    Deno.mkdirSync(resolve(rootPath, "skills", "cite"), { recursive: true });
    Deno.writeTextFileSync(
      resolve(rootPath, "skills", "cite", "SKILL.md"),
      skillDoc("Cite", "Citation helper."),
    );
    Deno.writeTextFileSync(
      resolve(rootPath, "skills", "search.md"),
      skillDoc("Search", "Search helper."),
    );

    const catalog = await loadAgentScopedSkillCatalog({
      agentId: "researcher",
      rootPath,
      context,
    });

    assertEquals(catalog.map((skill) => skill.id), ["cite", "researcher", "search"]);
  });
});

Deno.test("loadAgentScopedSkillCatalog filters by the skills selector and collects references", async () => {
  await withAgentDir(async (rootPath) => {
    Deno.writeTextFileSync(
      resolve(rootPath, "SKILL.md"),
      skillDoc("Researcher", "Primary research skill."),
    );
    Deno.mkdirSync(resolve(rootPath, "references"), { recursive: true });
    Deno.writeTextFileSync(resolve(rootPath, "references", "guide.md"), "# Guide");
    Deno.mkdirSync(resolve(rootPath, "skills", "cite"), { recursive: true });
    Deno.writeTextFileSync(
      resolve(rootPath, "skills", "cite", "SKILL.md"),
      skillDoc("Cite", "Citation helper."),
    );

    const catalog = await loadAgentScopedSkillCatalog({
      agentId: "researcher",
      rootPath,
      skills: ["researcher"],
      context,
    });

    assertEquals(catalog.length, 1);
    assertEquals(catalog[0]?.id, "researcher");
    assertEquals(catalog[0]?.references, ["references/guide.md"]);
  });
});

Deno.test("loadAgentScopedSkillCatalog returns empty when no colocated skills exist", async () => {
  await withAgentDir(async (rootPath) => {
    const catalog = await loadAgentScopedSkillCatalog({
      agentId: "writer",
      rootPath,
      context,
    });

    assertEquals(catalog, []);
  });
});
