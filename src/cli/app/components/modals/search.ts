/**
 * Search Modal Component
 *
 * Fuzzy search interface for files, routes, commands, and more.
 * Triggered by Ctrl+P or '/' in NORMAL mode.
 */

import { box } from "../../../ui/box.ts";
import { brand, dim, muted } from "../../../ui/colors.ts";
import { truncate, visibleLength } from "../../../ui/layout.ts";
import type { SearchResult, SearchResultType, SearchState } from "../../core/types.ts";
import { fuzzyScore } from "../../core/commands.ts";

// ============================================================================
// State Management
// ============================================================================

export type SearchUpdater = (state: SearchState) => SearchState;

/**
 * Open search modal
 */
export function openSearch(): SearchUpdater {
  return () => ({
    open: true,
    query: "",
    selectedIndex: 0,
    results: [],
    loading: false,
  });
}

/**
 * Close search modal
 */
export function closeSearch(): SearchUpdater {
  return () => ({
    open: false,
    query: "",
    selectedIndex: 0,
    results: [],
    loading: false,
  });
}

/**
 * Update query
 */
export function updateSearchQuery(query: string): SearchUpdater {
  return (state) => ({
    ...state,
    query,
    selectedIndex: 0,
    loading: query.length > 0,
  });
}

/**
 * Set search results
 */
export function setSearchResults(results: SearchResult[]): SearchUpdater {
  return (state) => ({
    ...state,
    results,
    selectedIndex: 0,
    loading: false,
  });
}

/**
 * Move selection up
 */
export function moveSearchUp(): SearchUpdater {
  return (state) => {
    if (state.results.length === 0) return state;
    const newIndex = state.selectedIndex > 0 ? state.selectedIndex - 1 : state.results.length - 1;
    return { ...state, selectedIndex: newIndex };
  };
}

/**
 * Move selection down
 */
export function moveSearchDown(): SearchUpdater {
  return (state) => {
    if (state.results.length === 0) return state;
    const newIndex = state.selectedIndex < state.results.length - 1 ? state.selectedIndex + 1 : 0;
    return { ...state, selectedIndex: newIndex };
  };
}

/**
 * Get selected result
 */
export function getSelectedResult(state: SearchState): SearchResult | null {
  return state.results[state.selectedIndex] ?? null;
}

// ============================================================================
// Search Implementation
// ============================================================================

/** Search source interface */
export interface SearchSource {
  type: SearchResultType;
  items: Array<{ id: string; label: string; description?: string; path?: string }>;
}

/**
 * Search across multiple sources
 */
