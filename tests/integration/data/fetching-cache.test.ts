import { assertEquals } from "@std/assert";
import { DataFetcher } from "@veryfront/data/index.ts";

Deno.test(
  {
    name: "DataFetcher LRU/TTL basic behavior",
    permissions: { env: true },
    sanitizeResources: false, // DataFetcher cache has cleanup interval
    sanitizeOps: false,
  },
  async () => {
    const fetcher = new DataFetcher();
    const baseUrl = new URL("http://localhost/products/1");
    const pageModule: any = {
      getStaticData: ({ params }: any) => ({
        props: { id: params.id },
        revalidate: 1,
      }),
    };

    const makeCtx = (id: string) =>
      ({
        params: { id },
        url: new URL(`http://localhost/products/${id}`),
        request: new Request(baseUrl),
        query: new URLSearchParams(),
      }) as any;

    // First fetch caches
    const r1 = await fetcher.fetchData(pageModule, makeCtx("1"), "production");
    assertEquals((r1.props as any).id, "1");

    // Immediate second fetch returns cached
    const r2 = await fetcher.fetchData(pageModule, makeCtx("1"), "production");
    assertEquals((r2.props as any).id, "1");

    // Different key stored too
    const r3 = await fetcher.fetchData(pageModule, makeCtx("2"), "production");
    assertEquals((r3.props as any).id, "2");

    // Clear by pattern
    fetcher.clearCache("/products/1");
    const r4 = await fetcher.fetchData(pageModule, makeCtx("1"), "production");
    assertEquals((r4.props as any).id, "1");
  },
);
