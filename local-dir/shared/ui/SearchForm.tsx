import { Input } from "@/shared/ui/Input"
import { Search } from "https://esm.sh/lucide-react"
import { useRouter } from "@/lib/Router"
import React from "react"

export function SearchForm({ label = "Search components" }) {
  const router = useRouter()

  const onSearch = React.useCallback(
    (event) => {
      event.preventDefault()
      const search = event.target[0].value

      const url = new URL(router.path, router.domain)
      url.searchParams.delete("before")
      url.searchParams.delete("after")

      if (search) {
        url.searchParams.set("search", search)
      } else {
        url.searchParams.delete("search")
      }

      router.navigate(url.pathname + url.search, {
        scroll: true,
        replace: false,
      })
    },
    [router],
  )

  return (
    <form onSubmit={onSearch} className="max-w-sm">
      <label className="sr-only" htmlFor="search">
        {label}
      </label>
      <div className="flex w-full gap-2.5 relative">
        <Input
          name="search"
          id="search"
          defaultValue={router?.query?.search || ""}
          placeholder={label + "..."}
          className="text-sm pl-9 py-2 max-w-auto md:min-w-[320px]"
        />
        <button
          type="submit"
          className="absolute left-3 top-1/2 -translate-y-1/2"
        >
          <Search width={16} height={16} />
        </button>
      </div>
    </form>
  )
}
