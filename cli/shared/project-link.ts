import { isNotFoundError, lstat, realPath } from "veryfront/fs";
import { join, relative } from "veryfront/platform/path";

const PROJECT_LINK_VERSION = 1 as const;
const PROJECT_LINK_DIRECTORY = ".veryfront";
const PROJECT_LINK_FILENAME = "project.json";
export const PROJECT_LINK_RELATIVE_PATH = `${PROJECT_LINK_DIRECTORY}/${PROJECT_LINK_FILENAME}`;

export interface ProjectLink {
  version: typeof PROJECT_LINK_VERSION;
  controlPlane: string;
  projectId: string;
  projectSlug: string;
}

function projectLinkPath(projectDir: string): string {
  return join(projectDir, PROJECT_LINK_DIRECTORY, PROJECT_LINK_FILENAME);
}

function projectLinkPathError(): Error {
  return new Error(
    `Veryfront cannot use ${PROJECT_LINK_RELATIVE_PATH} through a symbolic link. Remove the link and run the command again.`,
  );
}

async function lstatIfPresent(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function inspectProjectLinkPath(
  projectDir: string,
): Promise<{ directoryExists: boolean; linkExists: boolean }> {
  const directory = join(projectDir, PROJECT_LINK_DIRECTORY);
  const directoryInfo = await lstatIfPresent(directory);
  if (!directoryInfo) return { directoryExists: false, linkExists: false };
  if (directoryInfo.isSymlink) throw projectLinkPathError();
  if (!directoryInfo.isDirectory) {
    throw new Error(`${PROJECT_LINK_DIRECTORY} must be a directory inside the project.`);
  }

  const [canonicalProject, canonicalDirectory] = await Promise.all([
    realPath(projectDir),
    realPath(directory),
  ]);
  if (relative(canonicalProject, canonicalDirectory) !== PROJECT_LINK_DIRECTORY) {
    throw projectLinkPathError();
  }

  const linkInfo = await lstatIfPresent(projectLinkPath(projectDir));
  if (!linkInfo) return { directoryExists: true, linkExists: false };
  if (linkInfo.isSymlink) throw projectLinkPathError();
  if (!linkInfo.isFile) {
    throw new Error(`${PROJECT_LINK_RELATIVE_PATH} must be a file.`);
  }
  return { directoryExists: true, linkExists: true };
}

function normalizeControlPlane(controlPlane: string): string {
  const url = new URL(controlPlane);
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

function controlPlanesMatch(left: string, right: string): boolean {
  try {
    return normalizeControlPlane(left) === normalizeControlPlane(right);
  } catch {
    return false;
  }
}

function isProjectLink(value: unknown): value is ProjectLink {
  if (!value || typeof value !== "object") return false;
  const link = value as Record<string, unknown>;
  return link.version === PROJECT_LINK_VERSION &&
    typeof link.controlPlane === "string" &&
    typeof link.projectId === "string" &&
    typeof link.projectSlug === "string";
}

export async function readProjectLink(projectDir: string): Promise<ProjectLink | null> {
  await inspectProjectLinkPath(projectDir);
  try {
    const value: unknown = JSON.parse(await Deno.readTextFile(projectLinkPath(projectDir)));
    return isProjectLink(value) ? value : null;
  } catch (error) {
    if (error instanceof SyntaxError || isNotFoundError(error)) return null;
    throw error;
  }
}

export async function readProjectLinkForControlPlane(
  projectDir: string,
  resolvedApiUrl: string,
): Promise<ProjectLink | null> {
  const link = await readProjectLink(projectDir);
  if (!link) return null;
  if (controlPlanesMatch(link.controlPlane, resolvedApiUrl)) return link;

  throw new Error(
    `Veryfront project link ${
      projectLinkPath(projectDir)
    } targets control plane "${link.controlPlane}", but the resolved API URL is "${resolvedApiUrl}". Relink this project or select a matching API URL.`,
  );
}

export async function writeProjectLink(
  projectDir: string,
  link: Omit<ProjectLink, "version">,
): Promise<ProjectLink> {
  const directory = join(projectDir, PROJECT_LINK_DIRECTORY);
  const value: ProjectLink = {
    version: PROJECT_LINK_VERSION,
    ...link,
    controlPlane: normalizeControlPlane(link.controlPlane),
  };

  const before = await inspectProjectLinkPath(projectDir);
  if (!before.directoryExists) await Deno.mkdir(directory, { recursive: true });
  await inspectProjectLinkPath(projectDir);

  const path = projectLinkPath(projectDir);
  const temporaryPath = join(
    directory,
    `.${PROJECT_LINK_FILENAME}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await Deno.writeTextFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    await Deno.rename(temporaryPath, path);
  } catch (error) {
    try {
      await Deno.remove(temporaryPath);
    } catch (removeError) {
      if (!isNotFoundError(removeError)) throw removeError;
    }
    throw error;
  }

  return value;
}

export async function clearProjectLink(projectDir: string): Promise<void> {
  const inspected = await inspectProjectLinkPath(projectDir);
  if (inspected.linkExists) await Deno.remove(projectLinkPath(projectDir));
}
