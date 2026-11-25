import { useState } from 'react'
import { tableToTsv } from './documentAnalysis.js'

export default function DocumentAnalysis({ analysis, onDownloadTable, downloadingTable, onNotice }) {
  const [view, setView] = useState('document')

  async function copyTable(table) {
    try {
      await navigator.clipboard.writeText(tableToTsv(table))
      onNotice('Table copied. Paste it into a spreadsheet to keep the columns.')
    } catch {
      onNotice('Copy is unavailable. Use Download CSV to save the table.')
    }
  }

  return (
    <div className="document-analysis">
      <div className="analysis-summary" aria-label="Document analysis summary">
        <span><strong>{analysis.summary.tables}</strong> tables</span>
        <span><strong>{analysis.summary.schedule_entries}</strong> schedule rows</span>
        <span><strong>{analysis.summary.review_cells}</strong> cells to check</span>
      </div>
      <div className="analysis-views" role="group" aria-label="Analysis view">
        <button className="page-button" type="button" aria-pressed={view === 'document'} onClick={() => setView('document')}>Document & tables</button>
        <button className="page-button" type="button" aria-pressed={view === 'schedule'} onClick={() => setView('schedule')}>Schedule reader</button>
      </div>
      {view === 'schedule' ? (
        <div className="schedule-entries">
          {analysis.schedule.length === 0 && <p className="ocr-description">No schedule rows were identified. Use Document & tables to read the extracted content.</p>}
          {analysis.schedule.map((entry) => (
            <article className="schedule-entry" key={`${entry.table_id}-${entry.row}`}>
              <header><strong>{entry.time}</strong><span>Page {entry.page} · Row {entry.row}{entry.needs_review ? ' · Check original' : ''}</span></header>
              {entry.context && <p className="schedule-context">{entry.context}</p>}
              <dl>{entry.values.map((value, index) => <div key={index}><dt>{value.label}</dt><dd>{value.text || <span className="analysis-empty">{entry.source === 'ocr' ? 'No text recognized' : 'Empty cell'}</span>}</dd></div>)}</dl>
            </article>
          ))}
        </div>
      ) : analysis.pages.map((page) => (
        <section className="analysis-page" key={page.number} aria-label={`Document page ${page.number}`}>
          <h3>Page {page.number}</h3>
          {page.blocks.length === 0 && <p className="ocr-description">No readable content was found on this page.</p>}
          {page.blocks.map((block, index) => block.type === 'table' ? (
            <section className="analysis-table-section" key={block.id} aria-label={`Table ${block.id}`}>
              <div className="analysis-table-heading">
                <span>{block.source === 'pdf_text' ? 'Original PDF text' : 'Recognized from scan'}{block.inferred ? ' · Inferred columns' : ''}</span>
                <div className="ocr-result-actions">
                  <button className="page-button" type="button" onClick={() => copyTable(block)}>Copy table</button>
                  <button className="page-button" type="button" disabled={Boolean(downloadingTable)} onClick={() => onDownloadTable(block.id)}>{downloadingTable === block.id ? 'Downloading…' : 'Download CSV'}</button>
                </div>
              </div>
              {block.inferred && <p className="analysis-review-note">Column and row boundaries were inferred from text positions. Check them against the original document.</p>}
              <div className="analysis-table-scroll" tabIndex={0} role="region" aria-label={`Scrollable table ${block.id}`}>
                <table className="analysis-table">
                  <caption>Table {block.id} · {block.columns} columns · {block.rows.length} rows</caption>
                  <tbody>{block.rows.map((row, r) => (
                    <tr key={r}>{row.map((cell, c) => {
                      if (!cell) return null
                      const Cell = r < block.header_rows ? 'th' : 'td'
                      return <Cell key={c} rowSpan={cell.rowspan} colSpan={cell.colspan} scope={r < block.header_rows ? 'col' : undefined} className={cell.needs_review ? 'analysis-cell-review' : undefined} title={cell.needs_review ? `${cell.review_reason ?? 'Check against the original.'}${cell.confidence !== null ? ` OCR score: ${cell.confidence}/100.` : ''}` : undefined}>
                        {cell.text || <span className="analysis-empty">{block.source === 'ocr' ? 'No text recognized' : 'Empty cell'}</span>}
                        {cell.needs_review && <span className="analysis-check">Check</span>}
                      </Cell>
                    })}</tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          ) : <p className="analysis-paragraph" key={index}>{block.text}</p>)}
        </section>
      ))}
      <p className="ocr-description">Values follow the source document. Empty cells stay empty; dates and missing details are not guessed. Highlighted cells need review.</p>
    </div>
  )
}
