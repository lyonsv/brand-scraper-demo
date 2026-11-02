/*
 * Brand extractor — runs INSIDE the scanned page via page.evaluate().
 *
 * This file is deliberately plain JavaScript: it is read from disk as a string and evaluated
 * as `(<this function>)(options)`. Keeping it out of the TS/bundler pipeline avoids helpers
 * such as esbuild's `__name` being injected into code that has to run in a foreign page.
 * It must be a single self-contained function expression with no imports or closures.
 */
(function extractBrand(options) {
  "use strict";
  var opts = options || {};
  var MAX_ELEMENTS = opts.maxElements || 6000;
  var hostName = (location.hostname || "").replace(/^www\./, "").split(".")[0].toLowerCase();

  function txt(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }
  function px(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  function alphaOf(c) {
    if (!c || c === "transparent") return 0;
    var m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var parts = m[1].split(/[\s,\/]+/).filter(Boolean);
      if (parts.length >= 4) {
        var a = parts[3];
        return a.indexOf("%") > -1 ? parseFloat(a) / 100 : parseFloat(a);
      }
      return 1;
    }
    var slash = c.match(/\/\s*([\d.]+%?)\s*\)\s*$/);
    if (slash) return slash[1].indexOf("%") > -1 ? parseFloat(slash[1]) / 100 : parseFloat(slash[1]);
    return 1;
  }
  function add(map, key, w) {
    if (!key || !(w > 0)) return;
    map[key] = (map[key] || 0) + w;
  }
  function isVisible(el, cs) {
    if (!el.getClientRects().length) return false;
    cs = cs || getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) < 0.1) return false;
    var r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }
  function closestTag(el, sel) {
    try {
      return !!el.closest(sel);
    } catch {
      return false;
    }
  }
  function abs(u) {
    try {
      return new URL(u, location.href).href;
    } catch {
      return "";
    }
  }
  function ownText(el) {
    var s = "";
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) s += n.nodeValue;
    }
    return txt(s);
  }
  function attrBlob(el) {
    var cls = typeof el.className === "string" ? el.className : el.getAttribute("class") || "";
    return [
      el.id,
      cls,
      el.getAttribute("alt"),
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("src"),
      el.getAttribute("data-testid"),
    ]
      .join(" ")
      .toLowerCase();
  }

  /* -------------------------------------------------------------- */
  /* Text helpers that ignore aria-hidden / visually hidden copies     */
  /* -------------------------------------------------------------- */
  var SR_CLASS = /(^|[\s_-])(sr-only|visually-?hidden|screen-?reader(-text)?|a11y-hidden|assistive-text|offscreen)($|[\s_-])/i;
  function isSrOnly(el) {
    var cls = typeof el.className === "string" ? el.className : el.getAttribute("class") || "";
    if (SR_CLASS.test(cls)) return true;
    var cs = getComputedStyle(el);
    if (cs.clipPath === "inset(50%)" || /^rect\(0(px)?,? 0(px)?/.test(cs.clip || "")) return true;
    if (cs.position === "absolute" || cs.position === "fixed") {
      var r = el.getBoundingClientRect();
      if (r.width <= 2 && r.height <= 2) return true;
      if (r.right < 0 || r.bottom < -window.scrollY - 1000 || r.left > window.innerWidth + 100) return true;
    }
    return false;
  }
  function collapseRepeat(s) {
    if (s.length >= 4) {
      if (s.length % 2 === 1) {
        var mid = (s.length - 1) / 2;
        if (s.charAt(mid) === " " && s.slice(0, mid) === s.slice(mid + 1)) return s.slice(0, mid);
      } else if (s.slice(0, s.length / 2) === s.slice(s.length / 2)) {
        return s.slice(0, s.length / 2);
      }
    }
    return s;
  }
  /** innerText with some descendants temporarily removed from layout. */
  function textWithout(el, shouldHide) {
    var hidden = [];
    var kids = el.querySelectorAll("*");
    for (var k = 0; k < kids.length && k < 400; k++) {
      var kid = kids[k];
      if (shouldHide(kid)) hidden.push([kid, kid.style.getPropertyValue("display"), kid.style.getPropertyPriority("display")]);
    }
    for (var h = 0; h < hidden.length; h++) hidden[h][0].style.setProperty("display", "none", "important");
    var out = txt(el.innerText);
    for (var h2 = 0; h2 < hidden.length; h2++) {
      if (hidden[h2][1]) hidden[h2][0].style.setProperty("display", hidden[h2][1], hidden[h2][2]);
      else hidden[h2][0].style.removeProperty("display");
    }
    return out;
  }
  /**
   * Visible text without aria-hidden / sr-only duplicates, with "X X" repeats collapsed. When the
   * visible copy is aria-hidden (animated headlines), fall back to the screen-reader copy.
   */
  function cleanText(el) {
    if (!el.querySelector("*")) return collapseRepeat(txt(el.innerText));
    var visible = textWithout(el, function (n) {
      return n.getAttribute("aria-hidden") === "true" || isSrOnly(n);
    });
    if (visible) return collapseRepeat(visible);
    return collapseRepeat(
      textWithout(el, function (n) {
        return n.getAttribute("aria-hidden") === "true";
      }),
    );
  }
  function hiddenFromUsers(el) {
    return isSrOnly(el) || closestTag(el, "[aria-hidden=true]");
  }

  /* -------------------------------------------------------------- */
  /* Walk visible elements once                                       */
  /* -------------------------------------------------------------- */
  var all = document.body ? document.body.getElementsByTagName("*") : [];
  var textColors = {};
  var borderColors = {};
  var families = {};
  var headingFamilies = {};
  var radii = {};
  var spacing = {};
  var shadows = {};
  var typeBuckets = {};
  var textElementCount = 0;
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, META: 1, LINK: 1, HEAD: 1, path: 1, g: 1 };
  var TYPE_TAGS = { H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, P: 1, SMALL: 1 };

  var limit = Math.min(all.length, MAX_ELEMENTS);
  for (var i = 0; i < limit; i++) {
    var el = all[i];
    if (SKIP[el.tagName]) continue;
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    var rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;

    var own = ownText(el);
    var fontSize = px(cs.fontSize);
    if (own.length > 1) {
      textElementCount++;
      var w = own.length;
      add(textColors, cs.color, w * Math.max(0.5, fontSize / 16));
      add(families, cs.fontFamily, w);
      var isHeading = /^H[1-3]$/.test(el.tagName) || fontSize >= 28;
      if (isHeading) add(headingFamilies, cs.fontFamily, w);
    }

    if (TYPE_TAGS[el.tagName] && !hiddenFromUsers(el)) {
      var t = cleanText(el);
      if (t.length > 1) {
        var key = el.tagName + "|" + fontSize + "|" + cs.fontWeight + "|" + cs.fontFamily;
        var b = typeBuckets[key];
        if (!b) {
          b = typeBuckets[key] = {
            tag: el.tagName.toLowerCase(),
            fontSize: fontSize,
            fontWeight: cs.fontWeight,
            lineHeight: cs.lineHeight,
            letterSpacing: cs.letterSpacing,
            fontFamily: cs.fontFamily,
            color: cs.color,
            text: t.slice(0, 80),
            count: 0,
          };
        }
        b.count += Math.min(t.length, 400);
      }
    }

    var bw = px(cs.borderTopWidth) + px(cs.borderBottomWidth) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
    if (bw > 0 && cs.borderTopStyle !== "none" && alphaOf(cs.borderTopColor) > 0.2) {
      add(borderColors, cs.borderTopColor, Math.min(40, (rect.width + rect.height) / 50));
    }

    var hasBg = alphaOf(cs.backgroundColor) > 0.1 || cs.backgroundImage !== "none";
    if ((hasBg || bw > 0 || cs.boxShadow !== "none") && cs.borderTopLeftRadius && cs.borderTopLeftRadius !== "0px") {
      var r = px(cs.borderTopLeftRadius);
      var rv = cs.borderTopLeftRadius.indexOf("%") > -1 || r >= Math.min(rect.width, rect.height) / 2 - 1 ? "9999px" : Math.round(r) + "px";
      if (r > 0) add(radii, rv, 1);
    }
    if (cs.boxShadow && cs.boxShadow !== "none") add(shadows, cs.boxShadow, 1);

    if (cs.display.indexOf("flex") > -1 || cs.display.indexOf("grid") > -1 || cs.display === "block") {
      var vals = [cs.paddingTop, cs.paddingLeft, cs.rowGap, cs.columnGap];
      for (var v = 0; v < vals.length; v++) {
        var n = px(vals[v]);
        if (n >= 4 && n <= 160) add(spacing, String(Math.round(n / 4) * 4), 1);
      }
    }
  }

  /* -------------------------------------------------------------- */
  /* CTA buttons & links                                              */
  /* -------------------------------------------------------------- */
  var CTA_WORDS = /(get started|start|sign ?up|try|contact|book|demo|buy|join|download|free|subscribe|shop|learn more|explore|apply|create|request|deploy|order|register)/i;
  var NON_CTA = /^(accept( all)?( cookies)?|reject( all)?|decline|allow( all)?( cookies)?|cookie (settings|preferences)|manage (cookies|preferences)|close|menu|search|open menu|main navigation menu|toggle navigation|previous|next|play|pause|home|search|your library|library|browse|back|forward)$/i;
  var LANG = /^(english|español|espanol|deutsch|français|francais|italiano|português|portugues|nederlands|日本語|한국어|中文|简体中文|繁體中文|русский|language|languages)\b|\((us|uk|gb|ca|au|in)\)$|^[a-z]{2}(-[a-z]{2})?$/i;
  var CONSENT = /(cookie|consent|gdpr|onetrust|didomi|usercentrics|truste|osano|cmp|privacy-banner|ccpa)/i;
  function inConsent(el) {
    var p = el;
    for (var d = 0; p && d < 10; d++, p = p.parentElement) {
      var c = (typeof p.className === "string" ? p.className : "") + " " + (p.id || "") + " " + (p.getAttribute("aria-label") || "");
      if (CONSENT.test(c)) return true;
    }
    return false;
  }
  var SOCIAL = /(facebook|twitter|x\.com\/|instagram|linkedin|youtube|tiktok|pinterest|threads\.net|discord\.(gg|com)|github\.com|reddit\.com|mastodon|bsky\.app|wa\.me|whatsapp)/i;
  var buttons = [];
  var seenBtn = {};
  var btnEls = document.querySelectorAll(
    "button, a, [role=button], input[type=submit], input[type=button]",
  );
  for (var bi = 0; bi < btnEls.length && bi < 3000; bi++) {
    var be = btnEls[bi];
    var bcs = getComputedStyle(be);
    if (!isVisible(be, bcs)) continue;
    var br = be.getBoundingClientRect();
    if (br.width < 40 || br.width > 520 || br.height < 24 || br.height > 96) continue;
    if (be.hasAttribute("aria-haspopup") || be.hasAttribute("aria-expanded") || be.hasAttribute("aria-controls")) continue;
    if (hiddenFromUsers(be)) continue;
    if (closestTag(be, "[role=dialog], [aria-modal=true], [role=alertdialog]")) continue;
    if (inConsent(be)) continue;
    var label = cleanText(be) || txt(be.value || be.getAttribute("aria-label"));
    if (label.length < 2 || label.length > 40) continue;
    var hrefAttr = be.getAttribute("href") || "";
    if (/^(skip|jump) to|main content|^skip$/i.test(label) || (hrefAttr.charAt(0) === "#" && /skip|main|content/i.test(hrefAttr + " " + label))) continue;
    if (NON_CTA.test(label) || LANG.test(label) || /lang|locale|language|country|region/i.test(attrBlob(be))) continue;
    // tabs, chips and badges are not buttons: too small or too tight
    if (px(bcs.fontSize) < 13) continue;
    if (px(bcs.paddingTop) < 6 && br.height < 36) continue;
    if (SOCIAL.test(hrefAttr)) continue;
    var inNav = closestTag(be, "nav, [role=navigation], [role=tablist], [role=tab]");
    if (inNav && !CTA_WORDS.test(label)) continue;
    var bgA = alphaOf(bcs.backgroundColor);
    var bBw = px(bcs.borderTopWidth);
    var ghost = bgA < 0.5 && bBw > 0 && alphaOf(bcs.borderTopColor) > 0.3;
    if (bgA < 0.5 && !ghost) continue;
    var top = br.top + window.scrollY;
    var inHeader = closestTag(be, "header, nav, [role=banner]");
    var score = 0;
    if (bgA >= 0.5) score += 3;
    if (top < 900) score += 3;
    if (!inHeader && top < 1100) score += 3;
    if (inHeader) score += 1;
    if (br.height >= 40) score += 1;
    if (CTA_WORDS.test(label)) score += 2;
    if (px(bcs.paddingLeft) >= 12) score += 1;
    var key2 = bcs.backgroundColor + "|" + label;
    if (seenBtn[key2]) continue;
    seenBtn[key2] = 1;
    buttons.push({
      text: label,
      bg: bgA >= 0.5 ? bcs.backgroundColor : "transparent",
      color: bcs.color,
      borderColor: bcs.borderTopColor,
      borderWidth: bBw,
      borderRadius: bcs.borderTopLeftRadius,
      paddingX: px(bcs.paddingLeft),
      paddingY: px(bcs.paddingTop),
      fontSize: px(bcs.fontSize),
      fontWeight: bcs.fontWeight,
      fontFamily: bcs.fontFamily,
      textTransform: bcs.textTransform,
      letterSpacing: bcs.letterSpacing,
      boxShadow: bcs.boxShadow,
      height: Math.round(br.height),
      width: Math.round(br.width),
      top: Math.round(top),
      inHeader: inHeader,
      cta: CTA_WORDS.test(label),
      score: score,
    });
  }
  buttons.sort(function (a, b) {
    return b.score - a.score || a.top - b.top;
  });
  buttons = buttons.slice(0, 30);

  var linkMap = {};
  var anchors = document.querySelectorAll("main a, article a, p a, section a, footer a");
  for (var ai = 0; ai < anchors.length && ai < 1500; ai++) {
    var a = anchors[ai];
    var acs = getComputedStyle(a);
    if (alphaOf(acs.backgroundColor) > 0.1) continue;
    if (!isVisible(a, acs)) continue;
    var at = txt(a.innerText);
    if (at.length < 2 || at.length > 80) continue;
    var lk = acs.color + "|" + acs.textDecorationLine + "|" + acs.fontWeight;
    if (!linkMap[lk]) linkMap[lk] = { color: acs.color, textDecoration: acs.textDecorationLine, fontWeight: acs.fontWeight, count: 0 };
    linkMap[lk].count += closestTag(a, "p") ? 3 : 1;
  }
  var links = Object.keys(linkMap)
    .map(function (k) {
      return linkMap[k];
    })
    .sort(function (a, b) {
      return b.count - a.count;
    })
    .slice(0, 8);

  /* -------------------------------------------------------------- */
  /* CSS custom properties on :root / html / body                     */
  /* -------------------------------------------------------------- */
  var cssVars = {};
  var varCount = 0;
  var rootCs = getComputedStyle(document.documentElement);
  function walkRules(rules) {
    for (var ri = 0; ri < rules.length && varCount < 600; ri++) {
      var rule = rules[ri];
      if (rule.cssRules && !rule.selectorText) {
        try {
          walkRules(rule.cssRules);
        } catch {}
        continue;
      }
      if (!rule.selectorText || !rule.style) continue;
      if (!/(^|,)\s*(:root|html|body)\s*(,|$)/.test(rule.selectorText)) continue;
      for (var si = 0; si < rule.style.length; si++) {
        var prop = rule.style[si];
        if (prop.indexOf("--") !== 0) continue;
        var val = rootCs.getPropertyValue(prop).trim() || rule.style.getPropertyValue(prop).trim();
        if (val && val.length < 120 && !cssVars[prop]) {
          cssVars[prop] = val;
          varCount++;
        }
      }
    }
  }
  for (var ss = 0; ss < document.styleSheets.length; ss++) {
    try {
      walkRules(document.styleSheets[ss].cssRules || []);
    } catch {
      /* cross-origin sheet; the server parses those from the network response instead */
    }
  }

  /* -------------------------------------------------------------- */
  /* Fonts                                                            */
  /* -------------------------------------------------------------- */
  var fontFaces = [];
  try {
    document.fonts.forEach(function (f) {
      if (f.status === "loaded") {
        fontFaces.push({ family: f.family.replace(/^["']|["']$/g, ""), weight: String(f.weight), style: f.style });
      }
    });
  } catch {}

  var typeSamples = Object.keys(typeBuckets).map(function (k) {
    return typeBuckets[k];
  });

  /* -------------------------------------------------------------- */
  /* Logo candidates                                                  */
  /* -------------------------------------------------------------- */
  function serializeSvg(svg) {
    var clone = svg.cloneNode(true);
    var srcEls = svg.querySelectorAll("*");
    var dstEls = clone.querySelectorAll("*");
    for (var k = 0; k < srcEls.length && k < dstEls.length; k++) {
      var scs = getComputedStyle(srcEls[k]);
      var d = dstEls[k];
      if (scs.fill && scs.fill !== "none" && !/^url\(/.test(scs.fill)) d.setAttribute("fill", scs.fill);
      if (scs.stroke && scs.stroke !== "none" && !/^url\(/.test(scs.stroke)) d.setAttribute("stroke", scs.stroke);
      if (d.tagName.toLowerCase() === "use") {
        var ref = d.getAttribute("href") || d.getAttribute("xlink:href");
        if (ref && ref.charAt(0) === "#") {
          var target = document.getElementById(ref.slice(1));
          if (target) {
            var g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            for (var c = 0; c < target.childNodes.length; c++) g.appendChild(target.childNodes[c].cloneNode(true));
            g.setAttribute("fill", scs.fill && scs.fill !== "none" ? scs.fill : "currentColor");
            if (!clone.getAttribute("viewBox") && target.getAttribute("viewBox")) clone.setAttribute("viewBox", target.getAttribute("viewBox"));
            d.parentNode.replaceChild(g, d);
          }
        }
      }
    }
    var rootStyle = getComputedStyle(svg);
    var rr = svg.getBoundingClientRect();
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", "0 0 " + Math.round(rr.width) + " " + Math.round(rr.height));
    clone.setAttribute("width", String(Math.round(rr.width)));
    clone.setAttribute("height", String(Math.round(rr.height)));
    if (rootStyle.fill && rootStyle.fill !== "none" && !clone.getAttribute("fill")) clone.setAttribute("fill", rootStyle.fill);
    clone.setAttribute("color", rootStyle.color);
    clone.removeAttribute("class");
    clone.removeAttribute("style");
    var out = new XMLSerializer().serializeToString(clone);
    out = out.replace(/currentColor/g, rootStyle.color);
    // strip anything executable
    out = out.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, "");
    return out;
  }

  var logoEls = document.querySelectorAll("img, svg, [class*=logo] img, [class*=logo] svg");
  var logos = [];
  var logoNodes = [];
  for (var li = 0; li < logoEls.length && li < 400; li++) {
    var le = logoEls[li];
    if (le.tagName.toLowerCase() === "svg" && le.parentElement && le.parentElement.closest("svg")) continue;
    if (logoNodes.indexOf(le) > -1) continue;
    var lcs = getComputedStyle(le);
    if (!isVisible(le, lcs)) continue;
    var lr = le.getBoundingClientRect();
    var ltop = lr.top + window.scrollY;
    var inHead = closestTag(le, "header, nav, [role=banner]");
    if (ltop > 260 && !inHead) continue;
    if (lr.width < 16 || lr.height < 10 || lr.width > 420 || lr.height > 200) continue;
    var reasons = [];
    var sc = 0;
    if (inHead) {
      sc += 3;
      reasons.push("inside header/nav");
    }
    var blob = attrBlob(le);
    var parent = le.parentElement;
    for (var up = 0; up < 3 && parent; up++) {
      blob += " " + attrBlob(parent);
      parent = parent.parentElement;
    }
    if (/logo|brand|wordmark/.test(blob)) {
      sc += 4;
      reasons.push("'logo/brand' in attributes");
    }
    if (hostName && hostName.length > 2 && blob.indexOf(hostName) > -1) {
      sc += 1;
      reasons.push("mentions site name");
    }
    var link = le.closest("a");
    if (link) {
      var href = link.getAttribute("href") || "";
      var resolved = abs(href);
      if (href === "/" || href === "./" || resolved === location.origin + "/" || resolved.replace(/\/$/, "") === location.origin) {
        sc += 3;
        reasons.push("links to home");
      }
    }
    if (lr.left < window.innerWidth * 0.33 && ltop < 160) {
      sc += 2;
      reasons.push("top-left");
    }
    var ratio = lr.width / lr.height;
    if (ratio >= 0.8 && ratio <= 8) {
      sc += 1;
      reasons.push("logo-like aspect ratio");
    }
    if (lr.width <= 24 && lr.height <= 24) sc -= 3; // UI icons
    if (closestTag(le, "button")) sc -= 2;
    var labelBlob = (le.getAttribute("alt") || "") + " " + (link ? link.innerText || "" : "");
    if (/(sign in|log ?in|sign up|menu|search|close|cart|account)/i.test(labelBlob) && !/logo|brand/i.test(attrBlob(le))) continue;
    if (sc < 3) continue;
    var cand = {
      kind: le.tagName.toLowerCase() === "svg" ? "svg" : "img",
      alt: txt(le.getAttribute("alt") || le.getAttribute("aria-label") || (link && link.getAttribute("aria-label")) || ""),
      width: Math.round(lr.width),
      height: Math.round(lr.height),
      score: sc,
      reasons: reasons,
    };
    try {
      if (cand.kind === "svg") cand.svg = serializeSvg(le);
      else cand.src = abs(le.currentSrc || le.src);
    } catch {
      continue;
    }
    if (cand.kind === "svg" && (!cand.svg || cand.svg.length > 200000)) continue;
    logos.push(cand);
    logoNodes.push(le);
  }
  var order = logos.map(function (_, idx) {
    return idx;
  });
  order.sort(function (a, b) {
    return logos[b].score - logos[a].score;
  });
  var sortedLogos = order.slice(0, 6).map(function (idx) {
    return logos[idx];
  });
  var prev = document.querySelectorAll("[data-bs-logo]");
  for (var pi = 0; pi < prev.length; pi++) prev[pi].removeAttribute("data-bs-logo");
  if (order.length) logoNodes[order[0]].setAttribute("data-bs-logo", "1");

  /* -------------------------------------------------------------- */
  /* Icons, manifest, og:image                                        */
  /* -------------------------------------------------------------- */
  var icons = [];
  var iconLinks = document.querySelectorAll("link[rel~=icon], link[rel=apple-touch-icon], link[rel=apple-touch-icon-precomposed], link[rel=mask-icon]");
  for (var ii = 0; ii < iconLinks.length; ii++) {
    var il = iconLinks[ii];
    var ih = abs(il.getAttribute("href"));
    if (ih) icons.push({ rel: il.getAttribute("rel"), href: ih, sizes: il.getAttribute("sizes") || undefined });
  }
  var manifestEl = document.querySelector("link[rel=manifest]");
  var ogEl = document.querySelector("meta[property='og:image'], meta[name='og:image'], meta[name='twitter:image']");
  var siteNameEl = document.querySelector("meta[property='og:site_name'], meta[name='application-name'], meta[name='apple-mobile-web-app-title']");
  var descEl = document.querySelector("meta[name=description], meta[property='og:description']");

  /* -------------------------------------------------------------- */
  /* Imagery                                                          */
  /* -------------------------------------------------------------- */
  var images = [];
  var seenImg = {};
  var imgs = document.querySelectorAll("img");
  for (var mi = 0; mi < imgs.length && mi < 800; mi++) {
    var im = imgs[mi];
    if (logoNodes.indexOf(im) > -1) continue;
    var ir = im.getBoundingClientRect();
    if (ir.width < 150 || ir.height < 110 || ir.width * ir.height < 24000) continue;
    if (closestTag(im, "header, nav")) continue;
    var isrc = abs(im.currentSrc || im.src);
    if (!isrc || /^data:/.test(isrc) || seenImg[isrc]) continue;
    if (im.naturalWidth && im.naturalWidth < 200) continue;
    seenImg[isrc] = 1;
    images.push({ src: isrc, alt: txt(im.alt), width: Math.round(ir.width), height: Math.round(ir.height) });
  }
  images.sort(function (a, b) {
    return b.width * b.height - a.width * a.height;
  });
  images = images.slice(0, 8);

  /* -------------------------------------------------------------- */
  /* Voice                                                            */
  /* -------------------------------------------------------------- */
  function visibleTexts(sel, max, minLen, maxLen) {
    var out = [];
    var els = document.querySelectorAll(sel);
    for (var q = 0; q < els.length && out.length < max; q++) {
      var e = els[q];
      if (!isVisible(e) || hiddenFromUsers(e)) continue;
      var tx = cleanText(e);
      if (tx.length >= minLen && tx.length <= maxLen && out.indexOf(tx) === -1) out.push(tx);
    }
    return out;
  }
  var ctaLabels = [];
  for (var ci = 0; ci < buttons.length && ctaLabels.length < 8; ci++) {
    if (ctaLabels.indexOf(buttons[ci].text) === -1) ctaLabels.push(buttons[ci].text);
  }

  return {
    title: txt(document.title),
    siteName: siteNameEl ? txt(siteNameEl.getAttribute("content")) : "",
    description: descEl ? txt(descEl.getAttribute("content")) : "",
    lang: document.documentElement.lang || "",
    bgColors: {},
    textColors: textColors,
    borderColors: borderColors,
    cssVars: cssVars,
    buttons: buttons,
    links: links,
    fontFaces: fontFaces,
    families: families,
    headingFamilies: headingFamilies,
    typeSamples: typeSamples,
    radii: radii,
    spacing: spacing,
    shadows: shadows,
    logos: sortedLogos,
    icons: icons,
    manifestUrl: manifestEl ? abs(manifestEl.getAttribute("href")) : undefined,
    ogImage: ogEl ? abs(ogEl.getAttribute("content")) : undefined,
    images: images,
    h1: visibleTexts("h1", 3, 2, 200),
    headings: visibleTexts("h2, h3", 6, 3, 140),
    ctaLabels: ctaLabels,
    paragraphs: visibleTexts("p", 24, 30, 600),
    textElementCount: textElementCount,
  };
})
