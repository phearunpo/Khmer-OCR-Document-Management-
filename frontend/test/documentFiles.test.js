import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_DOCUMENT_SIZE,
  getAllowedDocumentExtensions,
  validateDocumentFiles,
  validateDocumentRename,
} from '../src/documentFiles.js'

test('accepts supported document extensions case-insensitively', () => {
  const files = [
    { name: 'report.PDF', size: 1024 },
    { name: 'scan.png', size: 2048 },
    { name: 'photo.jpg', size: 4096 },
    { name: 'image.jpeg', size: 8192 },
  ]

  const result = validateDocumentFiles(files)

  assert.deepEqual(result.acceptedFiles, files)
  assert.deepEqual(result.errors, [])
})

test('accepts files at the maximum size and rejects larger files', () => {
  const files = [
    { name: 'within-limit.pdf', size: MAX_DOCUMENT_SIZE },
    { name: 'too-large.pdf', size: MAX_DOCUMENT_SIZE + 1 },
  ]

  const result = validateDocumentFiles(files)

  assert.deepEqual(result.acceptedFiles, [files[0]])
  assert.deepEqual(result.errors, [
    'too-large.pdf: files must be 10 MB or smaller.',
  ])
})

test('rejects empty documents while retaining nonempty selections', () => {
  const files = [
    { name: 'empty.pdf', size: 0 },
    { name: 'scan.png', size: 1 },
  ]

  assert.deepEqual(validateDocumentFiles(files), {
    acceptedFiles: [files[1]],
    errors: ['empty.pdf: empty files cannot be uploaded.'],
  })
})

test('reports unsupported files while retaining valid selections', () => {
  const files = [
    { name: 'notes.txt', size: 100 },
    { name: 'scan.png', size: 200 },
    { name: 'archive.pdf.exe', size: 300 },
  ]

  const result = validateDocumentFiles(files)

  assert.deepEqual(result.acceptedFiles, [files[1]])
  assert.deepEqual(result.errors, [
    'notes.txt: choose a PDF, PNG, or JPEG file.',
    'archive.pdf.exe: choose a PDF, PNG, or JPEG file.',
  ])
})

test('resolves allowed extensions for document mime types', () => {
  assert.deepEqual(getAllowedDocumentExtensions('application/pdf'), ['pdf'])
  assert.deepEqual(getAllowedDocumentExtensions('image/png'), ['png'])
  assert.deepEqual(getAllowedDocumentExtensions('image/jpeg'), ['jpg', 'jpeg'])
  assert.deepEqual(getAllowedDocumentExtensions('unknown/type'), [])
})

test('accepts document rename with matching extension case-insensitively', () => {
  assert.equal(validateDocumentRename('report.pdf', 'application/pdf'), null)
  assert.equal(validateDocumentRename('REPORT.PDF', 'application/pdf'), null)
  assert.equal(validateDocumentRename('scan.png', 'image/png'), null)
  assert.equal(validateDocumentRename('SCAN.PNG', 'image/png'), null)
  assert.equal(validateDocumentRename('photo.jpg', 'image/jpeg'), null)
  assert.equal(validateDocumentRename('photo.jpeg', 'image/jpeg'), null)
  assert.equal(validateDocumentRename('PHOTO.JPEG', 'image/jpeg'), null)
})

test('rejects document rename with mismatched or missing extensions', () => {
  assert.equal(
    validateDocumentRename('report.png', 'application/pdf'),
    'The name extension must match the document file type.',
  )
  assert.equal(
    validateDocumentRename('scan.pdf', 'image/png'),
    'The name extension must match the document file type.',
  )
  assert.equal(
    validateDocumentRename('photo', 'image/jpeg'),
    'The name extension must match the document file type.',
  )
  assert.equal(
    validateDocumentRename('doc.exe', 'application/pdf'),
    'The name extension must match the document file type.',
  )
})

test('rejects document rename with empty name, slashes, or excessive length', () => {
  assert.equal(validateDocumentRename('', 'application/pdf'), 'Document name cannot be empty.')
  assert.equal(validateDocumentRename('   ', 'application/pdf'), 'Document name cannot be empty.')
  assert.equal(validateDocumentRename(null, 'application/pdf'), 'Document name cannot be empty.')
  assert.equal(
    validateDocumentRename('folder/file.pdf', 'application/pdf'),
    'Document name cannot contain slashes.',
  )
  assert.equal(
    validateDocumentRename('folder\\file.pdf', 'application/pdf'),
    'Document name cannot contain slashes.',
  )
  assert.equal(
    validateDocumentRename(`${'a'.repeat(252)}.pdf`, 'application/pdf'),
    'Document name cannot exceed 255 characters.',
  )
})

