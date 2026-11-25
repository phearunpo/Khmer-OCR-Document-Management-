import { useEffect, useRef, useState } from 'react'
import { validateDocumentFiles, validateDocumentRename } from './documentFiles.js'
import './App.css'

const filters = ['All documents', 'PDFs', 'Images', 'Favorites', 'Archived']
const apiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000/api'
).replace(/\/$/, '')
const tokenStorageKey = 'khmerdocs-token'

async function requestApi(path, token, options = {}) {
  let response

  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
  } catch {
    throw new Error('Cannot reach the API. Check that the backend is running.')
  }

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const validationMessage = Object.values(payload.errors ?? {}).flat()[0]
    const error = new Error(
      validationMessage ?? payload.message ?? 'The request could not be completed.',
    )
    error.status = response.status
    throw error
  }

  return payload
}

function uploadApi(file, token, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    const body = new FormData()
    body.append('file', file)

    request.open('POST', `${apiBaseUrl}/documents`)
    request.setRequestHeader('Accept', 'application/json')
    request.setRequestHeader('Authorization', `Bearer ${token}`)
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    })
    request.addEventListener('error', () => {
      reject(new Error('Cannot reach the API. Check that the backend is running.'))
    })
    request.addEventListener('load', () => {
      let payload

      try {
        payload = JSON.parse(request.responseText)
      } catch {
        reject(new Error('The API returned an invalid upload response.'))
        return
      }

      if (request.status < 200 || request.status >= 300) {
        const validationMessage = Object.values(payload.errors ?? {}).flat()[0]
        const error = new Error(
          validationMessage ?? payload.message ?? 'The upload could not be completed.',
        )
        error.status = request.status
        reject(error)
        return
      }

      resolve(payload)
    })
    request.send(body)
  })
}

async function downloadApi(path, token) {
  let response

  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      headers: {
        Accept: '*/*',
        Authorization: `Bearer ${token}`,
      },
    })
  } catch {
    throw new Error('Cannot reach the API. Check that the backend is running.')
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const error = new Error(
      payload.message ?? 'The document could not be downloaded.',
    )
    error.status = response.status
    throw error
  }

  return response.blob()
}

