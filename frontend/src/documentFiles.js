export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024

const supportedExtensions = new Set(['pdf', 'png', 'jpg', 'jpeg'])

export function getAllowedDocumentExtensions(mimeType) {
  switch (mimeType) {
    case 'application/pdf':
      return ['pdf']
    case 'image/png':
      return ['png']
    case 'image/jpeg':
      return ['jpg', 'jpeg']
    default:
      return []
  }
}

export function validateDocumentFiles(files) {
  const acceptedFiles = []
  const errors = []

  for (const file of files) {
    const extension = file.name.split('.').pop()?.toLowerCase()

    if (!supportedExtensions.has(extension)) {
      errors.push(`${file.name}: choose a PDF, PNG, or JPEG file.`)
    } else if (file.size === 0) {
      errors.push(`${file.name}: empty files cannot be uploaded.`)
    } else if (file.size > MAX_DOCUMENT_SIZE) {
      errors.push(`${file.name}: files must be 10 MB or smaller.`)
    } else {
      acceptedFiles.push(file)
    }
  }

  return { acceptedFiles, errors }
}

export function validateDocumentRename(name, mimeType) {
  if (typeof name !== 'string' || !name.trim()) {
    return 'Document name cannot be empty.'
  }

  const trimmed = name.trim()

  if (trimmed.length > 255) {
    return 'Document name cannot exceed 255 characters.'
  }

  if (/[/\\]/.test(trimmed)) {
    return 'Document name cannot contain slashes.'
  }

  const allowedExtensions = getAllowedDocumentExtensions(mimeType)
  const dotIndex = trimmed.lastIndexOf('.')
  const extension = dotIndex !== -1 ? trimmed.slice(dotIndex + 1).toLowerCase() : ''

  if (!allowedExtensions.includes(extension)) {
    return 'The name extension must match the document file type.'
  }

  return null
}

