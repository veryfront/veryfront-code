type PagesContext = {
  text(data: string, init?: ResponseInit): Response;
};

export function GET(ctx: PagesContext): Response {
  return ctx.text("ignored", { status: 204 });
}
