import { ragStore } from "veryfront/embedding";

export const store = ragStore({
  storagePath: "data/index.json",
  contentDir: "content",
  cloudModel: "veryfront-cloud/google/gemini-embedding-001",
});
