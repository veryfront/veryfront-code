import { createUploadHandler } from "veryfront/embedding";
import { store } from "../../../store.ts";

export const { POST, GET, DELETE } = createUploadHandler(store, {
  auth: { type: "none", allowUnauthenticated: true },
});
