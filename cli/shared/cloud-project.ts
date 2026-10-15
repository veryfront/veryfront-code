import { createApiClient, resolveConfigWithAuthNoModule } from "./config.ts";
import { getEnvironmentConfig } from "veryfront/config";
import { inferProjectSlugFromDirectory, persistProjectLink } from "./project-resolution.ts";
import { reserveProjectSlug } from "./reserve-slug.ts";
import { select } from "../utils/terminal-select.ts";

/** Associate source without publishing it; credentials remain in the login store. */
export async function chooseCloudProject(projectDir: string): Promise<void> {
  const mode = await select("Use Veryfront Cloud?", [
    { value: "new", label: "Create a new project" },
    { value: "existing", label: "Use an existing project" },
    { value: "skip", label: "Continue locally" },
  ], 0);
  if (!mode || mode === "skip") {
    console.log(
      "  Cloud inference and Studio runs require a linked project. Run veryfront push whenever you are ready.",
    );
    return;
  }

  const config = await resolveConfigWithAuthNoModule(projectDir, {
    ...getEnvironmentConfig(),
    projectSlug: await inferProjectSlugFromDirectory(projectDir),
  });
  const client = createApiClient(config);
  let project: { id: string; slug: string };
  if (mode === "new") {
    const reserved = await reserveProjectSlug(
      config.projectSlug,
      config.apiToken,
      undefined,
      config.apiUrl,
    );
    project = { id: reserved.projectId, slug: reserved.slug };
  } else {
    const projects: { id: string; slug: string; name?: string }[] = [];
    let cursor: string | undefined;
    do {
      const response = await client.get<{ data: typeof projects; page_info?: { next?: string } }>(
        "/projects",
        {
          limit: "100",
          ...(cursor ? { cursor } : {}),
        },
      );
      projects.push(...response.data);
      cursor = response.page_info?.next;
    } while (cursor);
    if (!projects.length) {
      throw new Error("No Veryfront projects found. Run veryfront push to create one.");
    }
    const id = await select(
      "Choose a project:",
      projects.map((entry) => ({
        value: entry.id,
        label: entry.name ?? entry.slug,
        description: entry.slug,
      })),
      0,
    );
    if (!id) return;
    project = projects.find((entry) => entry.id === id)!;
  }
  await persistProjectLink(projectDir, config, project);
  console.log(`  ✓ Linked to ${project.slug}. Source stays local until veryfront push.`);
}
