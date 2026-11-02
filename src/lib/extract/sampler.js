/*
 * Background-colour grid sampler — runs INSIDE the scanned page via page.evaluate().
 * Plain JS on purpose (see extractor.js). Samples the current viewport on a grid with
 * elementFromPoint and walks up to the first element with an opaque-ish background.
 */
(function sampleBackgrounds(options) {
  "use strict";
  var cols = (options && options.cols) || 24;
  var rows = (options && options.rows) || 15;
  var W = window.innerWidth;
  var H = window.innerHeight;
  var colors = {};
  var points = 0;
  function alphaOf(c) {
    if (!c || c === "transparent") return 0;
    var m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var parts = m[1].split(/[\s,\/]+/).filter(Boolean);
      return parts.length >= 4 ? parseFloat(parts[3]) : 1;
    }
    var slash = c.match(/\/\s*([\d.]+)%?\s*\)\s*$/);
    return slash ? parseFloat(slash[1]) : 1;
  }
  var rootBg = getComputedStyle(document.documentElement).backgroundColor;
  var bodyBg = document.body ? getComputedStyle(document.body).backgroundColor : "";
  var fallback = alphaOf(bodyBg) > 0.5 ? bodyBg : alphaOf(rootBg) > 0.5 ? rootBg : "rgb(255, 255, 255)";
  for (var y = 0; y < rows; y++) {
    for (var x = 0; x < cols; x++) {
      var px = Math.round(((x + 0.5) / cols) * W);
      var py = Math.round(((y + 0.5) / rows) * H);
      var el = document.elementFromPoint(px, py);
      var found = "";
      var depth = 0;
      while (el && depth < 40) {
        var cs = getComputedStyle(el);
        if (alphaOf(cs.backgroundColor) >= 0.5) {
          found = cs.backgroundColor;
          break;
        }
        el = el.parentElement;
        depth++;
      }
      points++;
      var c = found || fallback;
      colors[c] = (colors[c] || 0) + 1;
    }
  }
  return { colors: colors, points: points };
})
