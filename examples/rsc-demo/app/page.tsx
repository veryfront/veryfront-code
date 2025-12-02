"use client";

/**
 * RSC Demo Page
 *
 * Note: Full RSC support requires React Server Components runtime.
 * This demo shows client-side rendering with React 19 patterns.
 */

import { useState, useEffect } from "react";

export default function HomePage() {
  const [count, setCount] = useState(10);
  const [serverTime, setServerTime] = useState<string | null>(null);
  const [data, setData] = useState<{ message: string } | null>(null);

  useEffect(() => {
    // Simulate server-side data that would be available in RSC
    setServerTime(new Date().toISOString());
    // Simulate data fetching
    const timer = setTimeout(() => {
      setData({ message: "Hello from the server!" });
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div style={{ padding: "20px", fontFamily: "system-ui" }}>
      <h1>Veryfront RSC Demo</h1>

      <section>
        <h2>Server-like Data</h2>
        <p>In a full RSC setup, this content would be rendered on the server.</p>
        <p>Server time: {serverTime || "Loading..."}</p>
        <p>Fetched data: {data?.message || "Loading..."}</p>
      </section>

      <section>
        <h2>Interactive Component</h2>
        <p>The counter below demonstrates client-side interactivity:</p>
        <div
          style={{
            border: "2px solid #0066cc",
            padding: "15px",
            borderRadius: "8px",
            backgroundColor: "#f0f8ff",
            margin: "10px 0",
          }}
        >
          <p>This is a client component with React state.</p>
          <p>Count: {count}</p>
          <button
            type="button"
            onClick={() => setCount(count + 1)}
            style={{
              padding: "8px 16px",
              fontSize: "16px",
              backgroundColor: "#0066cc",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              marginRight: "10px",
            }}
          >
            Increment
          </button>
          <button
            type="button"
            onClick={() => setCount(count - 1)}
            style={{
              padding: "8px 16px",
              fontSize: "16px",
              backgroundColor: "#666",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Decrement
          </button>
        </div>
      </section>

      <section>
        <h2>RSC Benefits (when enabled)</h2>
        <ul>
          <li>Server components have zero client-side JavaScript</li>
          <li>Direct database/API access on the server</li>
          <li>Client components only ship interactive code</li>
          <li>Automatic code splitting at component boundaries</li>
        </ul>
      </section>
    </div>
  );
}
