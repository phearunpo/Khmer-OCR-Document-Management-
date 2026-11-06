import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const filters = ['All documents', 'PDFs', 'Images']
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

function formatFileSize(size) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function App() {
  const fileInput = useRef(null)
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenStorageKey))
  const [user, setUser] = useState(null)
  const [documents, setDocuments] = useState([])
  const [activeFilter, setActiveFilter] = useState(filters[0])
  const [query, setQuery] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [documentError, setDocumentError] = useState('')
  const [authError, setAuthError] = useState('')
  const [isLoading, setIsLoading] = useState(Boolean(token))
  const [isUploading, setIsUploading] = useState(false)
  const [deletingDocumentId, setDeletingDocumentId] = useState(null)

  useEffect(() => {
    if (!token) {
      return undefined
    }

    let isCurrent = true

    Promise.all([
      requestApi('/user', token),
      requestApi('/documents', token),
    ])
      .then(([authenticatedUser, response]) => {
        if (isCurrent) {
          setUser(authenticatedUser)
          setDocuments(response.data.map((document) => ({
            ...document,
            addedAt: new Date(document.created_at),
          })))
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
          setAuthError('Your session expired. Please sign in again.')
        } else {
          setAuthError(error.message)
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
  }, [token])

  const visibleDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return documents.filter((document) => {
      const matchesFilter =
        activeFilter === 'All documents' ||
        (activeFilter === 'PDFs' && document.type === 'PDF') ||
        (activeFilter === 'Images' && document.type === 'Image')

      return (
        matchesFilter &&
        document.name.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [activeFilter, documents, query])

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
      sessionStorage.setItem(tokenStorageKey, response.token)
      setUser(response.user)
      setToken(response.token)
    } catch (error) {
      setAuthError(error.message)
      setIsLoading(false)
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
  }

  async function addFiles(event) {
    const selectedFiles = Array.from(event.target.files ?? [])
    event.target.value = ''

    if (selectedFiles.length === 0) {
      return
    }

    setIsUploading(true)
    setUploadError('')
    const failures = []

    for (const file of selectedFiles) {
      const body = new FormData()
      body.append('file', file)

      try {
        await requestApi('/documents', token, { method: 'POST', body })
      } catch (error) {
        if (error.status === 401) {
          sessionStorage.removeItem(tokenStorageKey)
          setToken(null)
          setUser(null)
          setDocuments([])
          setAuthError('Your session expired. Please sign in again.')
          setIsUploading(false)
          return
        }

        failures.push(`${file.name}: ${error.message}`)
      }
    }

    try {
      const response = await requestApi('/documents', token)
      setDocuments(response.data.map((document) => ({
        ...document,
        addedAt: new Date(document.created_at),
      })))
    } catch (error) {
      failures.push(`Could not refresh the document list: ${error.message}`)
    }

    setUploadError(failures.join(' '))
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
      setDocuments((currentDocuments) =>
        currentDocuments.filter((currentDocument) => currentDocument.id !== document.id),
      )
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

  const pdfCount = documents.filter((document) => document.type === 'PDF').length
  const imageCount = documents.length - pdfCount

  if (!token) {
    return (
      <main className="auth-page">
        <form className="auth-card" onSubmit={handleLogin}>
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
          <h1>Welcome back</h1>
          <p className="page-description">Sign in to access your document library.</p>
          <label className="auth-field">
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label className="auth-field">
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {authError && <p className="auth-error" role="alert">{authError}</p>}
          <button className="upload-button auth-submit" type="submit" disabled={isLoading}>
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="auth-note">Ask your administrator for an account.</p>
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
            <strong>Connected</strong>
            <span>{user?.email}</span>
          </div>
        </div>
      </aside>

      <main className="main-content" id="documents">
        <header className="topbar">
          <span className="breadcrumb">Workspace <span>/</span> Documents</span>
          <div className="topbar-actions">
            <span className="language-chip">ភាសាខ្មែរ</span>
            <button className="logout-button" type="button" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </header>

        <section className="page-content">
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
          {documentError && (
            <p className="upload-error" role="alert">
              {documentError}
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
              <strong className="stat-value">{documents.length}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-icon pdf-icon" aria-hidden="true">PDF</span>
              <span className="stat-label">PDF files</span>
              <strong className="stat-value">{pdfCount}</strong>
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
              <span className="stat-label">Image files</span>
              <strong className="stat-value">{imageCount}</strong>
            </article>
          </div>

          <section className="documents-panel" aria-labelledby="documents-title">
            <div className="panel-heading">
              <div>
                <h2 id="documents-title">Document library</h2>
                <p>Browse your recently added files.</p>
              </div>
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
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search documents"
                />
              </label>
            </div>

            <div className="filter-tabs" role="group" aria-label="Filter documents">
              {filters.map((filter) => (
                <button
                  className={activeFilter === filter ? 'filter-tab selected' : 'filter-tab'}
                  key={filter}
                  type="button"
                  aria-pressed={activeFilter === filter}
                  onClick={() => setActiveFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>

            {isLoading ? (
              <div className="empty-state" role="status">Loading documents…</div>
            ) : visibleDocuments.length > 0 ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Type</th>
                      <th scope="col">Date added</th>
                      <th scope="col">Size</th>
                      <th scope="col">Status</th>
                      <th scope="col"><span className="visually-hidden">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDocuments.map((document) => (
                      <tr key={document.id}>
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
                            className="delete-document-button"
                            type="button"
                            disabled={deletingDocumentId === document.id}
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
                <h3>{documents.length === 0 ? 'No documents yet' : 'No matching documents'}</h3>
                <p>
                  {documents.length === 0
                    ? 'Add a PDF or image to get started with your document library.'
                    : 'Try a different search or document type.'}
                </p>
                {documents.length === 0 && (
                  <button
                    className="empty-upload-button"
                    type="button"
                    onClick={() => fileInput.current?.click()}
                  >
                    Choose a file
                  </button>
                )}
              </div>
            )}
          </section>
          <p className="privacy-note">
            Documents are uploaded to your account's private storage.
          </p>
        </section>
      </main>
    </div>
  )
}

export default App
