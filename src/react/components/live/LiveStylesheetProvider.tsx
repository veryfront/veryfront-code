import type React from "react";
import { useEffect } from "react";
import { useLiveData } from "./LiveDataProvider.tsx";

export function LiveStylesheetProvider({ children }: { children: React.ReactNode }) {
  const { data } = useLiveData();

  useEffect(() => {
    data.styles.forEach((css, id) => {
      let styleEl = document.getElementById(`vf-style-${id}`) as HTMLStyleElement;

      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = `vf-style-${id}`;
        styleEl.setAttribute("data-vf-style", id);
        document.head.appendChild(styleEl);
      }

      styleEl.textContent = css;
    });

    const existingStyles = document.querySelectorAll("[data-vf-style]");
    existingStyles.forEach((el) => {
      const id = el.getAttribute("data-vf-style");
      if (id && !data.styles.has(id)) {
        el.remove();
      }
    });
  }, [data.styles]);

  return <>{children}</>;
}
