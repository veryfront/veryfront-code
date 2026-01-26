export function getRequest(ctx) {
    return "req" in ctx ? ctx.req : ctx.request;
}
