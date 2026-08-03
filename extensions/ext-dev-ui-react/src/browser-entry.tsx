/** Browser entry used only to generate the extension-owned Dev UI bundle. */

import { DEV_UI_KIND_ATTRIBUTE } from "veryfront/extensions/dev-ui/protocol";
import { App as DashboardApp } from "./dashboard/App.tsx";
import { DEV_UI_STYLES, DEV_UI_STYLES_SHA256 } from "./dev-ui-styles.generated.ts";
import { mountReactApp } from "./mount-react-app.tsx";
import { App as ProjectsApp } from "./projects/App.tsx";

const STYLE_IDENTITY_ATTRIBUTE = "data-veryfront-dev-ui-styles";

function installStyles(): void {
  const existing = document.head.querySelector<HTMLStyleElement>(
    `style[${STYLE_IDENTITY_ATTRIBUTE}]`,
  );
  if (existing !== null) {
    if (
      existing.getAttribute(STYLE_IDENTITY_ATTRIBUTE) !==
        DEV_UI_STYLES_SHA256 ||
      existing.textContent !== DEV_UI_STYLES
    ) {
      throw new Error("Conflicting Veryfront Dev UI stylesheet detected");
    }
    return;
  }

  const style = document.createElement("style");
  style.setAttribute(STYLE_IDENTITY_ATTRIBUTE, DEV_UI_STYLES_SHA256);
  style.textContent = DEV_UI_STYLES;
  document.head.append(style);
}

const kind = document.documentElement.getAttribute(DEV_UI_KIND_ATTRIBUTE);
if (kind !== "dashboard" && kind !== "projects") {
  throw new Error("Veryfront Dev UI shell kind is missing or invalid");
}

installStyles();
if (kind === "dashboard") {
  mountReactApp(<DashboardApp />);
} else {
  mountReactApp(<ProjectsApp />);
}
