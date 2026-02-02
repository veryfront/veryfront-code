import { createContext, useContext, type ReactNode } from "react";

// Create a theme context for testing provider propagation
const ThemeContext = createContext({ theme: "light" });

export function useTheme() {
  return useContext(ThemeContext);
}

export default function ProvidersLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeContext.Provider value={{ theme: "dark" }}>
      <div className="providers-layout" data-theme="dark">
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
