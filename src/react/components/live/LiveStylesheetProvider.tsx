import type React from "react";
import { useEffect } from "react";
import { useLiveData } from "./LiveDataProvider.tsx";

export function LiveStylesheetProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  const { data } = useLiveData();

  useEffect(() => {
    data.styles.forEach((css, id) => {
      const elementId = `vf-style-${id}`;
      let styleEl = document.getElementById(elementId) as HTMLStyleElement | null;

      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = elementId;
        styleEl.setAttribute("data-vf-style", id);
        document.head.appendChild(styleEl);
      }

      styleEl.textContent = css;
    });

    document.querySelectorAll("[data-vf-style]").forEach((el) => {
      const id = el.getAttribute("data-vf-style");
      if (!id || data.styles.has(id)) return;
      el.remove();
    });
  }, [data.styles]);

  return <>{children}</>;
}
