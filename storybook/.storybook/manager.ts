import type { State } from "storybook/manager-api";
import { addons } from "storybook/manager-api";
import { vfTheme } from "./theme";

addons.setConfig({
  theme: vfTheme,
  // Hide the addon panel (Controls/Actions) for showcase / page-style stories
  // that have no args. Tag a story with `tags: ['showcase']` or `['page']` to
  // opt in. Mirrors the Veryfront Studio workbench behaviour.
  layoutCustomisations: {
    showPanel(state: State, defaultValue: boolean) {
      const tags = state.index?.[state.storyId]?.tags ?? [];
      if (tags.includes("showcase") || tags.includes("page")) {
        return false;
      }
      return defaultValue;
    },
  },
  // One top-level menu — "Chat" — expanded by default, mirroring the Studio
  // workbench where the active section's tree is open. Sub-groups (Components,
  // Composition, Primitives) collapse/expand individually.
  sidebar: {
    collapsedRoots: [],
  },
});
