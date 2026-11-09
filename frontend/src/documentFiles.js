export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024

const supportedExtensions = new Set(['pdf', 'png', 'jpg', 'jpeg'])

export function validateDocumentFiles(files) {
  const acceptedFiles = []
  const errors = []

  for (const file of files) {
    const extension = file.name.split('.').pop()?.toLowerCase()

    if (!supportedExtensions.has(extension)) {
      errors.push(`${file.name}: choose a PDF, PNG, or JPEG file.`)
    } else if (file.size > MAX_DOCUMENT_SIZE) {
      errors.push(`${file.name}: files must be 10 MB or smaller.`)
    } else {
      acceptedFiles.push(file)
    }
  }

  return { acceptedFiles, errors }
}
