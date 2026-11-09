import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_DOCUMENT_SIZE, validateDocumentFiles } from '../src/documentFiles.js'

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
