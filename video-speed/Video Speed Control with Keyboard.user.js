// ==UserScript==
// @name         Video Speed Control with Keyboard
// @description  Mit s und d HTML5-Video-Geschwindigkeit in 0,1-Schritten ändern; r setzt auf 1.0 zurück. Speichert Speed seitenübergreifend.
// @version      2026-11-01.1
// @author       Vitus Schuhwerk (modifiziert)
// @license      MIT
// @homepageURL  https://gist.githubusercontent.com/schuhwerk/67fb4da50652681b857002e1ba2bf071
// @updateURL    https://gist.githubusercontent.com/schuhwerk/67fb4da50652681b857002e1ba2bf071/raw
// @downloadURL  https://gist.githubusercontent.com/schuhwerk/67fb4da50652681b857002e1ba2bf071/raw
// @match        https://*.youtube.com/*
// @match        https://*.netflix.com/*
// @match        https://*.primevideo.com/*
// @match        https://*.amazon.com/*
// @match        https://*.disneyplus.com/*
// @match        https://*.twitch.tv/*
// @match        https://*.vimeo.com/*
// @match        https://*.dailymotion.com/*
// @match        https://*.wowtv.de/*
// @match        https://*.dazn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_addElement
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
  "use strict";
  const easyToast = {
    timeoutID: null,
    toastClass: 'ntfy-toast',
    addStyle() {
      GM_addStyle(`.${this.toastClass} {
        position: fixed; color: white; background: linear-gradient(to right, rgb(7 128 113), rgb(111 155 35));
        z-index: 99999; padding: 10px 20px; margin: 3vw; border-radius: 5px; font-size: 18px; right: 0; top: 0;
      }`)
    },
    success(message) {
      this.addStyle();
      this.addStyle = () => {};
      this.removeAndClear();
      GM_addElement(document.body, 'div', { class: this.toastClass, textContent: message });
      this.timeoutID = setTimeout(() => this.removeAndClear(), 2500);
    },
    clear(){
      if (typeof this.timeoutID === "number") {
        clearTimeout(this.timeoutID);
        this.timeoutID = null;
      }
    },
    removeAndClear() {
      document.querySelectorAll('.'+this.toastClass).forEach(e => e.remove());
      this.clear();
    }
  };
  const videoPlaybackControl = (() => {
    const log = ( ...l ) => console.info( "%cVPC", "color:grey", ...l );
    const STEP = 0.10;
    const MIN = 0.25, MAX = 10;
    const EPS = 0.005;
    const SPEED_KEY = "playbackSpeed";
    // Sicherheitsnetz, falls der Player die Rate dauerhaft zurücksetzt (Endlosgefecht vermeiden).
    const MAX_RESTORES = 10;
    // Nach diesen Ereignissen setzt der Player die Rate gern selbst zurück (Spulen, Resume, Qualitätswechsel).
    const MEDIA_EVENTS = [ "loadedmetadata", "play", "playing", "seeking", "seeked" ];
    const transformSpeedKeys = {
      "s" : ( speed ) => speed - STEP,
      "d" : ( speed ) => speed + STEP,
      "r" : ( _speed ) => 1,
    };
    const isForbiddenTarget = ( target ) =>
      [ "input", "textarea", "select" ].includes( target?.localName ) || target?.isContentEditable;

    let videoElm;
    let restores = 0;

    const clamp = ( s ) => Math.max( MIN, Math.min( Number( s ) || 1, MAX ) );
    const storedSpeed = () => clamp( GM_getValue( SPEED_KEY, 1 ) );
    const playerApi = () => document.getElementById?.( "movie_player" );
    const isResetRate = ( rate ) => Math.abs( rate - 1 ) <= EPS;

    /**
     * Rate schreiben. Über die YouTube-Player-API gesetzt bleibt der Wert beim Spulen erhalten;
     * das direkte Setzen am Element ist der Fallback für alle anderen Seiten.
     * defaultPlaybackRate wird mitgezogen, damit ein Player-Reset den Wert nicht überschreibt.
     */
    const writeRate = ( vE, rate ) => {
      const p = playerApi();
      if ( p && typeof p.setPlaybackRate === "function" ) {
        try { p.setPlaybackRate( rate ); } catch ( e ) { log( "Player-API nicht nutzbar", e ); }
      }
      if ( Math.abs( vE.playbackRate - rate ) > EPS ) vE.playbackRate = rate;
      if ( Math.abs( vE.defaultPlaybackRate - rate ) > EPS ) vE.defaultPlaybackRate = rate;
    };

    /**
     * Gespeicherte Rate durchsetzen, ohne sie erneut zu speichern.
     * Läuft nach jedem Medien-Ereignis und bei jedem fremden ratechange.
     */
    const keepRate = ( vE ) => {
      const want = storedSpeed();
      if ( !vE || Math.abs( vE.playbackRate - want ) <= EPS ) return;
      if ( restores >= MAX_RESTORES ) return;
      restores++;
      log( `Player setzte ${vE.playbackRate}, stelle ${want} wieder her` );
      writeRate( vE, want );
    };

    const speed = {
      setApply: ( s = storedSpeed(), vElm = null ) => {
        const vE = vElm ?? videoElm ?? getFirstVideElm();
        if ( !vE ) {
          log( "No video element found on page" );
          return;
        }
        s = clamp( s );
        restores = 0;
        GM_setValue( SPEED_KEY, s );
        if ( Math.abs( vE.playbackRate - s ) <= EPS ) return;
        easyToast.success( s.toFixed( 2 ) );
        writeRate( vE, s );
      },
      get: storedSpeed,
      reset: () => speed.setApply( 1 ),
    };
    const findRoots = ( ele ) => {
      return [
        ele,
        ...ele.querySelectorAll('*')
      ].filter(e => !!e.shadowRoot)
       .flatMap(e => [e.shadowRoot, ...findRoots(e.shadowRoot)]);
    };
    const getFirstVideElm = () => {
      let video = document.querySelector('video');
      if (video) return video;
      let shadowElems = document.body ? findRoots(document.body) : [];
      for (const elm of shadowElems) {
        video = elm.querySelector('video');
        if (video) return video;
      }
      return null;
    };
    const registerShortcutKeys = () => {
      document.removeEventListener("keydown", handlePressedKey, true);
      document.addEventListener("keydown", handlePressedKey, true);
    };
    const handlePressedKey = (e) => {
      if (isForbiddenTarget(e.target)) return;
      const fn = transformSpeedKeys[e.key];
      if (!fn) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "r") {
        speed.reset();
      } else {
        speed.setApply(fn(speed.get()));
      }
    };
    /** Spulen/Resume: gespeicherte Rate nachziehen, statt sie zu verlieren. */
    const onMedia = (e) => {
      const vE = e.target;
      if (vE?.localName !== "video") return;
      videoElm = vE;
      restores = 0;
      keepRate(vE);
    };
    /**
     * Fremde Rate-Änderung. Zurücksetzen auf 1.00 gilt als Player-Reset (Spulen, Qualitätswechsel,
     * Resume) und wird sofort korrigiert. Jeder andere Wert kommt aus dem Player-Menü und wird übernommen.
     */
    const onRateChange = (e) => {
      const vE = e.target;
      if (vE?.localName !== "video") return;
      const rate = vE.playbackRate;
      if (Math.abs(rate - storedSpeed()) <= EPS) return;
      if (isResetRate(rate)) {
        keepRate(vE);
        return;
      }
      videoElm = vE;
      GM_setValue(SPEED_KEY, clamp(rate));
    };
    return {
      init: () => {
        registerShortcutKeys();
        MEDIA_EVENTS.forEach(type => document.addEventListener(type, onMedia, true));
        document.addEventListener("ratechange", onRateChange, true);
        const initialVideo = getFirstVideElm();
        if (initialVideo) {
          videoElm = initialVideo;
          keepRate(initialVideo);
          log("Initial video found");
        }
        setTimeout(() => registerShortcutKeys(), 3000);
        document.addEventListener("playing", () => registerShortcutKeys(), { capture: true, once: true });
        document.addEventListener("DOMContentLoaded", () => setTimeout(() => registerShortcutKeys(), 3000));
        GM_registerMenuCommand("Langsamer (Hotkey: s)", () => speed.setApply(speed.get() - STEP));
        GM_registerMenuCommand("Schneller (Hotkey: d)", () => speed.setApply(speed.get() + STEP));
        GM_registerMenuCommand("Reset (Hotkey: r)", speed.reset);
      }
    };
  })();
  videoPlaybackControl.init();
})();
