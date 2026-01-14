import { useQueryClient } from "https://esm.sh/@tanstack/react-query@5.28.4"
import axios from "https://esm.sh/axios"
import path from "https://esm.sh/path-browserify"
import React from "react"
import {
  ErrorCode,
  type FileRejection,
} from "https://esm.sh/react-dropzone-esm"
import { useCreateFileUploadUrlMutation } from "@/shared/hooks/useCreateFileUploadUrlMutation"

interface UploadImageOptions {
  url: string
  file: File
  onSuccess?: (file: File) => void
  onError?: (error: any) => void
  onUploadProgress?: (p: number, filePath?: string) => void
}

async function uploadImage({
  url,
  file,
  onSuccess = () => void 0,
  onError = () => void 0,
  onUploadProgress = () => void 0,
}: UploadImageOptions) {
  if (!url) {
    throw Error("Please pass an `url` to uploadImage")
  }

  if (!file) {
    throw Error("Please pass an `file` to uploadImage")
  }

  const headers = new Headers()
  headers.append("content-type", file.type)

  try {
    const response = await axios.put(url, file, {
      headers: {
        "content-type": file.type,
      },
      onUploadProgress: (progressEvent) => {
        const percentage = Math.round(
          (progressEvent.loaded / progressEvent.total) * 100,
        )
        onUploadProgress(percentage, file.name)
      },
    })

    if (response.status === 200) {
      onSuccess(file)
    } else {
      throw new Error(`${file.name} upload failed`)
    }
  } catch (error: any) {
    onError(error)
  }
}

interface UseUploadFilesOptions {
  onUploadProgress?: (p: number, filePath?: string) => void
  onFileSuccess?: (file: File, path: string) => void
  onFileError?: (file: File, error: Error) => void
  onSuccess?: (files: Array<File>, paths: Array<string>) => void
}

interface UploadFilesOptions {
  accepted: Array<File>
  rejected?: Array<FileRejection>
  basePath?: string
}

export function useUploadFilesMutation(options?: UseUploadFilesOptions) {
  const [isLoading, setIsLoading] = React.useState(false)
  const createFileUploadUrlMutation = useCreateFileUploadUrlMutation()

  const uploadFiles: ({
    accepted,
    rejected,
    basePath,
  }: UploadFilesOptions) => void = React.useCallback(
    async ({ accepted, rejected = [], basePath, projectId }) => {
      if (!projectId) {
        throw new Error("projectId is required in useUploadFilesMutation")
      }

      setIsLoading(true)

      const uploadedFiles: Array<File> = []
      const uploadedPaths: Array<string> = []

      const uploadPromises = accepted.map(async (file) => {
        try {
          const filePath = basePath ? path.join(basePath, file.name) : file.name

          const result = await createFileUploadUrlMutation.mutateAsync({
            projectId,
            filePath,
          })

          await uploadImage({
            url: result.createFileUploadUrl.fileUploadUrl,
            file,
            async onSuccess(file) {
              const url = `https://cdn.veryfront.com/${projectId}/${filePath}`
              uploadedFiles.push(file)
              uploadedPaths.push(url)
              options?.onFileSuccess?.(file, url)
            },
            async onError(error) {
              options?.onFileError?.(file, error)
            },
            onUploadProgress: options?.onUploadProgress,
          })
        } catch (error: any) {
          options?.onFileError?.(file, error)
        }
      })

      // Upload in parallel with errors handled inside each promise
      await Promise.allSettled(uploadPromises)

      options?.onSuccess?.(uploadedFiles, uploadedPaths)
      setIsLoading(false)
    },
    [
      createFileUploadUrlMutation,
      options?.onUploadProgress,
      options?.onFileSuccess,
      options?.onFileError,
      options?.onSuccess,
    ],
  )

  return { isLoading, uploadFiles }
}
