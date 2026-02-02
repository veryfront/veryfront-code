import { sharedValue } from "./shared";

export function ComponentB() {
  return <div>Component B: {sharedValue}</div>;
}
