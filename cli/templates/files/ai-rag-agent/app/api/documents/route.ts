import { createDocumentHandler } from "veryfront/embedding";
import { store } from "../../../store.ts";

export const { POST, GET } = createDocumentHandler(store);
