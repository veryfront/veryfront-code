"use client";

import { useState } from "react";

interface ClientCounterProps {
  initialCount: number;
}

export default function ClientCounter({ initialCount }: ClientCounterProps) {
  const [count, setCount] = useState(initialCount);

  return (
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
  );
}
