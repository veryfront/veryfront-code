const THEME_VARIABLES = `:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --muted: 210 40% 96.1%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --primary: 222.2 47.4% 11.2%;
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96.1%;
  --secondary-foreground: 222.2 47.4% 11.2%;
  --highlight: 210 100% 50%;
  --highlight-foreground: 210 40% 98%;
  --card: 0 0% 100%;
  --card-foreground: 222.2 84% 4.9%;
  --panel: 0 0% 100%;
  --panel-foreground: 222.2 84% 4.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 222.2 84% 4.9%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 210 40% 98%;
  --border: 214.3 31.8% 91.4%;
  --divider: 214.3 31.8% 91.4%;
  --input: 214.3 31.8% 91.4%;
  --input-foreground: 222.2 84% 4.9%;
  --input-border: 214.3 31.8% 91.4%;
  --input-placeholder: 215.4 16.3% 46.9%;
  --ring: 222.2 84% 4.9%;
  --success: 142.1 76.2% 36.3%;
  --code-block: 220 13% 18%;
  --radius: 0.5rem;
}

[data-theme="dark"] {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  --muted: 217.2 32.6% 17.5%;
  --muted-foreground: 215 20.2% 65.1%;
  --primary: 210 40% 98%;
  --primary-foreground: 222.2 47.4% 11.2%;
  --secondary: 217.2 32.6% 17.5%;
  --secondary-foreground: 210 40% 98%;
  --highlight: 210 100% 50%;
  --highlight-foreground: 210 40% 98%;
  --card: 222.2 84% 4.9%;
  --card-foreground: 210 40% 98%;
  --panel: 217.2 32.6% 17.5%;
  --panel-foreground: 210 40% 98%;
  --popover: 222.2 84% 4.9%;
  --popover-foreground: 210 40% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 210 40% 98%;
  --border: 217.2 32.6% 17.5%;
  --divider: 217.2 32.6% 17.5%;
  --input: 217.2 32.6% 17.5%;
  --input-foreground: 210 40% 98%;
  --input-border: 217.2 32.6% 17.5%;
  --input-placeholder: 215 20.2% 65.1%;
  --ring: 212.7 26.8% 83.9%;
  --success: 142.1 70.6% 45.3%;
  --code-block: 220 13% 18%;
}

/* Base styles for vf-tailwind container */
.vf-tailwind,
.vf-tailwind * {
  margin: 0;
  line-height: 1.5;
  -webkit-text-size-adjust: 100%;
  -moz-tab-size: 4;
  -o-tab-size: 4;
  tab-size: 4;
  font-feature-settings: normal;
  font-variation-settings: normal;
  -webkit-tap-highlight-color: transparent;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji" !important;
}
`;

export function generateThemeVariables(): string {
  return THEME_VARIABLES;
}
