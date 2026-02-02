import { sharedValue } from "./shared";

export function ComponentA() {
  return <div>Component A: {sharedValue}</div>;
}
