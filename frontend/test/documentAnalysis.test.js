import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { readingChunks, tableToTsv } from '../src/documentAnalysis.js'

test('table view renders source spans, blank cells, Unicode and escaped document text', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  try {
    const { default: DocumentAnalysis } = await server.ssrLoadModule('/src/DocumentAnalysis.jsx')
    const cell = (text, rowspan = 1) => ({ text, rowspan, colspan: 1, confidence: null, needs_review: false })
    const analysis = {
      summary: { tables: 1, schedule_entries: 2, review_cells: 0 }, schedule: [],
      pages: [{ number: 1, blocks: [{
        type: 'table', id: 'p1-t1', columns: 2, header_rows: 2, source: 'pdf_text', inferred: false,
        rows: [[{ ...cell('School timetable'), colspan: 2 }, null], [cell('Time'), cell('Activity')], [cell('៨:៣០', 2), cell('<script>alert(1)</script>')], [null, cell('')]],
      }] }],
    }
    const html = renderToStaticMarkup(createElement(DocumentAnalysis, { analysis }))
    assert.match(html, /<table/)
    assert.match(html, /rowspan="2"/i)
    assert.match(html, /colspan="2"/i)
    assert.match(html, /៨:៣០/)
    assert.match(html, /Empty cell/)
    assert.match(html, /&lt;script&gt;/)
    assert.doesNotMatch(html, /<script>/)
    assert.match(html, /Download CSV/)
  } finally {
    await server.close()
  }
})

const cell = (text, rowspan = 1, colspan = 1) => ({ text, rowspan, colspan })

test('spreadsheet copy keeps times with their activities and empty cells', () => {
  const table = { columns: 3, rows: [
    [cell('Time'), cell('Activity'), cell('Room')],
    [cell('៨:៣០'), cell('សកម្មភាព'), cell('')],
    [cell('09:00'), cell('Meeting'), cell('A')],
  ] }
  assert.equal(tableToTsv(table), 'Time\tActivity\tRoom\n៨:៣០\tសកម្មភាព\t\n09:00\tMeeting\tA')
})

test('spreadsheet copy repeats only source merged cells', () => {
  const table = { columns: 2, rows: [
    [cell('Time'), cell('Activity')],
    [cell('08:00–10:00', 2), cell('Registration')],
    [null, cell('Workshop')],
  ] }
  assert.equal(tableToTsv(table), 'Time\tActivity\n08:00–10:00\tRegistration\n08:00–10:00\tWorkshop')
})

test('spreadsheet copy quotes multiline cells and prevents formulas', () => {
  const table = { columns: 2, rows: [[cell('=CMD()'), cell('A\n"B"')]] }
  assert.equal(tableToTsv(table), "'=CMD()\t\"A\n\"\"B\"\"\"")
})

test('read aloud keeps each schedule row and its column labels together', () => {
  const text = 'Page 1\n\nTime: 08:00; Activity: Registration\n\nTime: 09:00; Activity: Workshop'
  assert.deepEqual(readingChunks(text), ['Page 1', 'Time: 08:00; Activity: Registration', 'Time: 09:00; Activity: Workshop'])
})

test('long reading chunks preserve Khmer graphemes and all source characters', () => {
  const text = 'កម្ពុជា '.repeat(30).trim()
  const chunks = readingChunks(text, 20)
  assert.equal(chunks.join(''), text)
  assert.ok(chunks.every((chunk) => chunk.length <= 20))
  assert.deepEqual(readingChunks(''), [])
})
