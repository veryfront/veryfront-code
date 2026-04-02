import { useState } from "react";

export default function BenchInteractivePage() {
  const [count, setCount] = useState(0);

  return (
    <main id="bench-interactive-page">
      <h1>Next.js interactive benchmark page</h1>
      <button
        id="bench-interactive-button"
        type="button"
        onClick={() => setCount((value) => value + 1)}
      >
        Interactions: {count}
      </button>
    </main>
  );
}
