import { create } from "storybook/theming/create";

// 1:1 copy of the Veryfront Studio Storybook manager theme. The ONLY deviation
// is the font stack: Studio's Söhne is a licensed typeface that this repo's
// boundary test (scripts/storybook/storybook-workbench.test.ts) forbids, so we
// use the Inter stack instead. Every colour/radius value matches Studio.
export const vfTheme = create({
  base: "light",

  // Brand
  brandTitle: "Veryfront Design System",
  brandImage: "/logo.svg",
  brandUrl: "/",
  brandTarget: "_self",

  // Typography (Söhne -> Inter; see note above)
  fontBase: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
  fontCode: "ui-monospace, SFMono-Regular, Menlo, monospace",

  // Colours
  colorPrimary: "#0a0a0a",
  colorSecondary: "#4a4a4a",

  // UI
  appBg: "#f5f4f0",
  appContentBg: "#fafaf9",
  appBorderColor: "rgba(0,0,0,0.06)",
  appBorderRadius: 4,

  // Text
  textColor: "#0f0f0f",
  textMutedColor: "rgba(0,0,0,0.4)",
  textInverseColor: "#fafaf9",

  // Toolbar
  barBg: "#fafaf9",
  barTextColor: "rgba(0,0,0,0.4)",
  barSelectedColor: "#0a0a0a",
  barHoverColor: "#0a0a0a",

  // Inputs
  inputBg: "#fefefe",
  inputBorder: "rgba(0,0,0,0.1)",
  inputTextColor: "#0f0f0f",
  inputBorderRadius: 4,

  // Booleans
  booleanBg: "#f5f4f0",
  booleanSelectedBg: "#0a0a0a",

  // Button
  buttonBg: "#f5f4f0",
  buttonBorder: "rgba(0,0,0,0.1)",
});
