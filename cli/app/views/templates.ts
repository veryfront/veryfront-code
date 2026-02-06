/**
 * Templates View
 *
 * Renders the template selection screen.
 */

import { brand, dim } from "../../ui/colors.ts";
import type { AppState } from "../state.ts";

export function renderTemplatesView(state: AppState): string {
  const lines = [
    "",
    `  ${brand("Templates")}`,
    "",
    `  ${dim("Create a new project from a template:")}`,
    "",
  ];

  state.templates.items.forEach((item, i) => {
    const selected = i === state.templates.selectedIndex;
    const prefix = selected ? brand("›") : " ";
    const label = selected ? brand(item.label) : item.label;
    lines.push(`  ${prefix} ${label}  ${dim(item.description || "")}`);
  });

  lines.push("");
  lines.push(
    `  ${dim("Press")} ${brand("Enter")} ${dim("to create  •")} ${brand("Esc")} ${
      dim("to go back")
    }`,
  );
  lines.push("");

  return lines.join("\n");
}
