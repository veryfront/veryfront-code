// Shared module that could create circular dependencies
export const sharedValue = "shared";

// Re-export to create potential circular reference (safe version)
export { ComponentA } from "./ComponentA";
export { ComponentB } from "./ComponentB";
