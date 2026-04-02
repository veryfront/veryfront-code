export const DEFAULT_E2E_PROJECT = "blank";

export function getProjectsToTest(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const singleProject = env.E2E_PROJECT?.trim();
  if (singleProject) return [singleProject];

  const projectList = env.E2E_PROJECTS;
  if (projectList) {
    const parsedProjects = projectList
      .split(",")
      .map((project) => project.trim())
      .filter(Boolean);

    if (parsedProjects.length > 0) return parsedProjects;
  }

  return [DEFAULT_E2E_PROJECT];
}
