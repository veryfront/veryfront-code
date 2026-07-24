import { store } from "../../../store";

export async function POST() {
  await store.indexContentDir();
  return Response.json({ ok: true });
}
