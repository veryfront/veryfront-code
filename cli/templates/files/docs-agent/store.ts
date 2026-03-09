import { ragStore } from "veryfront/embedding";

export const store = ragStore({
  storagePath: "data/index.json",
  contentDir: "content",
});
