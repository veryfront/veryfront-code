import { createCloudOnboardingTransport } from "./cloud-onboarding-transport.ts";
import { getApiUrl } from "./constants.ts";
import { createApiClient, resolveConfigWithAuthNoModule } from "./config.ts";
import { getEnvironmentConfig } from "veryfront/config";
import { inferProjectSlugFromDirectory, persistProjectLink } from "./project-resolution.ts";
import { saveSharedProjectAssociation } from "./project-link.ts";
import { reserveProjectSlug } from "./reserve-slug.ts";
import { select } from "../utils/terminal-select.ts";

/** Associate source without publishing it; new login credentials stay in the private login store. */
export async function chooseCloudProject(
  projectDir: string,
  prompt: typeof select = select,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const useCloud = await prompt("Use Veryfront Cloud?", [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ], 0);
  if (useCloud !== "yes") {
    console.log(
      "  Your local project is ready. Cloud inference and Studio runs require a linked cloud project. Run veryfront push whenever you are ready.",
    );
    return;
  }
  const mode = await prompt("Choose a cloud project:", [
    { value: "new", label: "Create a new cloud project" },
    { value: "existing", label: "Use an existing cloud project" },
  ], 0);
  if (!mode) return;

  const env = getEnvironmentConfig();
  const authOptions = {
    transport: createCloudOnboardingTransport(getApiUrl(env), options.timeoutMs),
    throwOnCredentialValidationUnavailable: true,
  };
  const config = await resolveConfigWithAuthNoModule(projectDir, {
    ...env,
    projectSlug: await inferProjectSlugFromDirectory(projectDir),
  }, authOptions);
  const transport = createCloudOnboardingTransport(config.apiUrl, options.timeoutMs);
  const client = createApiClient(config, transport);
  let project: { id: string; slug: string };
  if (mode === "new") {
    const reserved = await reserveProjectSlug(
      config.projectSlug,
      config.apiToken,
      undefined,
      config.apiUrl,
      { transport },
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
      throw new Error("No cloud projects found. Run veryfront push to create one.");
    }
    const id = await prompt(
      "Select a cloud project:",
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
  await saveSharedProjectAssociation(projectDir, project.slug, config.apiUrl);
  console.log(
    `  ✓ Linked local project to cloud project ${project.slug}. Source stays local until veryfront push.`,
  );
}
