/**
 * App Utilities
 *
 * Helper functions for project creation and management.
 */

import { cwd } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { readToken } from "../auth/token-store.ts";
import { pullCommand } from "../commands/pull/index.ts";
import { addLog, type AppState, type StateUpdater } from "./state.ts";
import { ADJECTIVES, NOUNS } from "./data/slug-words.ts";

export function generateRandomSlug(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}`;
}

export function normalizeSlug(projectName: string): string {
  return projectName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

export function getLocalProjectsFromState(
  appState: AppState,
): Array<{ slug: string; path: string }> {
  const result: Array<{ slug: string; path: string }> = [];
  for (const item of appState.projects.items) {
    if (item.data) {
      result.push({ slug: item.data.slug, path: item.data.path });
    }
  }
  return result;
}

export async function pullRemoteProject(
  update: (updater: StateUpdater) => void,
  render: () => void,
  focusedSlug: string,
): Promise<void> {
  const token = await readToken();
  if (!token) {
    update(addLog("error", "Not authenticated. Press 'a' to login."));
    render();
    return;
  }

  const projectDir = join(cwd(), "projects", focusedSlug);
  update(addLog("info", `Pulling to projects/${focusedSlug}/...`));
  render();

  try {
    await pullCommand({
      projectSlug: focusedSlug,
      projectDir,
      force: true,
      quiet: true,
    });
    update(addLog("info", `Pulled to projects/${focusedSlug}/`));
  } catch (err) {
    update(addLog("error", `Pull failed: ${err instanceof Error ? err.message : String(err)}`));
  }

  render();
}
