// ==UserScript==
// @name         YouTube Tweaks
// @namespace    local.yt.tweaks
// @version      1.0.0
// @description  OLED-Black, Shorts aus, Speed merken, Ambient/Endscreen aus, gesehene dimmen, Playlist-Laenge, Zeitstempel-Link, Audio-Only, Auto-PiP, Fokus-Modus, Pause-Dialog weg
// @author       local
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // EINSTELLUNGEN — alles hier schalten. false = Feature aus.
  // ---------------------------------------------------------------------------
  const CFG = {
    oled: true,             // echtes Schwarz statt #0f0f0f
    shorts: true,           // Shorts-Shelves ausblenden + /shorts/ID -> /watch?v=ID
    ambient: true,          // Ambient-Mode (Farbglühen am Player) aus
    endscreen: true,        // Endscreen-Karten + Vorschlags-Wand aus
    watermark: true,        // Kanal-Wasserzeichen im Player aus
    speed: true,            // Wiedergabegeschwindigkeit merken
    speedPerChannel: false, // ... pro Kanal statt global
    defaultSpeed: 1,        // Startgeschwindigkeit, wenn noch nichts gemerkt
    autoplayOff: true,      // "Als Nächstes" automatisch aus
    dimWatched: true,       // (teil)gesehene Videos in Feeds dimmen
    hideWatched: false,     // ... stattdessen ganz ausblenden
    homeToSubs: false,      // Startseite -> /feed/subscriptions
    focus: false,           // Fokus-Modus: Kommentare + rechte Spalte aus
    playlistLength: true,   // Gesamt-/Restlänge auf Playlist-Seiten
    copyTimestamp: true,    // Button "Zeitstempel"
    audioOnly: true,        // Button "Nur Audio"
    autoPiP: false,         // Tab-Wechsel -> Bild-in-Bild
    dismissPauseDialog: true, // "Video pausiert?"-Dialog wegklicken
    seekStep: 0,            // 0 = YouTube-Standard; z.B. 10 = Pfeiltasten 10s
    ytdlpEndpoint: '',      // z.B. http://127.0.0.1:8765/add -> Download-Button
  };

  if (window.top !== window || location.pathname.indexOf('/embed') === 0) return;

  const LS = {
    speed: 'yttweaks.speed',
    speedMap: 'yttweaks.speedByChannel',
    audio: 'yttweaks.audioOnly',
  };

  // ---------------------------------------------------------------- CSS ----
  const css = [];
  if (CFG.oled) css.push(`
    html[dark], html {
      --yt-spec-base-background: #000 !important;
      --yt-spec-raised-background: #0a0a0a !important;
      --yt-spec-general-background-a: #000 !important;
      --yt-spec-general-background-b: #000 !important;
      --yt-spec-general-background-c: #000 !important;
      --yt-spec-brand-background-solid: #0a0a0a !important;
      --yt-spec-brand-background-primary: rgba(0,0,0,.98) !important;
      --yt-spec-menu-background: #0d0d0d !important;
      --yt-spec-badge-chip-background: #151515 !important;
      --yt-spec-10-percent-layer: rgba(255,255,255,.08) !important;
    }
    ytd-app, #masthead-container, #page-manager, ytd-watch-flexy,
    ytd-browse, #columns, #primary { background-color: #000 !important; }
  `);
  if (CFG.shorts) css.push(`
    ytd-reel-shelf-renderer,
    ytd-rich-shelf-renderer[is-shorts],
    ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
    ytd-guide-entry-renderer:has(a[title="Shorts"]),
    ytd-mini-guide-entry-renderer[aria-label="Shorts"],
    ytd-video-renderer:has(a[href^="/shorts/"]) { display: none !important; }
  `);
  if (CFG.ambient) css.push('#cinematics, .ytp-cinematics { display: none !important; }');
  if (CFG.endscreen) css.push('.ytp-ce-element, .ytp-endscreen-content, .ytp-pause-overlay { display: none !important; }');
  if (CFG.watermark) css.push('.ytp-watermark, .annotation { display: none !important; }');
  if (CFG.dimWatched) css.push('ytd-rich-item-renderer:has(ytd-thumbnail-overlay-resume-playback-renderer), ytd-video-renderer:has(ytd-thumbnail-overlay-resume-playback-renderer), ytd-grid-video-renderer:has(ytd-thumbnail-overlay-resume-playback-renderer) { opacity: .45; }');
  if (CFG.hideWatched) css.push('ytd-rich-item-renderer:has(ytd-thumbnail-overlay-resume-playback-renderer), ytd-video-renderer:has(ytd-thumbnail-overlay-resume-playback-renderer), ytd-grid-video-renderer:has(ytd-thumbnail-overlay-resume-playback-renderer) { display: none !important; }');
  if (CFG.focus) css.push('#comments, #secondary { display: none !important; }');
  css.push(`
    html.yt-audio .html5-video-container { visibility: hidden !important; }
    .yt-tweaks-btn {
      background: rgba(255,255,255,.1); color: #f1f1f1; border: 0; border-radius: 18px;
      padding: 0 14px; height: 36px; font: 500 14px/36px Roboto, Arial, sans-serif;
      cursor: pointer; margin-right: 8px; white-space: nowrap;
    }
    .yt-tweaks-btn:hover { background: rgba(255,255,255,.2); }
    .yt-tweaks-btn[data-on="1"] { background: #3ea6ff; color: #0f0f0f; }
    #yt-tweaks-pill {
      position: fixed; left: 12px; bottom: 12px; z-index: 9999;
      background: rgba(0,0,0,.8); color: #fff; border-radius: 8px;
      padding: 6px 10px; font: 500 12px/1.4 Roboto, Arial, sans-serif;
      pointer-events: none; border: 1px solid rgba(255,255,255,.15);
    }
  `);

  function injectCSS() {
    if (!css.length || document.getElementById('yt-tweaks-style')) return;
    const el = document.createElement('style');
    el.id = 'yt-tweaks-style';
    el.textContent = css.join('\n');
    (document.head || document.documentElement).appendChild(el);
  }

  // -------------------------------------------------------------- helpers ----
  const mainVideo = () => document.querySelector('video.html5-main-video');

  function channelKey() {
    const a = document.querySelector('ytd-watch-metadata #channel-name a, ytd-video-owner-renderer #channel-name a');
    return a ? a.textContent.trim() : '';
  }

  function store() {
    try { return JSON.parse(localStorage.getItem(LS.speedMap) || '{}'); } catch (e) { return {}; }
  }

  function savedSpeed() {
    if (CFG.speedPerChannel) {
      const k = channelKey();
      const v = k && store()[k];
      if (v) return v;
    }
    const v = parseFloat(localStorage.getItem(LS.speed) || '');
    return isFinite(v) && v > 0 ? v : CFG.defaultSpeed;
  }

  function persistSpeed(rate) {
    if (!CFG.speed || !(rate > 0)) return;
    localStorage.setItem(LS.speed, String(rate));
    if (CFG.speedPerChannel) {
      const k = channelKey();
      if (!k) return;
      const m = store();
      m[k] = rate;
      try { localStorage.setItem(LS.speedMap, JSON.stringify(m)); } catch (e) {}
    }
  }

  // --------------------------------------------------------------- shorts ----
  function redirectShorts() {
    if (!CFG.shorts) return;
    const seg = location.pathname.split('/');
    if (seg[1] === 'shorts' && seg[2]) location.replace('/watch?v=' + seg[2]);
  }

  // ---------------------------------------------------------------- thema ----
  function ensureDark() {
    if (!CFG.oled) return;
    if (!document.documentElement.hasAttribute('dark')) {
      document.documentElement.setAttribute('dark', '');
    }
  }

  // ---------------------------------------------------------------- speed ----
  function applySpeed() {
    if (!CFG.speed) return;
    const v = mainVideo();
    if (!v) return;
    const want = savedSpeed();
    if (Math.abs(v.playbackRate - want) > 0.01) v.playbackRate = want;
  }

  // ------------------------------------------------------------- autoplay ----
  let autoplayHandled = false;
  function killAutoplay() {
    if (!CFG.autoplayOff || autoplayHandled) return;
    const t = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
    if (t) { t.click(); autoplayHandled = true; }
  }

  // -------------------------------------------------------------- buttons ----
  function injectButtons() {
    const row = document.querySelector('#top-level-buttons-computed');
    if (!row || row.querySelector('.yt-tweaks-btn')) return;

    if (CFG.copyTimestamp) {
      const b = document.createElement('button');
      b.className = 'yt-tweaks-btn';
      b.textContent = 'Zeitstempel';
      b.title = 'Link ab aktueller Stelle kopieren';
      b.onclick = () => {
        const v = mainVideo();
        const t = v ? Math.floor(v.currentTime) : 0;
        const url = new URL(location.href);
        url.searchParams.set('t', t + 's');
        navigator.clipboard.writeText(url.toString()).then(() => {
          b.textContent = 'kopiert';
          setTimeout(() => { b.textContent = 'Zeitstempel'; }, 1200);
        });
      };
      row.prepend(b);
    }

    if (CFG.audioOnly) {
      const b = document.createElement('button');
      b.className = 'yt-tweaks-btn';
      b.textContent = 'Nur Audio';
      b.dataset.on = localStorage.getItem(LS.audio) === '1' ? '1' : '0';
      b.onclick = () => {
        const on = b.dataset.on !== '1';
        b.dataset.on = on ? '1' : '0';
        document.documentElement.classList.toggle('yt-audio', on);
        localStorage.setItem(LS.audio, on ? '1' : '0');
      };
      row.prepend(b);
    }

    if (CFG.ytdlpEndpoint) {
      const b = document.createElement('button');
      b.className = 'yt-tweaks-btn';
      b.textContent = 'Download';
      b.onclick = () => {
        fetch(CFG.ytdlpEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: location.href }),
        }).catch(() => {});
        b.textContent = 'gesendet';
        setTimeout(() => { b.textContent = 'Download'; }, 1200);
      };
      row.prepend(b);
    }
  }

  // ------------------------------------------------------------- playlist ----
  function parseDur(txt) {
    const parts = txt.split(':').map((n) => parseInt(n, 10));
    if (!parts.length || parts.some(isNaN)) return 0;
    return parts.reduce((a, n) => a * 60 + n, 0);
  }

  function fmtDur(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? h + ':' + String(m).padStart(2, '0') + ' h' : m + ' min';
  }

  function playlistLength() {
    if (!CFG.playlistLength || location.pathname.indexOf('/playlist') !== 0) return;
    const items = Array.from(document.querySelectorAll('ytd-playlist-video-renderer'));
    if (!items.length) return;

    let total = 0;
    let done = 0;
    items.forEach((it) => {
      const el = it.querySelector('ytd-thumbnail-overlay-time-status-renderer');
      if (!el) return;
      const d = parseDur(el.textContent.trim());
      total += d;
      if (it.querySelector('ytd-thumbnail-overlay-resume-playback-renderer')) done += d;
    });

    let pill = document.getElementById('yt-tweaks-pill');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'yt-tweaks-pill';
      document.body.appendChild(pill);
    }
    pill.textContent = items.length + ' Videos · ' + fmtDur(total) + (done ? ' · gesehen ' + fmtDur(done) : '');
  }

  // -------------------------------------------------------- pause dialog -----
  function dismissPauseDialog() {
    if (!CFG.dismissPauseDialog) return;
    const dlg = document.querySelector('yt-confirm-dialog-renderer, tp-yt-paper-dialog');
    if (!dlg) return;
    if (!/pausiert|paused/i.test(dlg.textContent || '')) return;
    const btn = dlg.querySelector('#confirm-button button, #confirm-button, yt-button-renderer button');
    if (btn) btn.click();
  }

  // ------------------------------------------------------------- auto-pip ----
  document.addEventListener('visibilitychange', () => {
    if (!CFG.autoPiP || !document.hidden) return;
    const v = mainVideo();
    if (!v || v.paused || document.pictureInPictureElement) return;
    v.requestPictureInPicture().catch(() => {});
  });

  // --------------------------------------------------------- keyboard seek ---
  document.addEventListener('keydown', (e) => {
    if (!CFG.seekStep) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
    const v = mainVideo();
    if (!v) return;
    e.preventDefault();
    e.stopPropagation();
    v.currentTime += (e.key === 'ArrowRight' ? 1 : -1) * CFG.seekStep;
  }, true);

  // ------------------------------------------------------- speed capturing ---
  document.addEventListener('ratechange', (e) => {
    if (!CFG.speed) return;
    const el = e.target;
    if (!el || el.tagName !== 'VIDEO' || !el.classList.contains('html5-main-video')) return;
    persistSpeed(el.playbackRate);
  }, true);

  // ------------------------------------------------------------- lifecycle ---
  let timer = 0;
  function run() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      ensureDark();
      injectCSS();
      applySpeed();
      killAutoplay();
      injectButtons();
      dismissPauseDialog();
      if (localStorage.getItem(LS.audio) === '1') document.documentElement.classList.add('yt-audio');
    }, 120);
  }

  redirectShorts();
  document.addEventListener('yt-navigate-finish', () => {
    autoplayHandled = false;
    run();
    playlistLength();
  });
  document.addEventListener('yt-page-data-updated', run);
  window.addEventListener('scroll', () => {
    if (location.pathname.indexOf('/playlist') === 0) playlistLength();
  }, { passive: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
})();
