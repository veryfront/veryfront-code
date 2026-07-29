import "../../_helpers/contract-init.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { type DataContext, DataFetcher, type PageWithData } from "#veryfront/data/index.ts";

describe("DataFetcher LRU/TTL basic behavior", () => {
  it("caches and clears data correctly", async () => {
    const fetcher = new DataFetcher();
    const baseUrl = new URL("http://localhost/products/1");
    const options = {
      modulePath: "/project/pages/products/[id].tsx",
      cacheScope: {
        projectId: "test-project",
        mode: "production",
        versionId: "rel_fetching_cache",
      },
    } as const;
    let calls = 0;

    const pageModule: PageWithData<{ id: string; call: number }> = {
      default: null,
      getStaticData: ({ params }) => {
        calls++;
        const id = params.id;
        return {
          props: {
            id: Array.isArray(id) ? id.join("/") : id ?? "",
            call: calls,
          },
          revalidate: 1,
        };
      },
    };

    function makeCtx(id: string): DataContext {
      return {
        params: { id },
        url: new URL(`http://localhost/products/${id}`),
        request: new Request(baseUrl),
        query: new URLSearchParams(),
      };
    }

    const r1 = await fetcher.fetchData(pageModule, makeCtx("1"), "production", options);
    assertEquals(r1.props?.id, "1");
    assertEquals(r1.props?.call, 1);

    const r2 = await fetcher.fetchData(pageModule, makeCtx("1"), "production", options);
    assertEquals(r2.props?.id, "1");
    assertEquals(r2.props?.call, 1);

    const r3 = await fetcher.fetchData(pageModule, makeCtx("2"), "production", options);
    assertEquals(r3.props?.id, "2");
    assertEquals(r3.props?.call, 2);

    fetcher.clearCache("/products/1");
    const r4 = await fetcher.fetchData(pageModule, makeCtx("1"), "production", options);
    assertEquals(r4.props?.id, "1");
    assertEquals(r4.props?.call, 3);
    assertEquals(calls, 3);
  });
});
