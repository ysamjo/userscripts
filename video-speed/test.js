// Minimal-DOM: prüft, dass Spulen die Geschwindigkeit nicht zurücksetzt.
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const code = fs.readFileSync(path.join(__dirname, 'Video Speed Control with Keyboard.user.js'), 'utf8')
const tick = (ms = 25) => new Promise(r => setTimeout(r, ms))

function eventTarget() {
  const listeners = new Map()
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn) },
    dispatchEvent(event) {
      event.target ??= this
      for (const fn of [...(listeners.get(event.type) ?? [])]) fn(event)
      return true
    },
  }
}

// Rate-Setter feuert ratechange asynchron – wie im Browser (Capture am Dokument, dann Ziel).
function makeVideo(initial, doc) {
  let rate = initial, defaultRate = initial
  const v = Object.assign(eventTarget(), { localName: 'video', isContentEditable: false })
  for (const name of ['playbackRate', 'defaultPlaybackRate']) {
    Object.defineProperty(v, name, {
      get: () => (name === 'playbackRate' ? rate : defaultRate),
      set(value) {
        if (v[name] === value) return
        if (name === 'playbackRate') rate = value
        else defaultRate = value
        setTimeout(() => {
          const ev = { type: 'ratechange', target: v }
          doc.dispatchEvent(ev)
          v.dispatchEvent(ev)
        }, 0)
      },
    })
  }
  return v
}

const makeEl = (over = {}) => Object.assign({
  localName: 'div', isContentEditable: false, textContent: '',
  remove() {}, querySelectorAll: () => [],
}, over)

function load({ storedSpeed = 1.8, withVideo = true } = {}) {
  const store = { playbackSpeed: storedSpeed }
  const toasts = []
  const video = makeVideo(1, null)
  const document = Object.assign(eventTarget(), {
    readyState: 'complete',
    body: makeEl({ localName: 'body' }),
    querySelector: (s) => (s === 'video' && withVideo ? video : null),
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => makeEl(),
  })
  const v = makeVideo(1, document)
  // Video in die Dokument-Fakes einsetzen
  document.querySelector = (s) => (s === 'video' && withVideo ? v : null)

  vm.runInNewContext(code, {
    document,
    window: { addEventListener() {} },
    console: { info() {} },
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t },
    clearTimeout,
    GM_getValue: (k, d) => (k in store ? store[k] : d),
    GM_setValue: (k, val) => { store[k] = val },
    GM_addStyle: () => {},
    GM_addElement: (parent, tag, attrs) => { toasts.push(attrs); return makeEl({ localName: tag }) },
    GM_registerMenuCommand: () => {},
  })

  return {
    video: v, store, toasts, document,
    // Medien-Events erreichen das Dokument nur in der Capture-Phase.
    media(type) { const ev = { type, target: v }; document.dispatchEvent(ev); v.dispatchEvent(ev) },
    press(key) {
      const ev = {
        type: 'keydown', key, target: makeEl({ localName: 'body' }),
        preventDefault() {}, stopPropagation() {},
      }
      document.dispatchEvent(ev)
    },
  }
}

const results = []
const check = (name, actual, expected) =>
  results.push({ name, ok: actual === expected, actual, expected })
const near = (name, actual, expected) =>
  results.push({ name, ok: Math.abs(actual - expected) < 0.001, actual, expected })

;(async () => {
  // 1. Start: gespeicherte Rate wird angewendet
  const a = load({ storedSpeed: 1.8 })
  near('Start: Rate = 1.80', a.video.playbackRate, 1.8)

  // 2. Hotkey d → 1.90 und gespeichert
  a.press('d')
  await tick()
  near('Hotkey d: Rate = 1.90', a.video.playbackRate, 1.9)
  near('Hotkey d: gespeichert = 1.90', a.store.playbackSpeed, 1.9)

  // 3. Player setzt beim Spulen auf 1.00 zurück → Rate muss zurückkommen, Speicher unverändert
  a.video.playbackRate = 1
  await tick(60)
  near('Reset im laufenden Betrieb: Rate zurück auf 1.90', a.video.playbackRate, 1.9)
  near('Reset im laufenden Betrieb: gespeichert bleibt 1.90', a.store.playbackSpeed, 1.9)

  // 4. Seek: Reset zwischen seeking und seeked
  a.media('seeking')
  a.video.playbackRate = 1
  a.media('seeked')
  await tick(60)
  near('Seek: Rate = 1.90', a.video.playbackRate, 1.9)
  near('Seek: gespeichert bleibt 1.90', a.store.playbackSpeed, 1.9)

  // 5. Seek: Reset erst NACH seeked (asynchroner Player-Reset)
  a.media('seeked')
  await tick(10)
  a.video.playbackRate = 1
  await tick(60)
  near('Seek + später Reset: Rate = 1.90', a.video.playbackRate, 1.9)
  near('Seek + später Reset: gespeichert bleibt 1.90', a.store.playbackSpeed, 1.9)

  // 6. Resume nach Pause
  a.media('play')
  a.video.playbackRate = 1
  await tick(60)
  near('Resume: Rate = 1.90', a.video.playbackRate, 1.9)

  // 7. Player-Menü (echte Nutzerwahl 1.25) wird übernommen
  a.video.playbackRate = 1.25
  await tick(60)
  near('Player-Menü 1.25: Rate bleibt 1.25', a.video.playbackRate, 1.25)
  near('Player-Menü 1.25: gespeichert = 1.25', a.store.playbackSpeed, 1.25)

  // 8. r setzt auf 1.00 zurück (auch gespeichert)
  a.press('r')
  await tick(60)
  near('Hotkey r: Rate = 1.00', a.video.playbackRate, 1)
  near('Hotkey r: gespeichert = 1.00', a.store.playbackSpeed, 1)

  // 9. Ohne Video keine Fehler
  const b = load({ withVideo: false, storedSpeed: 2 })
  b.press('d')
  await tick()
  near('Ohne Video: kein Absturz, Speicher unverändert', b.store.playbackSpeed, 2)

  let failed = 0
  for (const r of results) {
    if (!r.ok) failed++
    console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : ' (erwartet ' + r.expected + ', war ' + r.actual + ')'))
  }
  console.log((results.length - failed) + '/' + results.length + ' bestanden')
  process.exit(failed ? 1 : 0)
})()
