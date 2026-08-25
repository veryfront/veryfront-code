/**
 * App Utilities
 *
 * Helper functions for project creation and management.
 */

import type { AppState } from "./state.ts";
import { ADJECTIVES, NOUNS } from "./data/slug-words.ts";

export function generateRandomSlug(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}`;
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
