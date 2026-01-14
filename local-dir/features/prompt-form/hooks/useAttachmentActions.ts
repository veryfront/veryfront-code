import React from "react"
import {
  textFileExtensions,
  isImageFile,
  imageFileTypes,
} from "@/features/prompt-form/ui/ChatAttachment"
import { useUploadFilesMutation } from "@/shared/hooks/useUploadFilesMutation"
import { useCreateProjectMutation } from "@/shared/hooks/useCreateProjectMutation"
import { generateSlug } from "@/shared/utils/generateSlug"
import { useDropzone } from "https://esm.sh/react-dropzone-esm"

async function getFilesFromEvent(event: DropEvent) {
  let files: FileList | null = null

  if ("dataTransfer" in event) {
    files = event.dataTransfer.files
  } else if ("target" in event && event.target) {
    files = (event.target as HTMLInputElement).files
  }

  const promises: Array<Promise<FileWithDimensions>> = []

  for (let index = 0; index < files.length; index++) {
    const file = files[index] as FileWithDimensions
    const promise: Promise<FileWithDimensions> = new Promise((resolve) => {
      if (!isImageFile(file.type)) {
        return resolve(file)
      }
      const image = new Image()
      image.onload = function () {
        file.width = image.width
        file.height = image.height
        resolve(file)
      }
      image.src = URL.createObjectURL(file)
    })
    promises.push(promise)
  }
  return Promise.all(promises)
}

function validator(file: FileWithDimensions): FileError | Array<FileError> {
  return null
}

interface UseAttachmentActionsOptions {
  projectRef: React.MutableRefObject<any>
  onFileAttachmentsChange: (attachments: any[]) => void
  onFileAttachmentSuccess?: (file: File, url: string) => void
  onCloneScreenshotSuccess?: (files: File[], paths: string[]) => void
  onRejectedFilesChange: (rejected: FileRejection[]) => void
}

export function useAttachmentActions({
  projectRef,
  onFileAttachmentsChange,
  onFileAttachmentSuccess,
  onCloneScreenshotSuccess,
  onRejectedFilesChange,
}: UseAttachmentActionsOptions) {
  const createProject = useCreateProjectMutation()

  const { uploadFiles, isLoading: isUploading } = useUploadFilesMutation({
    showErrorToast: false,
    showSuccessToast: false,
    onFileSuccess(file, url) {
      onFileAttachmentSuccess?.(file, url)
    },
  })

  const {
    uploadFiles: uploadCloneScreenshotFiles,
    isLoading: isCloneScreenshotUploading,
  } = useUploadFilesMutation({
    onSuccess(files, paths) {
      onCloneScreenshotSuccess?.(files, paths)
    },
  })

  async function handleFileAttachments(files: File[]) {
    onFileAttachmentsChange(files.map((file) => ({
      name: file.name,
      contentType: file.type,
      url: null,
      isLoading: true,
    })))

    const projectId = projectRef.current?.id

    if (projectId) {
      await uploadFiles({
        accepted: files,
        basePath: "chat-uploads",
        projectId,
      })
      return
    }

    try {
      const slug = generateSlug()

      const newProject = await createProject.mutateAsync({
        name: slug,
        slug,
        template: "blank",
      })

      projectRef.current = newProject.createProject.project

      await uploadFiles({
        accepted: files,
        basePath: "chat-uploads",
        projectId: newProject.createProject.project.id,
      })
    } catch (error) {
      console.error("Files could not be uploaded", error)
      onFileAttachmentsChange([])
      return
    }
  }

  async function onAttachFile(event: React.ChangeEvent<HTMLInputElement>) {
    const files = await getFilesFromEvent(event)
    const accepted: Array<File> = []
    const rejected: Array<FileRejection> = []

    for (const file of files) {
      const error = validator(file)
      if (error) {
        rejected.push({ file, errors: Array.isArray(error) ? error : [error] })
      } else {
        accepted.push(file)
      }
    }

    onRejectedFilesChange(rejected)
    await handleFileAttachments(accepted)
  }

  async function onAttachCloneScreenshotFile(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const files = await getFilesFromEvent(event)
    const accepted: Array<File> = []
    const rejected: Array<FileRejection> = []

    for (const file of files) {
      const error = validator(file)
      if (error) {
        rejected.push({ file, errors: Array.isArray(error) ? error : [error] })
      } else {
        accepted.push(file)
      }
    }

    // Only set rejected files if there's nothing to continue with
    if (accepted.length === 0) {
      if (rejected.length > 0) {
        onRejectedFilesChange(rejected)
      }
      return
    }

    const projectId = projectRef.current?.id

    if (projectId) {
      await uploadCloneScreenshotFiles({
        accepted,
        basePath: "chat-uploads",
        projectId,
      })
      return
    }

    try {
      const slug = generateSlug()

      const newProject = await createProject.mutateAsync({
        name: slug,
        slug,
        template: "blank",
      })

      projectRef.current = newProject.createProject.project

      setTimeout(async () => {
        await uploadCloneScreenshotFiles({
          accepted,
          basePath: "chat-uploads",
          projectId: newProject.createProject.project.id,
        })
      })
    } catch (error) {
      console.error("Files could not be uploaded", error)
      return
    }
  }

  const attachDropzone = useDropzone({
    accept: {
      "text/*": textFileExtensions,
      ...imageFileTypes.reduce<Record<string, []>>((acc, type) => {
        acc[type] = []
        return acc
      }, {}),
    },
    onDrop: handleFileAttachments,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    noDragEventsBubbling: true,
    preventDropOnDocument: true,
    getFilesFromEvent,
    validator,
    onDropRejected(rejected) {
      onRejectedFilesChange(rejected)
    },
  })

  const cloneDropzone = useDropzone({
    accept: {
      "text/*": textFileExtensions,
      ...imageFileTypes.reduce<Record<string, []>>((acc, type) => {
        acc[type] = []
        return acc
      }, {}),
    },
    multiple: true,
    noClick: true,
    noKeyboard: true,
    noDragEventsBubbling: true,
    preventDropOnDocument: true,
    getFilesFromEvent,
    validator,
    onDropRejected(rejected) {
      onRejectedFilesChange(rejected)
    },
  })

  return {
    onAttachFile,
    onAttachCloneScreenshotFile,
    attachDropzone,
    cloneDropzone,
    isUploading,
    isCloneScreenshotUploading,
  }
}
