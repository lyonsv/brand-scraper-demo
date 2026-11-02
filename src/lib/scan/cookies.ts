import type { Page } from "playwright";

const KNOWN_SELECTORS = [
  "#onetrust-accept-btn-handler",
  "#accept-recommended-btn-handler",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  "#didomi-notice-agree-button",
  "#truste-consent-button",
  "#sp-cc-accept",
  "[data-testid='uc-accept-all-button']",
  ".osano-cm-accept-all",
  ".cc-allow",
  ".cc-btn.cc-dismiss",
  ".fc-cta-consent",
  ".qc-cmp2-summary-buttons button[mode='primary']",
  "[data-cookiebanner='accept_button']",
  "button[data-gdpr-consent='accept']",
  ".cky-btn-accept",
  ".iubenda-cs-accept-btn",
  "#cookie-accept",
  "#accept-cookies",
];

export interface CookieResult {
  method: "selector" | "role" | "overlay" | "none";
  detail: string;
  hidden: number;
}

// Plain JS strings evaluated in the page (see extract/extractor.js for why).
const FIND_KNOWN = `(function (sels) {
  for (var i = 0; i < sels.length; i++) {
    var el = document.querySelector(sels[i]);
    if (el && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden") return sels[i];
  }
  return null;
})`;

const MARK_BY_TEXT = `(function () {
  var re = /^(accept( all)?( cookies)?|allow( all)?( cookies)?|i agree|agree( and close)?|got it|ok(ay)?|i understand|accept and close|accept & close|reject all|decline( all)?|only necessary|necessary only)[.!]?$/i;
  var ctx = /(cookie|consent|gdpr|privacy|cmp|banner)/i;
  var els = document.querySelectorAll("button, a, [role=button]");
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var t = (el.innerText || "").replace(/\\s+/g, " ").trim();
    if (!t || t.length > 30 || !re.test(t)) continue;
    if (!el.getClientRects().length) continue;
    var ok = false, p = el;
    for (var d = 0; p && d < 12; d++, p = p.parentElement) {
      var cs = getComputedStyle(p);
      var cls = (typeof p.className === "string" ? p.className : "") + " " + (p.id || "") + " " + (p.getAttribute("aria-label") || "");
      if (cs.position === "fixed" || cs.position === "sticky" || p.getAttribute("role") === "dialog" || p.getAttribute("aria-modal") === "true" || ctx.test(cls)) { ok = true; break; }
    }
    if (!ok) continue;
    el.setAttribute("data-bs-consent", "1");
    return t;
  }
  return null;
})`;

const HIDE_OVERLAYS = `(function () {
  var W = window.innerWidth, H = window.innerHeight, hidden = 0;
  var ctx = /(cookie|consent|gdpr|cmp|onetrust|didomi|usercentrics|truste|osano|privacy-banner)/i;
  var els = document.body ? document.body.querySelectorAll("*") : [];
  for (var i = 0; i < els.length && i < 5000; i++) {
    var el = els[i];
    var cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") continue;
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    var r = el.getBoundingClientRect();
    var area = (Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0))) / (W * H);
    var cls = (typeof el.className === "string" ? el.className : "") + " " + (el.id || "");
    var isHeader = el.tagName === "HEADER" || el.tagName === "NAV" || !!el.querySelector("nav");
    if ((area > 0.3 && !isHeader) || (ctx.test(cls) && area > 0.02)) {
      el.style.setProperty("display", "none", "important");
      hidden++;
    }
  }
  if (hidden) {
    document.documentElement.style.setProperty("overflow", "auto", "important");
    if (document.body) document.body.style.setProperty("overflow", "auto", "important");
  }
  return hidden;
})`;

export async function dismissCookieBanners(page: Page): Promise<CookieResult> {
  try {
    const sel = await page.evaluate(`${FIND_KNOWN}(${JSON.stringify(KNOWN_SELECTORS)})`);
    if (typeof sel === "string") {
      await page.locator(sel).first().click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(400);
      const hidden = Number(await page.evaluate(`${HIDE_OVERLAYS}()`)) || 0;
      return { method: "selector", detail: `Clicked the consent platform's accept button (${sel})`, hidden };
    }
    // consent dialogs inside iframes (e.g. Sourcepoint, TrustArc)
    for (const frame of page.frames()) {
      if (frame === page.mainFrame() || !/(consent|cmp|privacy|cookie|sourcepoint|trustarc)/i.test(frame.url())) continue;
      const btn = frame.getByRole("button", { name: /^(accept( all)?|allow all|agree|i agree|ok|got it)/i }).first();
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
        await btn.click({ timeout: 2000 }).catch(() => undefined);
        return { method: "role", detail: "Accepted a consent dialog inside an iframe", hidden: 0 };
      }
    }
    const label = await page.evaluate(`${MARK_BY_TEXT}()`);
    if (typeof label === "string") {
      await page.locator("[data-bs-consent]").first().click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(400);
      const hidden = Number(await page.evaluate(`${HIDE_OVERLAYS}()`)) || 0;
      return { method: "role", detail: `Clicked “${label}” in a consent banner`, hidden };
    }
    const hidden = Number(await page.evaluate(`${HIDE_OVERLAYS}()`)) || 0;
    if (hidden) return { method: "overlay", detail: `Hid ${hidden} large fixed overlay${hidden === 1 ? "" : "s"}`, hidden };
    return { method: "none", detail: "No cookie banner or blocking overlay detected", hidden: 0 };
  } catch {
    return { method: "none", detail: "Skipped cookie handling (page did not cooperate)", hidden: 0 };
  }
}
