import { isConfigured, setSupabaseConfig } from "../../../../lib/token-store.ts";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url, anonKey, serviceKey } = body;

    if (!url || !anonKey || !serviceKey) {
      return Response.json(
        { error: "Missing required fields: url, anonKey, serviceKey" },
        { status: 400 },
      );
    }

    try {
      new URL(url);
    } catch {
      return Response.json(
        { error: "Invalid Supabase URL format" },
        { status: 400 },
      );
    }

    setSupabaseConfig({
      url,
      anonKey,
      serviceKey,
    });

    return Response.json({
      success: true,
      message: "Supabase configuration saved successfully",
    });
  } catch (error) {
    console.error("Supabase config error:", error);
    return Response.json(
      { error: "Failed to configure Supabase" },
      { status: 500 },
    );
  }
}

export function GET() {
  try {
    const configured = isConfigured();

    return Response.json({
      configured,
      message: configured ? "Supabase is configured" : "Supabase is not configured",
    });
  } catch (error) {
    console.error("Supabase status check error:", error);
    return Response.json(
      { error: "Failed to check Supabase status" },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    const { clearConfig } = await import("../../../../lib/token-store.ts");
    clearConfig();

    return Response.json({
      success: true,
      message: "Supabase configuration cleared",
    });
  } catch (error) {
    console.error("Supabase clear config error:", error);
    return Response.json(
      { error: "Failed to clear Supabase configuration" },
      { status: 500 },
    );
  }
}
