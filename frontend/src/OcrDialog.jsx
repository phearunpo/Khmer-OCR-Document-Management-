import { useEffect, useRef, useState } from 'react'
import { ocrStatusLabels } from './ocrStatus.js'
import DocumentAnalysis from './DocumentAnalysis.jsx'
import DocumentReader from './DocumentReader.jsx'

export default function OcrDialog({ document: selectedDocument, token, requestApi, downloadApi, onClose, onStatusChange, onSessionExpired }) {
  const dialog = useRef(null)
  const [result, setResult] = useState(null)
  const [language, setLanguage] = useState('khm+eng')
  const [mode, setMode] = useState('structured')
  const [resultView, setResultView] = useState('analysis')
  const [downloadingTable, setDownloadingTable] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isStarting, setIsStarting] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const isActive = result?.status === 'queued' || result?.status === 'processing'

  useEffect(() => {
    const previousFocus = window.document.activeElement
    const previousOverflow = window.document.body.style.overflow
    window.document.body.style.overflow = 'hidden'
    const element = dialog.current
    element.querySelector('button')?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'Tab') {
        const controls = [...element.querySelectorAll('button:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
        const first = controls[0]
        const last = controls.at(-1)
        if (!element.contains(window.document.activeElement)) {
          event.preventDefault()
          first?.focus()
        } else if (event.shiftKey && window.document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && window.document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }

    window.document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.document.removeEventListener('keydown', handleKeyDown)
      window.document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [onClose])

  useEffect(() => {
    let isCurrent = true
    let timer
    const controller = new AbortController()

    async function loadStatus() {
      try {
        const response = await requestApi(`/documents/${selectedDocument.id}/ocr`, token, { signal: controller.signal })
        if (!isCurrent) return
        setResult(response.data)
        setError('')
        if (response.data.language) setLanguage(response.data.language)
        if (response.data.status !== 'not_started') setMode(response.data.mode ?? 'text')
        onStatusChange(selectedDocument.id, response.data.status)
        if (['queued', 'processing'].includes(response.data.status)) {
          timer = window.setTimeout(loadStatus, 1500)
        }
      } catch (failure) {
        if (!isCurrent) return
        if (failure.status === 401) onSessionExpired()
        else setError(failure.message)
      } finally {
        if (isCurrent) setIsLoading(false)
      }
    }

    loadStatus()
    return () => {
      isCurrent = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [selectedDocument.id, token, requestApi, onStatusChange, onSessionExpired, refreshKey])

  async function startRecognition() {
    setIsStarting(true)
    setError('')
    setNotice('')
    try {
      const response = await requestApi(`/documents/${selectedDocument.id}/ocr`, token, {
        method: 'POST',
        body: JSON.stringify({ language, mode }),
      })
      setResult(response.data)
      setResultView(mode === 'structured' ? 'analysis' : 'text')
      onStatusChange(selectedDocument.id, response.data.status)
      setRefreshKey((value) => value + 1)
    } catch (failure) {
      if (failure.status === 401) onSessionExpired()
      else if (failure.status === 409) setRefreshKey((value) => value + 1)
      else setError(failure.message)
    } finally {
      setIsStarting(false)
    }
  }

  async function copyText() {
    setNotice('')
    try {
      await navigator.clipboard.writeText(result.text)
      setNotice('Text copied to clipboard.')
    } catch {
      setNotice('Copy is unavailable. Select the text below or download the text file.')
    }
  }

  async function downloadText() {
    setIsDownloading(true)
    setError('')
    try {
      const file = await downloadApi(`/documents/${selectedDocument.id}/ocr/download`, token)
      const url = URL.createObjectURL(file)
      const link = window.document.createElement('a')
      link.href = url
      link.download = `${selectedDocument.name.replace(/\.[^.]+$/, '')}-ocr.txt`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (failure) {
      if (failure.status === 401) onSessionExpired()
      else setError(failure.message)
    } finally {
      setIsDownloading(false)
    }
  }

  async function downloadTable(tableId) {
    setDownloadingTable(tableId)
    setError('')
    try {
      const file = await downloadApi(`/documents/${selectedDocument.id}/ocr/tables/${tableId}/download`, token)
      const url = URL.createObjectURL(file)
      const link = window.document.createElement('a')
      link.href = url
      link.download = `${selectedDocument.name.replace(/\.[^.]+$/, '')}-${tableId}.csv`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (failure) {
      if (failure.status === 401) onSessionExpired()
      else setError(failure.message)
    } finally {
      setDownloadingTable(null)
    }
  }

  return (
    <div className="preview-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section ref={dialog} className={`ocr-dialog${result?.analysis ? ' ocr-dialog-analysis' : ''}`} role="dialog" aria-modal="true" aria-labelledby="ocr-title" aria-describedby="ocr-description">
        <header className="preview-header">
          <h2 id="ocr-title">Read & analyze document</h2>
          <button className="preview-close-button" type="button" onClick={onClose} aria-label="Close text extraction">Close</button>
        </header>
        <div className="ocr-body">
          <p className="ocr-document-name" title={selectedDocument.name}>{selectedDocument.name}</p>
          <p id="ocr-description" className="ocr-description">Read documents in order and keep schedule times with their activities and other table columns. Supports up to 25 pages.</p>
          <div className="ocr-controls">
            <label htmlFor="ocr-mode">Reading mode
              <select id="ocr-mode" value={mode} onChange={(event) => setMode(event.target.value)} disabled={isActive || isStarting || isLoading}>
                <option value="structured">Tables & schedules</option>
                <option value="text">Plain text</option>
              </select>
            </label>
            <label htmlFor="ocr-language">Document language
              <select id="ocr-language" value={language} onChange={(event) => setLanguage(event.target.value)} disabled={isActive || isStarting || isLoading}>
                <option value="khm+eng">Khmer + English</option>
                <option value="khm">Khmer</option>
                <option value="eng">English</option>
              </select>
            </label>
            <button className="upload-button" type="button" onClick={startRecognition} disabled={isLoading || isStarting || isActive || Boolean(error && !result)}>
              {isStarting ? 'Starting…' : isActive ? 'Recognition in progress…' : result?.status === 'failed' ? 'Try again' : mode === 'structured' ? (result?.status === 'completed' ? 'Analyze again' : 'Analyze document') : (result?.status === 'completed' ? 'Extract again' : 'Extract text')}
            </button>
          </div>
          <div className={`ocr-progress ocr-progress-${result?.status ?? 'loading'}`} role="status" aria-live="polite">
            <strong>{isLoading ? 'Loading recognition status…' : ocrStatusLabels[result?.status] ?? 'Status unavailable'}</strong>
            {result?.status === 'not_started' && <span>Choose a reading mode and language, then start extraction.</span>}
            {result?.status === 'queued' && <span>Your document is waiting to be processed. You can close this window and return later.</span>}
            {result?.status === 'processing' && <>
              <span>{result.pages ? `${result.processed_pages} of ${result.pages} pages recognized` : 'Preparing the document…'} You can close this window and return later.</span>
              {result.pages > 0 && <progress aria-label="Pages recognized" max={result.pages} value={result.processed_pages} />}
            </>}
            {result?.status === 'failed' && <span>{result.error || 'Recognition could not finish. Please try again.'}</span>}
            {result?.status === 'completed' && <span>{result.pages} {result.pages === 1 ? 'page' : 'pages'} processed{result.completed_at ? ` · ${new Date(result.completed_at).toLocaleString()}` : ''}</span>}
          </div>
          {error && <div className="ocr-error" role="alert"><p>{error}</p><button className="page-button" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Refresh status</button></div>}
          {result?.status === 'completed' && <>
            {result.analysis && <div className="analysis-views" role="group" aria-label="Document result view">
              <button className="page-button" type="button" aria-pressed={resultView === 'analysis'} onClick={() => setResultView('analysis')}>Analysis & tables</button>
              <button className="page-button" type="button" aria-pressed={resultView === 'text'} onClick={() => setResultView('text')}>Reading text</button>
            </div>}
            {result.text && <DocumentReader key={result.completed_at ?? 'document-text'} text={result.text} language={result.language} />}
            {result.analysis && resultView === 'analysis' && <DocumentAnalysis analysis={result.analysis} onDownloadTable={downloadTable} downloadingTable={downloadingTable} onNotice={setNotice} />}
            {(!result.analysis || resultView === 'text') && <>
            {result.text ? <>
              <div className="ocr-result-heading">
                <label htmlFor="ocr-text">Extracted text</label>
                <div className="ocr-result-actions">
                  <button className="page-button" type="button" onClick={copyText}>Copy text</button>
                  <button className="page-button" type="button" onClick={downloadText} disabled={isDownloading}>{isDownloading ? 'Downloading…' : 'Download .txt'}</button>
                </div>
              </div>
              <textarea id="ocr-text" className="ocr-text" value={result.text} readOnly rows={12} spellCheck={false} lang={result.language === 'eng' ? 'en' : 'km'} />
              <p className="ocr-description">Review extracted text against the original, especially names and numbers.</p>
            </> : <p className="ocr-description">No readable text was found. Try a clearer scan or select another language.</p>}
            </>}
          </>}
          {notice && <p className="ocr-notice" role="status">{notice}</p>}
        </div>
      </section>
    </div>
  )
}
