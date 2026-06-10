import { createUploadHandler } from "veryfront/embedding";
import { store } from "../../../../store.ts";

export const { DELETE } = createUploadHandler(store, {
  auth: { type: "none", allowUnauthenticated: true },
});
