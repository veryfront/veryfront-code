import { deleteBlob, getBlob, getBlobRef } from "../../../../lib/storage.ts";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ref = await getBlobRef(params.id);

  if (!ref) {
    return Response.json({ error: "File not found" }, { status: 404 });
  }

  const data = await getBlob(params.id);

  if (!data) {
    return Response.json({ error: "File data not found" }, { status: 404 });
  }

  return new Response(data, {
    headers: {
      "Content-Type": ref.mimeType,
      "Content-Disposition": `inline; filename="${ref.filename}"`,
      "Content-Length": String(ref.size),
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const deleted = await deleteBlob(params.id);

  if (!deleted) {
    return Response.json({ error: "File not found" }, { status: 404 });
  }

  return Response.json({ success: true });
}
