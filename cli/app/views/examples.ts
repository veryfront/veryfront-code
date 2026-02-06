/**
 * Examples View
 *
 * Renders the example selection screen.
 */

import { brand, dim } from "../../ui/colors.ts";
import type { AppState } from "../state.ts";

export function renderExamplesView(state: AppState): string {
  const lines = [
    "",
    `  ${brand("Examples")}`,
    "",
    `  ${dim("Create a new project from an example:")}`,
    "",
  ];

  state.examples.items.forEach((item, i) => {
    const selected = i === state.examples.selectedIndex;
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