export function searchSources(query: string, sources: SearchSource[]): SearchResult[] {
  if (!query.trim()) return [];

  const results: SearchResult[] = [];

  for (const source of sources) {
    for (const item of source.items) {
      const labelMatch = fuzzyScore(query, item.label);
      const pathMatch = item.path ? fuzzyScore(query, item.path) : { score: 0, matches: [] };

      const score = Math.max(labelMatch.score, pathMatch.score);

      if (score > 0) {
        results.push({
          type: source.type,
          id: item.id,
          label: item.label,
          description: item.description,
          path: item.path,
          score,
          matches: labelMatch.score >= pathMatch.score ? labelMatch.matches : pathMatch.matches,
        });
      }
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, 20);
}

// ============================================================================
// Rendering
// ============================================================================

const MAX_VISIBLE_RESULTS = 10;

/** Icon for result type */
function getTypeIcon(type: SearchResultType): string {
  switch (type) {
    case "file":
      return "📄";
    case "route":
      return "🔗";
    case "command":
      return "⌘";
    case "agent":
      return "🤖";
    case "tool":
      return "🔧";
    default:
      return "•";
  }
}

/** Label for result type */
function getTypeLabel(type: SearchResultType): string {
  switch (type) {
    case "file":
      return "Files";
    case "route":
      return "Routes";
    case "command":
      return "Commands";
    case "agent":
      return "Agents";
    case "tool":
      return "Tools";
    default:
      return "";
  }
}

/**
 * Render search modal
 */
export function renderSearch(state: SearchState, width = 60): string {
  if (!state.open) return "";

  const lines: string[] = [];

  // Input line
  const inputPrefix = "> ";
  const cursor = brand("_");
  const inputLine = `${inputPrefix}${state.query}${cursor}`;
  lines.push(inputLine);

  // Divider
  lines.push(dim("─".repeat(width - 4)));

  if (state.loading) {
    lines.push(dim("  Searching..."));
  } else if (state.results.length === 0) {
    if (state.query) {
      lines.push(dim("  No results found"));
    } else {
      lines.push(dim("  Type to search files, routes, commands..."));
    }
  } else {
    // Group by type
    const grouped = new Map<SearchResultType, SearchResult[]>();
    for (const result of state.results) {
      const group = grouped.get(result.type) ?? [];
      group.push(result);
      grouped.set(result.type, group);
    }

    // Render results
    let globalIndex = 0;
    const flatResults: SearchResult[] = [];

    for (const [type, typeResults] of grouped) {
      // Category header
      lines.push(dim(getTypeLabel(type)));

      for (const result of typeResults.slice(0, 5)) {
        flatResults.push(result);
        const isSelected = globalIndex === state.selectedIndex;
        const icon = getTypeIcon(type);
        const indicator = isSelected ? brand("›") : " ";

        const label = isSelected ? result.label : dim(result.label);
        const path = result.path ? dim(truncate(result.path, width - 35)) : "";

        lines.push(`${indicator} ${icon} ${label}${path ? "  " + path : ""}`);
        globalIndex++;

        if (globalIndex >= MAX_VISIBLE_RESULTS) break;
      }

      if (globalIndex >= MAX_VISIBLE_RESULTS) break;
    }
  }

  // Divider
  lines.push(dim("─".repeat(width - 4)));

  // Help line
  lines.push(muted("↑↓ select  Enter open  Esc close"));

  const content = lines.join("\n");

  return box(content, {
    style: "rounded",
    width,
    padding: 1,
  });
}

/**
 * Render search modal centered
 */
export function renderSearchCentered(
  state: SearchState,
  termWidth: number,
  termHeight: number,
): string {
  if (!state.open) return "";

  const searchWidth = Math.min(60, termWidth - 4);
  const content = renderSearch(state, searchWidth);
  const contentLines = content.split("\n");
  const _contentHeight = contentLines.length;
  const contentWidth = Math.max(...contentLines.map(visibleLength));

  const topPadding = Math.max(2, Math.floor(termHeight * 0.15));
  const leftPadding = Math.max(0, Math.floor((termWidth - contentWidth) / 2));

  const output: string[] = [];

  for (let i = 0; i < topPadding; i++) {
    output.push("");
  }

  const padStr = " ".repeat(leftPadding);
  for (const line of contentLines) {
    output.push(padStr + line);
  }

  return output.join("\n");
}

// ============================================================================
// Key Handling
// ============================================================================

/** Result from handling key */
export interface SearchKeyResult {
  handled: boolean;
  close: boolean;
  selectResult?: SearchResult;
  updater?: SearchUpdater;
}

/**
 * Handle key press in search modal
 */
export function handleSearchKey(key: string, state: SearchState): SearchKeyResult {
  if (!state.open) {
    return { handled: false, close: false };
  }

  // Escape - close
  if (key === "\x1b") {
    return { handled: true, close: true, updater: closeSearch() };
  }

  // Enter - select
  if (key === "\r" || key === "\n") {
    const result = getSelectedResult(state);
    if (result) {
      return {
        handled: true,
        close: true,
        selectResult: result,
        updater: closeSearch(),
      };
    }
    return { handled: true, close: false };
  }

  // Up arrow
  if (key === "\x1b[A" || key === "\x10") {
    return { handled: true, close: false, updater: moveSearchUp() };
  }

  // Down arrow
  if (key === "\x1b[B" || key === "\x0e") {
    return { handled: true, close: false, updater: moveSearchDown() };
  }

  // Backspace
  if (key === "\x7f" || key === "\b") {
    if (state.query.length > 0) {
      const newQuery = state.query.slice(0, -1);
      return { handled: true, close: false, updater: updateSearchQuery(newQuery) };
    }
    return { handled: true, close: false };
  }

  // Ctrl+U - clear
  if (key === "\x15") {
    return { handled: true, close: false, updater: updateSearchQuery("") };
  }

  // Regular character input
  if (key.length === 1 && key >= " " && key <= "~") {
    const newQuery = state.query + key;
    return { handled: true, close: false, updater: updateSearchQuery(newQuery) };
  }

  return { handled: true, close: false };
}
