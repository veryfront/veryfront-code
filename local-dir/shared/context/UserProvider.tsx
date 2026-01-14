import { useQuery } from "@tanstack/react-query"
import { createContext, useContext } from "react"

export const currentUserQuery = `
query CurrentUserQuery {
  currentUser {
    id
  }
}
`

export const UserContext = createContext({
  id: null,
})

export function useUserContext() {
  return useContext(UserContext)
}

export function UserProvider({ children }) {
  const { data } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      const response = await fetch("https://api.veryfront.com/graphql", {
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
        body: JSON.stringify({
          query: currentUserQuery,
        }),
      })
      const { data } = await response.json()
      return data?.currentUser
    },
  })

  return <UserContext.Provider value={data}>{children}</UserContext.Provider>
}
