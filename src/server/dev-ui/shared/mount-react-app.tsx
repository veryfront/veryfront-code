import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

export function mountReactApp(app: ReactNode): void {
  const root = document.getElementById("root");

  if (!root) {
    throw new Error('Root element with id "root" not found');
  }

  createRoot(root).render(app);
}
