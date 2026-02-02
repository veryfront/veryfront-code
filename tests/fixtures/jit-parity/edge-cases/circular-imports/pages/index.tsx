// Test circular import handling
import { ComponentA } from "./ComponentA";

export default function CircularImportsPage() {
  return (
    <div>
      <h1>Circular Imports Test</h1>
      <ComponentA />
    </div>
  );
}
