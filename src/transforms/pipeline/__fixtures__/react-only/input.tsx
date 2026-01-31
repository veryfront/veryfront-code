import { useState } from "react";

export default function Counter(): JSX.Element {
  const [count, setCount] = useState(0);

  function increment(): void {
    setCount((prev) => prev + 1);
  }

  return (
    <div>
      <p>Count: {count}</p>
      <button type="button" onClick={increment}>
        Increment
      </button>
    </div>
  );
}
