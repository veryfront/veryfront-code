import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const root = document.getElementById("root");

if (!root) {
  throw new Error('Root element with id "root" not found');
}

createRoot(root).render(<App />);
