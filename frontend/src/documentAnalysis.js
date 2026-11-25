export function tableToTsv(table) {
  const rows = Array.from({ length: table.rows.length }, () => Array(table.columns).fill(''))
  table.rows.forEach((row, r) => row.forEach((cell, c) => {
    if (!cell) return
    for (let rr = r; rr < Math.min(rows.length, r + cell.rowspan); rr += 1) {
      for (let cc = c; cc < Math.min(table.columns, c + cell.colspan); cc += 1) {
        rows[rr][cc] = cell.text
      }
    }
  }))
  return rows.map((row) => row.map((text) => {
    const literal = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text
    return /[\t\r\n"]/.test(literal) ? `"${literal.replaceAll('"', '""')}"` : literal
  }).join('\t')).join('\n')
}

export function readingChunks(text, maxLength = 450) {
  const chunks = []
  for (const paragraph of text.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean)) {
    let chunk = ''
    const segments = typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(paragraph)
      : paragraph
    for (const value of segments) {
      const segment = typeof value === 'string' ? value : value.segment
      if (chunk.length + segment.length > maxLength && chunk) {
        chunks.push(chunk)
        chunk = ''
      }
      chunk += segment
    }
    if (chunk) chunks.push(chunk)
  }
  return chunks
}
