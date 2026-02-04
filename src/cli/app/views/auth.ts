/**
 * Auth View
 *
 * Renders the authentication provider selection screen.
 */

import { brand, dim } from "../../ui/colors.ts";
import type { AppState } from "../state.ts";

export function renderAuthView(state: AppState): string {
  const providers = ["Google", "GitHub", "Microsoft"];
  const lines = [
    "",
    `  ${brand("Login to Veryfront")}`,
    "",
    `  ${dim("Choose authentication provider:")}`,
    "",
  ];

  providers.forEach((p, i) => {
    const isFocused = i === state.authProviderIndex;
    const cursorChar = isFocused ? brand("›") : " ";
    const num = isFocused ? brand(`[${i + 1}]`) : dim(`[${i + 1}]`);
    const label = isFocused ? p : dim(p);
    lines.push(`${cursorChar} ${num} ${label}`);
  });

  lines.push("", `  ${dim("↑↓ nav  enter select  esc back")}`, "");
  return lines.join("\n");
}