function formatFileSize(size) {
  if (size === 0) {
    return '0 B'
  }

  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function App() {
  const fileInput = useRef(null)
  const previousDebouncedQuery = useRef('')
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenStorageKey))
  const [user, setUser] = useState(null)
  const [authMode, setAuthMode] = useState('login')
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false)
  const [profileForm, setProfileForm] = useState({ name: '', email: '' })
  const [profileError, setProfileError] = useState('')
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false)
  const [isPasswordEditorOpen, setIsPasswordEditorOpen] = useState(false)
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    password: '',
    password_confirmation: '',
  })
  const [passwordError, setPasswordError] = useState('')
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [documents, setDocuments] = useState([])
  const [documentSummary, setDocumentSummary] = useState(null)
  const [activeFilter, setActiveFilter] = useState(filters[0])
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [sortOrder, setSortOrder] = useState('date-desc')
  const [currentPage, setCurrentPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [refreshKey, setRefreshKey] = useState(0)
  const [pagination, setPagination] = useState({
    current_page: 1,
    last_page: 1,
    per_page: 10,
    total: 0,
  })
  const [uploadError, setUploadError] = useState('')
  const [uploadProgress, setUploadProgress] = useState(null)
  const [documentError, setDocumentError] = useState('')
  const [summaryError, setSummaryError] = useState('')
  const [authError, setAuthError] = useState('')
  const [sessionNotice, setSessionNotice] = useState(null)
  const [isLoading, setIsLoading] = useState(Boolean(token))
  const [isUploading, setIsUploading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isRevokingSessions, setIsRevokingSessions] = useState(false)
  const [previewDocument, setPreviewDocument] = useState(null)
  const [previewingDocumentId, setPreviewingDocumentId] = useState(null)
  const [documentDetails, setDocumentDetails] = useState(null)
  const [detailsError, setDetailsError] = useState('')
  const [loadingDetailsId, setLoadingDetailsId] = useState(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [notesError, setNotesError] = useState('')
  const [isSavingNotes, setIsSavingNotes] = useState(false)
  const [favoritingDocumentId, setFavoritingDocumentId] = useState(null)
  const [archivingDocumentId, setArchivingDocumentId] = useState(null)
  const [renamingDocumentId, setRenamingDocumentId] = useState(null)
  const [deletingDocumentId, setDeletingDocumentId] = useState(null)
  const [selectedDocumentIds, setSelectedDocumentIds] = useState([])
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [downloadingDocumentId, setDownloadingDocumentId] = useState(null)

  useEffect(() => {
    if (!previewDocument) {
      return undefined
    }

    function handlePreviewKeyDown(event) {
      if (event.key === 'Escape') {
        setPreviewDocument(null)
      }
    }

    window.addEventListener('keydown', handlePreviewKeyDown)

    return () => {
      window.removeEventListener('keydown', handlePreviewKeyDown)
      URL.revokeObjectURL(previewDocument.url)
    }
  }, [previewDocument])

  useEffect(() => {
    if (!token) {
      return undefined
    }

    let isCurrent = true

    requestApi('/user', token)
      .then((authenticatedUser) => {
        if (isCurrent) {
          setUser(authenticatedUser)
        }
      })
      .catch((error) => {
        if (!isCurrent) {
          return
        }

        if (error.status === 401) {
          sessionStorage.removeItem(tokenStorageKey)
          setToken(null)
          setUser(null)
          setDocuments([])
          setDocumentSummary(null)
          setAuthError('Your session expired. Please sign in again.')
        } else {
          setAuthError(error.message)
        }
      })
    return () => {
      isCurrent = false
    }
  }, [token])

  useEffect(() => {
    if (!token) {
      return undefined
    }

    let isCurrent = true

    requestApi('/documents/summary', token)
      .then((response) => {
        if (isCurrent) {
          setDocumentSummary(response.data)
          setSummaryError('')
        }
      })
      .catch((error) => {
        if (!isCurrent) {
          return
        }

        if (error.status === 401) {
          sessionStorage.removeItem(tokenStorageKey)
          setToken(null)
          setUser(null)
          setDocuments([])
          setPasswordForm({
            current_password: '',
            password: '',
            password_confirmation: '',
          })
          setIsPasswordEditorOpen(false)
          setAuthError('Your session expired. Please sign in again.')
        } else {
          setSummaryError(error.message)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [refreshKey, token])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const nextQuery = query.trim()

      if (nextQuery !== previousDebouncedQuery.current) {
        setIsLoading(true)
        previousDebouncedQuery.current = nextQuery
        setDebouncedQuery(nextQuery)
        setCurrentPage(1)
      }
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [query])

  useEffect(() => {
    if (!token) {
      return undefined
    }

    let isCurrent = true
    const params = new URLSearchParams({
      page: String(currentPage),
      per_page: String(perPage),
    })
    const [sort, direction] = sortOrder.split('-')
    params.set('sort', sort)
    params.set('direction', direction)

    if (debouncedQuery) {
      params.set('search', debouncedQuery)
    }

    if (activeFilter === 'PDFs') {
      params.set('type', 'PDF')
    } else if (activeFilter === 'Images') {
      params.set('type', 'Image')
    } else if (activeFilter === 'Favorites') {
      params.set('favorites', '1')
    } else if (activeFilter === 'Archived') {
      params.set('archived', '1')
    }

    requestApi(`/documents?${params}`, token)
      .then((response) => {
        if (!isCurrent) {
          return
        }

        if (currentPage > response.meta.last_page) {
          setCurrentPage(response.meta.last_page)
          return
        }

        setSelectedDocumentIds([])
        setDocuments(response.data.map((document) => ({
          ...document,
          addedAt: new Date(document.created_at),
        })))
        setPagination(response.meta)
        setDocumentError('')
      })
      .catch((error) => {
        if (!isCurrent) {
          return
        }

        if (error.status === 401) {
          sessionStorage.removeItem(tokenStorageKey)
          setToken(null)
          setUser(null)
          setDocuments([])
          setPasswordForm({
            current_password: '',
            password: '',
            password_confirmation: '',
          })
          setIsPasswordEditorOpen(false)
          setAuthError('Your session expired. Please sign in again.')
        } else {
          setDocumentError(error.message)
          setSelectedDocumentIds([])
          setDocuments([])
          setPagination({
            current_page: currentPage,
            last_page: 1,
            per_page: perPage,
            total: 0,
          })
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [activeFilter, currentPage, debouncedQuery, perPage, refreshKey, sortOrder, token])

  function reloadDocuments() {
    setIsLoading(true)
    setDocumentError('')
    setRefreshKey((key) => key + 1)
  }

  function toggleDocumentSelection(documentId) {
    setSelectedDocumentIds((selectedIds) => (
      selectedIds.includes(documentId)
        ? selectedIds.filter((id) => id !== documentId)
        : [...selectedIds, documentId]
    ))
  }

  function toggleSelectCurrentPage() {
    const currentPageIds = documents.map((document) => document.id)
    const allSelected = currentPageIds.every((id) => selectedDocumentIds.includes(id))

    setSelectedDocumentIds(allSelected ? [] : currentPageIds)
  }

  function handleSearchChange(event) {
    const nextQuery = event.target.value

    if (nextQuery === query) {
      return
    }

    setQuery(nextQuery)
  }

  function handleFilterChange(filter) {
    if (filter === activeFilter && currentPage === 1) {
      return
    }

    setActiveFilter(filter)
    setCurrentPage(1)
    setIsLoading(true)
  }

  function clearSearchAndFilters() {
    setQuery('')
    previousDebouncedQuery.current = ''
    setDebouncedQuery('')
    setActiveFilter(filters[0])
    setCurrentPage(1)
    setIsLoading(true)
  }

  function handlePageChange(page) {
    if (page === currentPage) {
      return
    }

    setCurrentPage(page)
    setIsLoading(true)
  }

  function handlePageSizeChange(event) {
    const nextPageSize = Number(event.target.value)

    if (nextPageSize === perPage) {
      return
    }

    setPerPage(nextPageSize)
    setCurrentPage(1)
    setIsLoading(true)
  }

  function handleSortOrderChange(event) {
    const nextSortOrder = event.target.value

    if (nextSortOrder === sortOrder) {
      return
    }

    setSortOrder(nextSortOrder)
    setCurrentPage(1)
    setIsLoading(true)
  }

  async function handleLogin(event) {
    event.preventDefault()
    setIsLoading(true)
    setAuthError('')

    const formData = new FormData(event.currentTarget)

    try {
      const response = await requestApi('/login', null, {
        method: 'POST',
        body: JSON.stringify({
          email: formData.get('email'),
          password: formData.get('password'),
        }),
      })
      setDocumentSummary(null)
      setSummaryError('')
      sessionStorage.setItem(tokenStorageKey, response.token)
      setUser(response.user)
      setToken(response.token)
    } catch (error) {
      setAuthError(error.message)
      setIsLoading(false)
    }
  }

  async function handleRegister(event) {
    event.preventDefault()
    setIsLoading(true)
    setAuthError('')

    const formData = new FormData(event.currentTarget)

    try {
      const response = await requestApi('/register', null, {
        method: 'POST',
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          password: formData.get('password'),
          password_confirmation: formData.get('password_confirmation'),
        }),
      })
      setDocumentSummary(null)
      setSummaryError('')
      sessionStorage.setItem(tokenStorageKey, response.token)
      setUser(response.user)
      setToken(response.token)
    } catch (error) {
      setAuthError(error.message)
      setIsLoading(false)
    }
  }

  function toggleAuthMode() {
    setAuthMode((mode) => (mode === 'login' ? 'register' : 'login'))
    setAuthError('')
  }

  function openProfileEditor() {
    setProfileForm({
      name: user?.name ?? '',
      email: user?.email ?? '',
    })
    setProfileError('')
    setIsProfileEditorOpen(true)
  }

  async function handleProfileUpdate(event) {
    event.preventDefault()
    setIsUpdatingProfile(true)
    setProfileError('')

    try {
      const response = await requestApi('/user', token, {
        method: 'PUT',
        body: JSON.stringify(profileForm),
      })
      setUser(response.data)
      setIsProfileEditorOpen(false)
      setSessionNotice({ message: 'Profile updated.', isError: false })
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem(tokenStorageKey)
        setToken(null)
        setUser(null)
        setDocuments([])
        setAuthError('Your session expired. Please sign in again.')
      } else {
        setProfileError(error.message)
      }
    } finally {
      setIsUpdatingProfile(false)
    }
  }

  function openPasswordEditor() {
    setPasswordForm({
      current_password: '',
      password: '',
      password_confirmation: '',
    })
    setPasswordError('')
    setIsPasswordEditorOpen(true)
  }

  function closePasswordEditor() {
    if (isUpdatingPassword) {
      return
    }

    setPasswordForm({
      current_password: '',
      password: '',
      password_confirmation: '',
    })
    setPasswordError('')
    setIsPasswordEditorOpen(false)
  }

  async function handlePasswordUpdate(event) {
    event.preventDefault()
    setIsUpdatingPassword(true)
    setPasswordError('')

    try {
      const response = await requestApi('/user/password', token, {
        method: 'PUT',
        body: JSON.stringify(passwordForm),
      })
      setPasswordForm({
        current_password: '',
        password: '',
        password_confirmation: '',
      })
      setIsPasswordEditorOpen(false)
      setSessionNotice({ message: response.message, isError: false })
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem(tokenStorageKey)
        setToken(null)
        setUser(null)
        setDocuments([])
        setPasswordForm({
          current_password: '',
          password: '',
          password_confirmation: '',
        })
        setIsPasswordEditorOpen(false)
        setAuthError('Your session expired. Please sign in again.')
      } else {
        setPasswordError(error.message)
      }
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  async function revokeOtherSessions() {
    if (!window.confirm('Sign out all other sessions? This device will remain signed in.')) {
      return
    }

    setIsRevokingSessions(true)
    setSessionNotice(null)

    try {
      const response = await requestApi('/logout/others', token, { method: 'POST' })
      const count = response.revoked_sessions
      setSessionNotice({
        message: count === 0
          ? 'No other sessions were signed out.'
          : `${count} other session${count === 1 ? '' : 's'} signed out.`,
        isError: false,
      })
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem(tokenStorageKey)
        setToken(null)
        setUser(null)
        setDocuments([])
        setDocumentSummary(null)
        setAuthError('Your session expired. Please sign in again.')
      } else {
        setSessionNotice({
          message: `Could not sign out other sessions: ${error.message}`,
          isError: true,
        })
      }
    } finally {
      setIsRevokingSessions(false)
    }
  }

  async function handleLogout() {
    try {
      await requestApi('/logout', token, { method: 'POST' })
      setAuthError('')
    } catch (error) {
      setAuthError(`Signed out locally, but the API could not revoke the token: ${error.message}`)
    }

    sessionStorage.removeItem(tokenStorageKey)
    setToken(null)
    setUser(null)
    setDocuments([])
    setDocumentSummary(null)
    setPasswordForm({
      current_password: '',
      password: '',
      password_confirmation: '',
    })
    setIsPasswordEditorOpen(false)
  }

  async function addFiles(event) {
    const selectedFiles = Array.from(event.target.files ?? [])
    event.target.value = ''

    if (selectedFiles.length === 0 || isUploading) {
      return
    }

    const { acceptedFiles, errors } = validateDocumentFiles(selectedFiles)
    const failures = [...errors]

    if (acceptedFiles.length === 0) {
      setUploadError(failures.join(' '))
      return
    }

    setIsUploading(true)
    setUploadError(failures.join(' '))

    for (const [index, file] of acceptedFiles.entries()) {
      setUploadProgress({
        fileName: file.name,
        fileNumber: index + 1,
        fileCount: acceptedFiles.length,
        percent: 0,
      })

      try {
        await uploadApi(file, token, (percent) => {
          setUploadProgress({
            fileName: file.name,
            fileNumber: index + 1,
            fileCount: acceptedFiles.length,
            percent,
          })
        })
        setUploadProgress({
          fileName: file.name,
          fileNumber: index + 1,
          fileCount: acceptedFiles.length,
          percent: 100,
        })
      } catch (error) {
        if (error.status === 401) {
          sessionStorage.removeItem(tokenStorageKey)
          setToken(null)
          setUser(null)
          setDocuments([])
          setAuthError('Your session expired. Please sign in again.')
          setUploadProgress(null)
          setIsUploading(false)
          return
        }

        failures.push(`${file.name}: ${error.message}`)
      }
    }

    setCurrentPage(1)
    reloadDocuments()

    setUploadError(failures.join(' '))
    setUploadProgress(null)
    setIsUploading(false)
  }

  async function deleteDocument(document) {
    if (!window.confirm(`Delete "${document.name}"? This cannot be undone.`)) {
      return
    }

    setDeletingDocumentId(document.id)
    setDocumentError('')

    try {
      await requestApi(`/documents/${document.id}`, token, { method: 'DELETE' })
      reloadDocuments()
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem(tokenStorageKey)
        setToken(null)
        setUser(null)
        setDocuments([])
        setAuthError('Your session expired. Please sign in again.')
      } else {
        setDocumentError(`Could not delete ${document.name}: ${error.message}`)
      }
    } finally {
      setDeletingDocumentId(null)
    }
  }

  async function deleteSelectedDocuments() {
    const selectedCount = selectedDocumentIds.length

    if (
      selectedCount === 0 ||
      !window.confirm(`Delete ${selectedCount} selected documents? This cannot be undone.`)
    ) {
      return
    }

    setIsBulkDeleting(true)
    setDocumentError('')

    try {
      await requestApi('/documents/bulk', token, {
        method: 'DELETE',
        body: JSON.stringify({ ids: selectedDocumentIds }),
      })
      setSelectedDocumentIds([])
      reloadDocuments()
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem(tokenStorageKey)
        setToken(null)
        setUser(null)
        setDocuments([])
        setAuthError('Your session expired. Please sign in again.')
      } else {
        setDocumentError(`Could not delete the selected documents: ${error.message}`)
      }
    } finally {
      setIsBulkDeleting(false)
    }
  }

  async function renameDocument(document) {
    const enteredName = window.prompt('Enter a new document name:', document.name)

    if (enteredName === null) {
      return
    }

    const name = enteredName.trim()

    if (!name) {
      setDocumentError('Document name cannot be empty.')
      return
    }

    if (name === document.name) {
      return
    }

    const validationError = validateDocumentRename(name, document.mime_type)

    if (validationError) {
      setDocumentError(`Could not rename ${document.name}: ${validationError}`)
      return
    }

    setRenamingDocumentId(document.id)
    setDocumentError('')

    try {
      await requestApi(`/documents/${document.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      })
      reloadDocuments()
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem(tokenStorageKey)
        setToken(null)
        setUser(null)
        setDocuments([])
        setAuthError('Your session expired. Please sign in again.')
      } else {
        setDocumentError(`Could not rename ${document.name}: ${error.message}`)
      }
    } finally {
      setRenamingDocumentId(null)
    }
  }

  async function downloadDocument(document) {
    setDownloadingDocumentId(document.id)
    setDocumentError('')

    try {
      const file = await downloadApi(`/documents/${document.id}/download`, token)
      const url = URL.createObjectURL(file)
      const link = window.document.createElement('a')
      link.href = url
      link.download = document.name
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem(tokenStorageKey)
        setToken(null)
        setUser(null)
        setDocuments([])
        setAuthError('Your session expired. Please sign in again.')
      } else {
        setDocumentError(`Could not download ${document.name}: ${error.message}`)
      }
    } finally {
      setDownloadingDocumentId(null)
    }
  }

  async function exportDocuments() {
    const params = new URLSearchParams()
    const [sort, direction] = sortOrder.split('-')

    if (debouncedQuery) {
      params.set('search', debouncedQuery)
    }

    if (activeFilter === 'PDFs') {
      params.set('type', 'PDF')
    } else if (activeFilter === 'Images') {
      params.set('type', 'Image')
    } else if (activeFilter === 'Favorites') {
      params.set('favorites', '1')
    } else if (activeFilter === 'Archived') {
      params.set('archived', '1')
    }

    params.set('sort', sort)
    params.set('direction', direction)
    setIsExporting(true)
    setDocumentError('')

    try {
      const file = await downloadApi(`/documents/export?${params}`, token)
      const url = URL.createObjectURL(file)
      const link = window.document.createElement('a')
      link.href = url
      link.download = 'documents.csv'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem(tokenStorageKey)
        setToken(null)
        setUser(null)
        setDocuments([])
        setAuthError('Your session expired. Please sign in again.')
      } else {
        setDocumentError(`Could not export documents: ${error.message}`)
      }
    } finally {
      setIsExporting(false)
    }
  }

  async function previewDocumentFile(document) {
    setPreviewingDocumentId(document.id)
    setDocumentError('')

    try {
      const file = await downloadApi(`/documents/${document.id}/preview`, token)
      setPreviewDocument({
        id: document.id,
        name: document.name,
        type: document.type,
        url: URL.createObjectURL(file),
      })
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem(tokenStorageKey)
        setToken(null)
        setUser(null)
        setDocuments([])
        setAuthError('Your session expired. Please sign in again.')
      } else {
        setDocumentError(`Could not preview ${document.name}: ${error.message}`)
      }
    } finally {
      setPreviewingDocumentId(null)
    }
  }

  async function viewDocumentDetails(document) {
    setLoadingDetailsId(document.id)
    setDetailsError('')
    setNotesError('')
    setDocumentDetails(null)
    setNotesDraft('')

    try {
      const [detailsResponse, notesResponse] = await Promise.all([
        requestApi(`/documents/${document.id}`, token),
        requestApi(`/documents/${document.id}/notes`, token),
      ])
      const notes = notesResponse.data.notes ?? ''
      setDocumentDetails({ ...detailsResponse.data, notes })
      setNotesDraft(notes)
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem(tokenStorageKey)
        setToken(null)
        setUser(null)
        setDocuments([])
        setAuthError('Your session expired. Please sign in again.')
      } else {
        setDetailsError(`Could not load ${document.name}: ${error.message}`)
      }
    } finally {
      setLoadingDetailsId(null)
    }
  }

  async function saveDocumentNotes() {
    if (
      !documentDetails ||
      notesDraft === (documentDetails.notes ?? '')
    ) {
      return
    }

    setIsSavingNotes(true)
    setNotesError('')

    try {
      const response = await requestApi(`/documents/${documentDetails.id}/notes`, token, {
        method: 'PATCH',
        body: JSON.stringify({ notes: notesDraft || null }),
      })
      setDocumentDetails((currentDetails) => (
        currentDetails
          ? { ...currentDetails, notes: response.data.notes }
          : currentDetails
      ))
      setNotesDraft(response.data.notes ?? '')
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem(tokenStorageKey)
        setToken(null)
        setUser(null)
        setDocuments([])
        setDocumentDetails(null)
        setAuthError('Your session expired. Please sign in again.')
      } else {
        setNotesError(`Could not save notes: ${error.message}`)
      }
    } finally {
      setIsSavingNotes(false)
    }
  }

  async function toggleDocumentFavorite(document) {
    setFavoritingDocumentId(document.id)
    setDocumentError('')

    try {
      await requestApi(`/documents/${document.id}/favorite`, token, {
        method: 'PATCH',
        body: JSON.stringify({ is_favorite: !document.is_favorite }),
      })
      reloadDocuments()
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem(tokenStorageKey)
        setToken(null)
        setUser(null)
        setDocuments([])
        setAuthError('Your session expired. Please sign in again.')
      } else {
        setDocumentError(`Could not update favorite for ${document.name}: ${error.message}`)
      }
    } finally {
      setFavoritingDocumentId(null)
    }
  }

  async function toggleDocumentArchive(document) {
    setArchivingDocumentId(document.id)
    setDocumentError('')

    try {
      await requestApi(`/documents/${document.id}/archive`, token, {
        method: 'PATCH',
        body: JSON.stringify({ archived: !document.is_archived }),
      })
      reloadDocuments()
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem(tokenStorageKey)
        setToken(null)
        setUser(null)
        setDocuments([])
        setAuthError('Your session expired. Please sign in again.')
      } else {
        setDocumentError(`Could not update archive status for ${document.name}: ${error.message}`)
      }
    } finally {
      setArchivingDocumentId(null)
    }
  }

  if (!token) {
    return (
      <main className="auth-page">
        <form
          className="auth-card"
          onSubmit={authMode === 'login' ? handleLogin : handleRegister}
        >
          <a className="brand auth-brand" href="/" aria-label="KhmerDocs home">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M7 3.75h6.5L19 9.25v10A1.75 1.75 0 0 1 17.25 21h-10A1.75 1.75 0 0 1 5.5 19.25v-13A2.5 2.5 0 0 1 8 3.75Z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                />
                <path
                  d="M13 4v5.5h5.5M8.5 13h7M8.5 16.5h7"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>KhmerDocs</span>
          </a>
          <p className="eyebrow">DOCUMENT MANAGEMENT</p>
          <h1>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="page-description">
            {authMode === 'login'
              ? 'Sign in to access your document library.'
              : 'Register to start managing your documents.'}
          </p>
          {authMode === 'register' && (
            <label className="auth-field">
              Name
              <input name="name" type="text" autoComplete="name" maxLength={255} required />
            </label>
          )}
          <label className="auth-field">
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label className="auth-field">
            Password
            <input
              name="password"
              type="password"
              autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
              minLength={authMode === 'register' ? 8 : undefined}
              required
            />
          </label>
          {authMode === 'register' && (
            <label className="auth-field">
              Confirm password
              <input
                name="password_confirmation"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
          )}
          {authError && <p className="auth-error" role="alert">{authError}</p>}
          <button className="upload-button auth-submit" type="submit" disabled={isLoading}>
            {isLoading
              ? authMode === 'login' ? 'Signing in…' : 'Creating account…'
              : authMode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          <p className="auth-note">
            {authMode === 'login' ? 'Need an account? ' : 'Already registered? '}
            <button
              className="auth-mode-toggle"
              type="button"
              onClick={toggleAuthMode}
              disabled={isLoading}
            >
              {authMode === 'login' ? 'Create one' : 'Sign in'}
            </button>
          </p>
        </form>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="KhmerDocs home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M7 3.75h6.5L19 9.25v10A1.75 1.75 0 0 1 17.25 21h-10A1.75 1.75 0 0 1 5.5 19.25v-13A2.5 2.5 0 0 1 8 3.75Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path
                d="M13 4v5.5h5.5M8.5 13h7M8.5 16.5h7"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>KhmerDocs</span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <a className="nav-link active" href="#documents" aria-current="page">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 5.75A1.75 1.75 0 0 1 5.75 4h12.5A1.75 1.75 0 0 1 20 5.75v12.5A1.75 1.75 0 0 1 18.25 20H5.75A1.75 1.75 0 0 1 4 18.25V5.75Z"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M8 8h8M8 12h8M8 16h4"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
            Documents
          </a>
        </nav>

        <div className="sidebar-footer">
          <span className="local-indicator" />
          <div>
            <strong>{user?.name ?? 'Connected'}</strong>
            <span>{user?.email}</span>
          </div>
        </div>
      </aside>

      <main className="main-content" id="documents">
        <header className="topbar">
          <span className="breadcrumb">Workspace <span>/</span> Documents</span>
          <div className="topbar-actions">
            <span className="language-chip">ភាសាខ្មែរ</span>
            <button
              className="logout-button"
              type="button"
              onClick={openProfileEditor}
              disabled={!user}
            >
              Edit profile
            </button>
            <button
              className="logout-button"
              type="button"
              onClick={openPasswordEditor}
              disabled={!user}
            >
              Change password
            </button>
            <button
              className="logout-button"
              type="button"
              onClick={revokeOtherSessions}
              disabled={isRevokingSessions}
            >
              {isRevokingSessions ? 'Signing out…' : 'Sign out others'}
            </button>
            <button className="logout-button" type="button" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </header>

        <section className="page-content">
          {sessionNotice && (
            <p
              className={`session-notice${sessionNotice.isError ? ' session-notice-error' : ''}`}
              role={sessionNotice.isError ? 'alert' : 'status'}
            >
              {sessionNotice.message}
            </p>
          )}
          <div className="page-heading">
            <div>
              <p className="eyebrow">DOCUMENT MANAGEMENT</p>
              <h1>Your documents, in one place.</h1>
              <p className="page-description">
                Organize Khmer documents and get them ready for OCR.
              </p>
            </div>
            <input
              ref={fileInput}
              className="file-input"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              multiple
              disabled={isUploading}
              onChange={addFiles}
              aria-label="Choose PDF or image documents"
            />
            <button
              className="upload-button"
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={isUploading || isLoading}
            >
              <span aria-hidden="true">+</span>
              {isUploading ? 'Uploading…' : 'Add documents'}
            </button>
          </div>
          {authError && (
            <p className="upload-error" role="alert">
              {authError}
            </p>
          )}
          {uploadError && (
            <p className="upload-error" role="alert">
              {uploadError}
            </p>
          )}
          {uploadProgress && (
            <div className="upload-progress" role="status">
              <div className="upload-progress-label">
                <span>
                  Uploading {uploadProgress.fileNumber} of {uploadProgress.fileCount}:{' '}
                  {uploadProgress.fileName}
                </span>
                <span>{uploadProgress.percent}%</span>
              </div>
              <div
                className="upload-progress-track"
                role="progressbar"
                aria-label={`Uploading ${uploadProgress.fileName}`}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={uploadProgress.percent}
              >
                <span style={{ width: `${uploadProgress.percent}%` }} />
              </div>
            </div>
          )}
          {documentError && (
            <div className="document-error-actions">
              <p className="upload-error" role="alert">{documentError}</p>
              <button
                className="page-button"
                type="button"
                disabled={isLoading}
                onClick={reloadDocuments}
              >
                Retry
              </button>
            </div>
          )}
          {summaryError && (
            <p className="upload-error" role="alert">
              Could not load document totals: {summaryError}
            </p>
          )}

          <div className="stats-grid" aria-label="Document totals">
            <article className="stat-card">
              <span className="stat-icon document-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7 3.75h6.5L19 9.25v10A1.75 1.75 0 0 1 17.25 21h-10A1.75 1.75 0 0 1 5.5 19.25v-13A2.5 2.5 0 0 1 8 3.75Z"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M13 4v5.5h5.5M8.5 13h7M8.5 16.5h5"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <span className="stat-label">Total documents</span>
              <strong className="stat-value">{documentSummary?.total ?? '—'}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-icon pdf-icon" aria-hidden="true">PDF</span>
              <span className="stat-label">PDFs in library</span>
              <strong className="stat-value">{documentSummary?.pdf ?? '—'}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-icon image-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <rect
                    x="3.75"
                    y="4.75"
                    width="16.5"
                    height="14.5"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                  <circle cx="9" cy="10" r="1.5" fill="currentColor" />
                  <path
                    d="m5 17 4.5-4 3.25 3 2.5-2 3.75 3"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="stat-label">Images in library</span>
              <strong className="stat-value">{documentSummary?.image ?? '—'}</strong>
            </article>
          </div>

          <section className="documents-panel" aria-labelledby="documents-title">
            <div className="panel-heading">
              <div>
                <h2 id="documents-title">Document library</h2>
                <p>Browse and sort your documents.</p>
              </div>
              <div className="panel-tools">
                <label className="search-box">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle
                      cx="10.8"
                      cy="10.8"
                      r="6.8"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    />
                    <path
                      d="m16 16 4 4"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  </svg>
                  <input
                    type="search"
                    placeholder="Search documents"
                    value={query}
                    onChange={handleSearchChange}
                    aria-label="Search documents"
                  />
                </label>
                <label className="sort-control">
                  <span className="visually-hidden">Sort documents</span>
                  <select
                    className="sort-select"
                    value={sortOrder}
                    onChange={handleSortOrderChange}
                    disabled={isLoading}
                  >
                    <option value="date-desc">Newest first</option>
                    <option value="date-asc">Oldest first</option>
                    <option value="name-asc">Name A to Z</option>
                    <option value="name-desc">Name Z to A</option>
                  </select>
                </label>
                <button
                  className="export-button"
                  type="button"
                  disabled={isLoading || isExporting || pagination.total === 0}
                  onClick={exportDocuments}
                >
                  {isExporting ? 'Exporting…' : 'Export CSV'}
                </button>
              </div>
            </div>

            <div className="filter-tabs" role="group" aria-label="Filter documents">
              {filters.map((filter) => (
                <button
                  className={activeFilter === filter ? 'filter-tab selected' : 'filter-tab'}
                  key={filter}
                  type="button"
                  aria-pressed={activeFilter === filter}
                  onClick={() => handleFilterChange(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
            {selectedDocumentIds.length > 0 && (
              <div className="bulk-actions">
                <span>{selectedDocumentIds.length} selected</span>
                <button
                  className="delete-document-button"
                  type="button"
                  disabled={isBulkDeleting || isLoading}
                  onClick={deleteSelectedDocuments}
                >
                  {isBulkDeleting ? 'Deleting…' : 'Delete selected'}
                </button>
              </div>
            )}

            {isLoading ? (
              <div className="empty-state" role="status">Loading documents…</div>
            ) : documents.length > 0 ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col" className="selection-cell">
                        <input
                          className="selection-checkbox"
                          type="checkbox"
                          checked={
                            documents.length > 0 &&
                            documents.every((document) => selectedDocumentIds.includes(document.id))
                          }
                          onChange={toggleSelectCurrentPage}
                          disabled={isLoading || isBulkDeleting}
                          aria-label="Select all documents on this page"
                        />
                      </th>
                      <th scope="col">Name</th>
                      <th scope="col">Type</th>
                      <th scope="col">Date added</th>
                      <th scope="col">Size</th>
                      <th scope="col">Status</th>
                      <th scope="col"><span className="visually-hidden">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((document) => (
                      <tr key={document.id}>
                        <td className="selection-cell">
                          <input
                            className="selection-checkbox"
                            type="checkbox"
                            checked={selectedDocumentIds.includes(document.id)}
                            onChange={() => toggleDocumentSelection(document.id)}
                            disabled={isLoading || isBulkDeleting}
                            aria-label={`Select ${document.name}`}
                          />
                        </td>
                        <td>
                          <span className={`file-badge ${document.type === 'PDF' ? 'pdf-badge' : 'image-badge'}`}>
                            {document.type === 'PDF' ? 'PDF' : 'IMG'}
                          </span>
                          <span className="file-name" title={document.name}>
                            {document.name}
                          </span>
                        </td>
                        <td>{document.type}</td>
                        <td>
                          {document.addedAt.toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </td>
                        <td>{formatFileSize(document.size)}</td>
                        <td><span className="status-pill">Stored</span></td>
                        <td>
                          <button
                            className="favorite-document-button"
                            type="button"
                            disabled={favoritingDocumentId !== null || isLoading}
                            onClick={() => toggleDocumentFavorite(document)}
                            aria-label={`${document.is_favorite ? 'Remove' : 'Add'} ${document.name} ${document.is_favorite ? 'from' : 'to'} favorites`}
                            aria-pressed={document.is_favorite}
                          >
                            {favoritingDocumentId === document.id
                              ? 'Saving…'
                              : document.is_favorite ? '★ Saved' : '☆ Favorite'}
                          </button>
                          <button
                            className="archive-document-button"
                            type="button"
                            disabled={archivingDocumentId !== null || isLoading}
                            onClick={() => toggleDocumentArchive(document)}
                            aria-label={`${document.is_archived ? 'Restore' : 'Archive'} ${document.name}`}
                          >
                            {archivingDocumentId === document.id
                              ? 'Saving…'
                              : document.is_archived ? 'Restore' : 'Archive'}
                          </button>
                          <button
                            className="details-document-button"
                            type="button"
                            disabled={loadingDetailsId !== null}
                            onClick={() => viewDocumentDetails(document)}
                            aria-label={`View details and edit notes for ${document.name}`}
                          >
                            {loadingDetailsId === document.id ? 'Loading…' : 'Details / Notes'}
                          </button>
                          <button
                            className="preview-document-button"
                            type="button"
                            disabled={previewingDocumentId !== null}
                            onClick={() => previewDocumentFile(document)}
                            aria-label={`Preview ${document.name}`}
                          >
                            {previewingDocumentId === document.id ? 'Opening…' : 'Preview'}
                          </button>
                          <button
                            className="rename-document-button"
                            type="button"
                            disabled={renamingDocumentId !== null || isLoading}
                            onClick={() => renameDocument(document)}
                            aria-label={`Rename ${document.name}`}
                          >
                            {renamingDocumentId === document.id ? 'Renaming…' : 'Rename'}
                          </button>
                          <button
                            className="download-document-button"
                            type="button"
                            disabled={downloadingDocumentId !== null}
                            onClick={() => downloadDocument(document)}
                            aria-label={`Download ${document.name}`}
                          >
                            {downloadingDocumentId === document.id ? 'Downloading…' : 'Download'}
                          </button>
                          <button
                            className="delete-document-button"
                            type="button"
                            disabled={
                              isLoading ||
                              deletingDocumentId === document.id ||
                              deletingDocumentId !== null ||
                              isBulkDeleting
                            }
                            onClick={() => deleteDocument(document)}
                            aria-label={`Delete ${document.name}`}
                          >
                            {deletingDocumentId === document.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M7 3.75h6.5L19 9.25v10A1.75 1.75 0 0 1 17.25 21h-10A1.75 1.75 0 0 1 5.5 19.25v-13A2.5 2.5 0 0 1 8 3.75Z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M13 4v5.5h5.5M12 13v5m-2-2 2 2 2-2"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <h3>
                  {pagination.total === 0 &&
                  !query.trim() &&
                  activeFilter === filters[0]
                    ? 'No documents yet'
                    : 'No matching documents'}
                </h3>
                <p>
                  {pagination.total === 0 &&
                  !query.trim() &&
                  activeFilter === filters[0]
                    ? 'Add a PDF or image to get started with your document library.'
                    : 'Try a different search or document type.'}
                </p>
                {pagination.total === 0 &&
                  !query.trim() &&
                  activeFilter === filters[0] && (
                  <button
                    className="empty-upload-button"
                    type="button"
                    disabled={isUploading || isLoading}
                    onClick={() => fileInput.current?.click()}
                  >
                    Choose a file
                  </button>
                  )}
                {(query.trim() || activeFilter !== filters[0]) && (
                  <button
                    className="page-button"
                    type="button"
                    onClick={clearSearchAndFilters}
                  >
                    Clear search and filters
                  </button>
                )}
              </div>
            )}
            {pagination.total > 0 && (
              <nav className="pagination-controls" aria-label="Document pages">
                <span className="pagination-summary">
                  Showing {(pagination.current_page - 1) * pagination.per_page + 1}
                  {'–'}
                  {Math.min(
                    pagination.current_page * pagination.per_page,
                    pagination.total,
                  )}{' '}
                  of {pagination.total}
                </span>
                <label className="page-size-control">
                  Rows per page
                  <select
                    className="page-size-select"
                    value={perPage}
                    onChange={handlePageSizeChange}
                    disabled={isLoading}
                  >
                    {[10, 25, 50, 100].map((pageSize) => (
                      <option key={pageSize} value={pageSize}>{pageSize}</option>
                    ))}
                  </select>
                </label>
                <div className="pagination-buttons">
                  <button
                    className="page-button"
                    type="button"
                    disabled={pagination.current_page <= 1 || isLoading}
                    onClick={() => handlePageChange(pagination.current_page - 1)}
                  >
                    Previous
                  </button>
                  <span className="page-number" aria-live="polite">
                    Page {pagination.current_page} of {pagination.last_page}
                  </span>
                  <button
                    className="page-button"
                    type="button"
                    disabled={
                      pagination.current_page >= pagination.last_page || isLoading
                    }
                    onClick={() => handlePageChange(pagination.current_page + 1)}
                  >
                    Next
                  </button>
                </div>
              </nav>
            )}
          </section>
          <p className="privacy-note">
            Documents are uploaded to your account's private storage.
          </p>
        </section>
      </main>
      {detailsError && <p className="upload-error details-error" role="alert">{detailsError}</p>}
      {documentDetails && (
        <div
          className="preview-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDocumentDetails(null)
            }
          }}
        >
          <section
            className="profile-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="details-title"
          >
            <header className="preview-header">
              <h2 id="details-title">{documentDetails.name}</h2>
              <button
                className="preview-close-button"
                type="button"
                onClick={() => setDocumentDetails(null)}
              >
                Close
              </button>
            </header>
            <dl className="document-details">
              <dt>Type</dt>
              <dd>{documentDetails.mime_type}</dd>
              <dt>Size</dt>
              <dd>{formatFileSize(documentDetails.size)}</dd>
              <dt>Added</dt>
              <dd>
                {new Date(documentDetails.created_at).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </dd>
            </dl>
            <label className="notes-field">
              <span>Notes</span>
              <textarea
                value={notesDraft}
                onChange={(event) => setNotesDraft(event.target.value)}
                maxLength={10000}
                rows={5}
                disabled={isSavingNotes}
                placeholder="Add context or reminders for this document."
              />
            </label>
            {notesError && <p className="auth-error notes-error" role="alert">{notesError}</p>}
            <div className="notes-footer">
              <span>{notesDraft.length}/10000 characters</span>
              <button
                className="page-button"
                type="button"
                disabled={
                  isSavingNotes ||
                  notesDraft === (documentDetails.notes ?? '')
                }
                onClick={saveDocumentNotes}
              >
                {isSavingNotes ? 'Saving…' : 'Save notes'}
              </button>
            </div>
          </section>
        </div>
      )}
      {previewDocument && (
        <div
          className="preview-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setPreviewDocument(null)
            }
          }}
        >
          <section
            className="preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
          >
            <header className="preview-header">
              <h2 id="preview-title">{previewDocument.name}</h2>
              <button
                className="preview-close-button"
                type="button"
                onClick={() => setPreviewDocument(null)}
                aria-label="Close preview"
              >
                Close
              </button>
            </header>
            {previewDocument.type === 'PDF' ? (
              <iframe
                className="preview-frame"
                src={previewDocument.url}
                title={`Preview of ${previewDocument.name}`}
              />
            ) : (
              <img
                className="preview-image"
                src={previewDocument.url}
                alt={previewDocument.name}
              />
            )}
          </section>
        </div>
      )}
      {isProfileEditorOpen && (
        <div
          className="preview-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isUpdatingProfile) {
              setIsProfileEditorOpen(false)
            }
          }}
        >
          <section
            className="profile-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-title"
          >
            <header className="preview-header">
              <h2 id="profile-title">Edit profile</h2>
              <button
                className="preview-close-button"
                type="button"
                disabled={isUpdatingProfile}
                onClick={() => setIsProfileEditorOpen(false)}
              >
                Close
              </button>
            </header>
            <form className="profile-form" onSubmit={handleProfileUpdate}>
              <label className="auth-field">
                Name
                <input
                  type="text"
                  maxLength={255}
                  required
                  value={profileForm.name}
                  onChange={(event) => setProfileForm({
                    ...profileForm,
                    name: event.target.value,
                  })}
                />
              </label>
              <label className="auth-field">
                Email
                <input
                  type="email"
                  maxLength={255}
                  required
                  value={profileForm.email}
                  onChange={(event) => setProfileForm({
                    ...profileForm,
                    email: event.target.value,
                  })}
                />
              </label>
              {profileError && <p className="auth-error" role="alert">{profileError}</p>}
              <button
                className="upload-button auth-submit"
                type="submit"
                disabled={isUpdatingProfile}
              >
                {isUpdatingProfile ? 'Saving…' : 'Save profile'}
              </button>
            </form>
          </section>
        </div>
      )}
      {isPasswordEditorOpen && (
        <div
          className="preview-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closePasswordEditor()
            }
          }}
        >
          <section
            className="profile-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="password-title"
          >
            <header className="preview-header">
              <h2 id="password-title">Change password</h2>
              <button
                className="preview-close-button"
                type="button"
                disabled={isUpdatingPassword}
                onClick={closePasswordEditor}
              >
                Close
              </button>
            </header>
            <form className="profile-form" onSubmit={handlePasswordUpdate}>
              <label className="auth-field">
                Current password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={passwordForm.current_password}
                  onChange={(event) => setPasswordForm({
                    ...passwordForm,
                    current_password: event.target.value,
                  })}
                />
              </label>
              <label className="auth-field">
                New password
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={passwordForm.password}
                  onChange={(event) => setPasswordForm({
                    ...passwordForm,
                    password: event.target.value,
                  })}
                />
              </label>
              <label className="auth-field">
                Confirm new password
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={passwordForm.password_confirmation}
                  onChange={(event) => setPasswordForm({
                    ...passwordForm,
                    password_confirmation: event.target.value,
                  })}
                />
              </label>
              {passwordError && <p className="auth-error" role="alert">{passwordError}</p>}
              <button
                className="upload-button auth-submit"
                type="submit"
                disabled={isUpdatingPassword}
              >
                {isUpdatingPassword ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
