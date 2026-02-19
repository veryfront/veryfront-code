/**
 * New Project View
 *
 * Renders the new project type selection screen.
 */

import { brand, dim } from "../../ui/colors.ts";
import type { AppState } from "../state.ts";

export function renderNewProjectView(state: AppState): string {
  const options = [
    { label: "From template", desc: "Start with a pre-built template" },
    { label: "From scratch", desc: "Empty project" },
  ];

  const lines = [
    "",
    `  ${brand("New Project")}`,
    "",
    `  ${dim("Choose how to start:")}`,
    "",
  ];

  options.forEach((opt, i) => {
    const isFocused = i === state.newProjectIndex;
    const cursorChar = isFocused ? brand("›") : " ";
    const num = isFocused ? brand(`[${i + 1}]`) : dim(`[${i + 1}]`);
    const label = isFocused ? opt.label : dim(opt.label);
    const desc = dim(opt.desc);
    lines.push(`  ${cursorChar} ${num} ${label}  ${desc}`);
  });

  lines.push("", `  ${dim("↑↓ nav  enter select  esc back")}`, "");

  return lines.join("\n");
}
