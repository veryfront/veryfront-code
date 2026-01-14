import { useMutation } from "https://esm.sh/@tanstack/react-query@5.28.4"

const CREATE_PROJECT_MUTATION = `
  mutation CreateProjectMutation($input: CreateProjectInput!) {
    createProject(input: $input) {
      project {
        id
        slug
        name
      }
    }
  }
`

type MutationErrorResponse = any
type MutationPayload = { createProject: any }
type MutationInput = any

export type HookOptions = {
  onSuccess?: (data: MutationPayload) => void
  onError?: (error: MutationErrorResponse) => void
}

export function useCreateProjectMutation({
  onSuccess,
  onError,
}: HookOptions = {}) {
  return useMutation<MutationPayload, MutationErrorResponse, MutationInput>({
    mutationFn: async (input) => {
      const response = await fetch("https://api.veryfront.com/graphql", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: CREATE_PROJECT_MUTATION,
          variables: { input },
        }),
      })

      const result = await response.json()

      if (result.errors) {
        throw result.errors
      }

      return result.data
    },

    async onSuccess({ createProject }) {
      const project = createProject?.project

      if (!project) {
        return
      }

      onSuccess?.({ createProject })
    },
    onError,
  })
}
