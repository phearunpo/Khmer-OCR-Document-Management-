import { useEffect, useRef, useState } from 'react'
import { readingChunks } from './documentAnalysis.js'

export default function DocumentReader({ text, language }) {
  const [voices, setVoices] = useState([])
  const [readingLanguage, setReadingLanguage] = useState(language === 'eng' ? 'en' : 'km')
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const session = useRef(0)
  const ownsSpeech = useRef(false)
  const utterance = useRef(null)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
  const matchingVoices = voices.filter((voice) => voice.localService && voice.lang.toLowerCase().startsWith(readingLanguage))

  useEffect(() => {
    if (!supported) return undefined
    const synthesis = window.speechSynthesis
    const updateVoices = () => setVoices(synthesis.getVoices())
    updateVoices()
    synthesis.addEventListener('voiceschanged', updateVoices)
    return () => {
      synthesis.removeEventListener('voiceschanged', updateVoices)
      session.current += 1
      if (ownsSpeech.current) synthesis.cancel()
    }
  }, [supported])

  function stop() {
    session.current += 1
    if (ownsSpeech.current) window.speechSynthesis.cancel()
    ownsSpeech.current = false
    setState('idle')
  }

  function read() {
    stop()
    setError('')
    const chunks = readingChunks(text)
    const current = session.current
    const voice = matchingVoices.find((value) => value.localService) ?? matchingVoices[0]
    let index = 0
    ownsSpeech.current = true
    setState('playing')

    function next() {
      if (current !== session.current) return
      if (index >= chunks.length) {
        ownsSpeech.current = false
        setState('idle')
        return
      }
      const speech = new SpeechSynthesisUtterance(chunks[index])
      utterance.current = speech
      speech.voice = voice
      speech.lang = voice.lang
      speech.rate = 0.9
      speech.onend = () => { index += 1; next() }
      speech.onerror = () => {
        if (current !== session.current) return
        ownsSpeech.current = false
        setState('idle')
        setError('Read aloud could not continue. You can still read or download the document.')
      }
      window.speechSynthesis.speak(speech)
    }
    next()
  }

  if (!supported) return <p className="ocr-description">Read aloud is unavailable in this browser.</p>

  return <section className="document-reader" aria-label="Read document aloud">
    <div className="document-reader-controls">
      <label>Reading voice
        <select value={readingLanguage} disabled={state !== 'idle'} onChange={(event) => setReadingLanguage(event.target.value)}>
          <option value="km">Khmer</option>
          <option value="en">English</option>
        </select>
      </label>
      <button className="page-button" type="button" disabled={matchingVoices.length === 0 || !text} onClick={state === 'idle' ? read : () => {
        if (state === 'playing') { window.speechSynthesis.pause(); setState('paused') }
        else { window.speechSynthesis.resume(); setState('playing') }
      }}>{state === 'idle' ? 'Read aloud' : state === 'playing' ? 'Pause reading' : 'Resume reading'}</button>
      {state !== 'idle' && <button className="page-button" type="button" onClick={stop}>Stop</button>}
    </div>
    <p className="ocr-description" role="status">{error || (matchingVoices.length === 0
      ? `No local ${readingLanguage === 'km' ? 'Khmer' : 'English'} voice is installed on this device. Text and tables are still available.`
      : state === 'playing' ? 'Reading the document in order, with each table row linked to its column headings.'
        : state === 'paused' ? 'Reading paused.' : 'Read tables row by row, including the time and its corresponding details.')}</p>
  </section>
}
