import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RENDER_ERROR } from "#veryfront/errors";

export function mountReactApp(app: ReactNode): void {
  const root = document.getElementById("root");

  if (!root) {
    throw RENDER_ERROR.create({ detail: 'Root element with id "root" not found' });
  }

  createRoot(root).render(app);
}
