import { useMemo, useRef, useState } from 'react'
import './App.css'

const filters = ['All documents', 'PDFs', 'Images']

function formatFileSize(size) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function getDocumentType(file) {
  const extension = file.name.split('.').pop()?.toLowerCase()

  if (file.type === 'application/pdf' || extension === 'pdf') {
    return 'PDF'
  }

  if (
    file.type === 'image/png' ||
    file.type === 'image/jpeg' ||
    ['png', 'jpg', 'jpeg'].includes(extension)
  ) {
    return 'Image'
  }

  return null
}

function App() {
  const fileInput = useRef(null)
  const [documents, setDocuments] = useState([])
  const [activeFilter, setActiveFilter] = useState(filters[0])
  const [query, setQuery] = useState('')
  const [uploadError, setUploadError] = useState('')

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

  function addFiles(event) {
    const selectedFiles = Array.from(event.target.files ?? [])
    const acceptedFiles = selectedFiles.flatMap((file) => {
      const type = getDocumentType(file)

      return type
        ? [{
            id: `${file.name}-${file.size}-${file.lastModified}`,
            name: file.name,
            size: file.size,
            type,
            addedAt: new Date(),
          }]
        : []
    })
    const rejectedCount = selectedFiles.length - acceptedFiles.length

    setDocuments((currentDocuments) => [
      ...acceptedFiles.filter(
        (acceptedFile) =>
          !currentDocuments.some(
            (currentDocument) => currentDocument.id === acceptedFile.id,
          ),
      ),
      ...currentDocuments,
    ])
    setUploadError(
      rejectedCount > 0
        ? 'Unsupported file type. Choose PDF, PNG, or JPEG documents.'
        : '',
    )
    event.target.value = ''
  }

  const pdfCount = documents.filter((document) => document.type === 'PDF').length
  const imageCount = documents.length - pdfCount

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
            <strong>Local preview</strong>
            <span>No server connection</span>
          </div>
        </div>
      </aside>

      <main className="main-content" id="documents">
        <header className="topbar">
          <span className="breadcrumb">Workspace <span>/</span> Documents</span>
          <span className="language-chip">ភាសាខ្មែរ</span>
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
            >
              <span aria-hidden="true">+</span>
              Add documents
            </button>
          </div>
          {uploadError && (
            <p className="upload-error" role="alert">
              {uploadError}
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

            {visibleDocuments.length > 0 ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Type</th>
                      <th scope="col">Date added</th>
                      <th scope="col">Size</th>
                      <th scope="col">Status</th>
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
                        <td><span className="status-pill">Local preview</span></td>
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
            Only file details appear here. Files are not uploaded or saved.
          </p>
        </section>
      </main>
    </div>
  )
}

export default App
