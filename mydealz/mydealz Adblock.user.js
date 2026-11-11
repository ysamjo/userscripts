// ==UserScript==
// @name         mydealz Werbebanner Blocker
// @namespace    local.mydealz.adblock
// @version      1.0.0
// @description  Blendet Werbebanner, Ad-Slots und Campaign-Banner (Black Friday etc.) auf mydealz.de aus.
// @match        https://www.mydealz.de/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // EINSTELLUNGEN — true = ausblenden
  // ---------------------------------------------------------------------------
  const CFG = {
    eventThemingBanner: true,    // Black-Friday / Campaign-Banner (oberer Banner mit Countdown)
    headerAdSlot: true,          // Ad im Header-Bereich
    leftSideAdSlot: true,        // Ad in linker Seitenleiste
    leftStickyAdSlot: true,      // Sticky-Ad links
    rightStickyAdSlot: true,     // Sticky-Ad rechts
    browserExtensionBanner: true,// Browser-Extension-Banner
  };

  // ---------------------------------------------------------------------------
  // Selektoren — exakt auf mydealz-Struktur abgestimmt
  // ---------------------------------------------------------------------------
  const SELECTORS = {
    eventThemingBanner: [
      '#eventThemingPortal',
      '[data-t="eventPromotionHeader"]',
    ],
    headerAdSlot: [
      '#headerAdSlotPortal',
    ],
    leftSideAdSlot: [
      '#leftSideAdSlotPortal',
    ],
    leftStickyAdSlot: [
      '#leftStickyAdSlotPortal',
    ],
    rightStickyAdSlot: [
      '#rightStickyAdSlotPortal',
    ],
    browserExtensionBanner: [
      '#browserExtensionBannerPortal',
    ],
  };

  // ---------------------------------------------------------------------------
  // CSS einbauen
  // ---------------------------------------------------------------------------
  const style = document.createElement('style');
  style.id = 'mydealz-adblock-style';
  document.head.appendChild(style);

  function applyCss() {
    const selectors = [];

    if (CFG.eventThemingBanner) selectors.push(...SELECTORS.eventThemingBanner);
    if (CFG.headerAdSlot)       selectors.push(...SELECTORS.headerAdSlot);
    if (CFG.leftSideAdSlot)     selectors.push(...SELECTORS.leftSideAdSlot);
    if (CFG.leftStickyAdSlot)   selectors.push(...SELECTORS.leftStickyAdSlot);
    if (CFG.rightStickyAdSlot)  selectors.push(...SELECTORS.rightStickyAdSlot);
    if (CFG.browserExtensionBanner) selectors.push(...SELECTORS.browserExtensionBanner);

    style.textContent = `${selectors.join(',\n')} {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      overflow: hidden !important;
      margin: 0 !important;
      padding: 0 !important;
    }`;
  }

  applyCss();

  // MutationObserver: dynamisch geladene Banner-Elemente entfernen
  const TARGET_IDS = new Set([
    'eventThemingPortal',
    'headerAdSlotPortal',
    'leftSideAdSlotPortal',
    'leftStickyAdSlotPortal',
    'rightStickyAdSlotPortal',
    'browserExtensionBannerPortal',
  ]);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const el of m.addedNodes) {
        if (el.nodeType !== 1) continue;
        if (TARGET_IDS.has(el.id)) el.remove();
        else if (el.getAttribute?.('data-t') === 'eventPromotionHeader') el.remove();
      }
    }
  });

  const startObserver = () => {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true });
})();
