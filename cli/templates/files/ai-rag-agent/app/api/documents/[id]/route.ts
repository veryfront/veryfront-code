import { createDocumentHandler } from "veryfront/embedding";
import { store } from "../../../../store.ts";

export const { DELETE } = createDocumentHandler(store);
