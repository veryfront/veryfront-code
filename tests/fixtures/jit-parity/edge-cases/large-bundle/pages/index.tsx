// Page with many imports to test bundle size handling
import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// Generate a large component with lots of content
const ITEMS = Array.from({ length: 100 }, (_, i) => `Item ${i + 1}`);

export default function LargeBundlePage() {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const doubleCount = useMemo(() => count * 2, [count]);

  const handleClick = useCallback(() => {
    setCount((c) => c + 1);
  }, []);

  useEffect(() => {
    console.log("Component mounted");
    return () => console.log("Component unmounted");
  }, []);

  return (
    <div ref={ref} className="large-bundle-page">
      <h1>Large Bundle Test</h1>
      <p>Count: {count}</p>
      <p>Double: {doubleCount}</p>
      <button onClick={handleClick}>Increment</button>
      <ul>
        {ITEMS.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
