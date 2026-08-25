import { store } from "../../../store.ts";

export async function POST() {
  await store.indexContentDir();
  return Response.json({ ok: true });
}
