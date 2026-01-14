import { useMutation } from "https://esm.sh/@tanstack/react-query@5.28.4"

const CREATE_FILE_UPLOAD_URL_MUTATION = `
  mutation CreateFileUploadUrlMutation($input: CreateFileUploadUrlInput!) {
    createFileUploadUrl(input: $input) {
      fileUploadUrl
    }
  }
`

type MutationErrorResponse = any
type MutationPayload = { createFileUploadUrl: any }
type MutationInput = any

export type HookOptions = {
  onSuccess?: (data: MutationPayload) => void
  onError?: (data: MutationErrorResponse) => void
}

export function useCreateFileUploadUrlMutation({
  onSuccess,
  onError,
}: HookOptions = {}) {
  return useMutation<MutationPayload, MutationErrorResponse, MutationInput>({
    mutationFn: async ({ projectId, ...input }) => {
      if (!projectId) {
        throw new Error(
          "projectId is required in useCreateFileUploadUrlMutation",
        )
      }

      const response = await fetch("https://api.veryfront.com/graphql", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-project": projectId,
        },
        body: JSON.stringify({
          query: CREATE_FILE_UPLOAD_URL_MUTATION,
          variables: { input },
        }),
      })

      const result = await response.json()

      if (result.errors) {
        throw result.errors
      }

      return result.data
    },
    onSuccess,
    onError,
  })
}
