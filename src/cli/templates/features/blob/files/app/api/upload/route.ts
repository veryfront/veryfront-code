import { listBlobs, uploadBlob } from "../../../lib/storage.ts";

export async function GET() {
  const blobs = await listBlobs();
  return Response.json({ files: blobs });
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";

    // Handle multipart form data
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return Response.json({ error: "No file provided" }, { status: 400 });
      }

      const buffer = await file.arrayBuffer();
      const ref = await uploadBlob(buffer, {
        filename: file.name,
        mimeType: file.type,
      });

      return Response.json({
        success: true,
        file: ref,
      });
    }

    // Handle raw binary upload
    const buffer = await req.arrayBuffer();
    const filename = req.headers.get("x-filename") || undefined;
    const mimeType = contentType || undefined;

    const ref = await uploadBlob(buffer, { filename, mimeType });

    return Response.json({
      success: true,
      file: ref,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return Response.json({ error: "Failed to upload file" }, { status: 500 });
  }
}
