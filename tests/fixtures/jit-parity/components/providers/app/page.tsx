"use client";

import { useTheme } from "./layout";

export default function ProvidersPage() {
  const { theme } = useTheme();

  return (
    <div className="providers-page">
      <h1>Context Providers Test</h1>
      <p>Current theme: {theme}</p>
    </div>
  );
}
