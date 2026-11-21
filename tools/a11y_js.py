"""JavaScript the browser checks run in a page or frame: contrast where axe cannot decide (shared by check_quality and check_learn)."""

CANVAS_CONTRAST = r"""
  // axe cannot tell what is behind SVG text, so measure it here: the colour of each text on the canvas against the shapes
  // under its middle (composited from the top down, ending on the canvas paper).
  const parse = (c) => {
    if (!c || c === 'none') return null;
    let m = c.match(/^rgba?\(([^)]+)\)/);
    if (m) { const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; }
    m = c.match(/^color\(srgb ([^)]+)\)/);
    if (m) { const v = m[1].split(/[ /]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v.length > 3 ? v[3] : 1]; }
    return null;
  };
  const lum = ([r, g, b]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const paper = parse(getComputedStyle(document.querySelector('.canvas')).backgroundColor) || [243, 236, 225, 1];
  const bad = []; let n = 0;
  // A text's own letters, and each tspan (a zone tab's kind, "public subnet", is a tspan in its own colour).
  for (const t of document.querySelectorAll('svg.iso text, svg.iso tspan')) {
    if (![...t.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) || !t.getClientRects().length) continue;
    const s = getComputedStyle(t), fg = parse(s.fill);
    if (!fg || parseFloat(s.opacity) === 0) continue;
    const r = t.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    // Shapes under the text, top first; text itself and things that let the pointer through are skipped by the browser.
    const layers = document.elementsFromPoint(x, y).filter((e) => e !== t && !t.contains(e) && e.closest('svg.iso') && ['rect', 'path', 'polygon', 'circle', 'ellipse'].includes(e.tagName));
    let col = null, keep = 1, acc = [0, 0, 0];
    for (const e of layers) {
      const es = getComputedStyle(e), f = parse(es.fill);
      if (!f) continue;
      const a = f[3] * parseFloat(es.fillOpacity || '1') * parseFloat(es.opacity || '1');
      if (a <= 0) continue;
      for (let i = 0; i < 3; i++) acc[i] += keep * a * f[i];
      keep *= 1 - a;
      if (keep < 0.01) break;
    }
    col = acc.map((v, i) => v + keep * paper[i]);
    const size = parseFloat(s.fontSize), bold = parseInt(s.fontWeight, 10) >= 700, large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5, got = ratio(fg, col);
    n++;
    if (got < need) bad.push(`${t.textContent.trim().slice(0, 18)} ${got.toFixed(2)} (${s.fill} on rgb(${col.map(Math.round).join(',')}))`);
  }
  return {n, bad};
"""

PAGE_CONTRAST = r"""
  // Text outside the canvas that axe left undecided (it gives up on some backgrounds): the text colour against the first
  // solid background colour up its ancestors (semi-transparent ones composited on the way).
  const parse = (c) => {
    let m = c && c.match(/^rgba?\(([^)]+)\)/);
    if (m) { const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; }
    m = c && c.match(/^color\(srgb ([^)]+)\)/);
    if (m) { const v = m[1].split(/[ /]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v.length > 3 ? v[3] : 1]; }
    return null;
  };
  const lum = ([r, g, b]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bad = []; let n = 0;
  for (const sel of SELECTORS) for (const el of document.querySelectorAll(sel)) {
    const own = [el, ...el.querySelectorAll('*')].filter((e) => [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && e.getClientRects().length);
    for (const e of own) {
      if (e.closest('svg')) continue;
      const s = getComputedStyle(e), fg = parse(s.color);
      let acc = [0, 0, 0], keep = 1;
      for (let a = e; a && keep > 0.01; a = a.parentElement) {
        const b = parse(getComputedStyle(a).backgroundColor);
        if (!b || b[3] === 0) continue;
        for (let i = 0; i < 3; i++) acc[i] += keep * b[3] * b[i];
        keep *= 1 - b[3];
      }
      const bg = acc.map((v) => v + keep * 255);
      const size = parseFloat(s.fontSize), large = size >= 24 || (parseInt(s.fontWeight, 10) >= 700 && size >= 18.66);
      const got = ratio(fg, bg); n++;
      if (got < (large ? 3 : 4.5)) bad.push(`${e.textContent.trim().slice(0, 18)} ${got.toFixed(2)} (${s.color} on rgb(${bg.map(Math.round).join(',')}))`);
    }
  }
  return {n, bad};
"""
