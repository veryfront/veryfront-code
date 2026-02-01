import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { DataFetcher } from "#veryfront/data/index.ts";

describe("DataFetcher LRU/TTL basic behavior", () => {
  it("caches and clears data correctly", async () => {
    const fetcher = new DataFetcher();
    const baseUrl = new URL("http://localhost/products/1");

    const pageModule = {
      getStaticData: ({ params }: { params: { id: string } }) => ({
        props: { id: params.id },
        revalidate: 1,
      }),
    };

    function makeCtx(id: string): any {
      return {
        params: { id },
        url: new URL(`http://localhost/products/${id}`),
        request: new Request(baseUrl),
        query: new URLSearchParams(),
      };
    }

    const r1 = await fetcher.fetchData(pageModule as any, makeCtx("1"), "production");
    assertEquals(r1.props.id, "1");

    const r2 = await fetcher.fetchData(pageModule as any, makeCtx("1"), "production");
    assertEquals(r2.props.id, "1");

    const r3 = await fetcher.fetchData(pageModule as any, makeCtx("2"), "production");
    assertEquals(r3.props.id, "2");

    fetcher.clearCache("/products/1");
    const r4 = await fetcher.fetchData(pageModule as any, makeCtx("1"), "production");
    assertEquals(r4.props.id, "1");
  });
});
