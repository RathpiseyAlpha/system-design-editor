// Export the canvas as a self-contained SVG or PNG: what the canvas shows, without the grid, selection or handles.
// Styles come from the live page (computed, so both themes and every token are right), icons and fonts are embedded,
// so the file looks the same anywhere.
import mono500 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2?url';
import mono600 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2?url';
import mono700 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2?url';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_PROPS = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity',
  'opacity', 'color', 'font-family', 'font-size', 'font-weight', 'paint-order', 'dominant-baseline', 'text-anchor', 'display', 'visibility',
];
const DROP = '.grid, .halo, .port, .resize-handle, .wire-hit, .rubber, title';

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
const fetchDataUrl = async (url: string) => toDataUrl(await (await fetch(url)).blob());

/** Copy the computed style of every element of `from` onto the same element of `to` (the trees are identical). */
function inlineStyles(from: Element, to: Element) {
  const cs = getComputedStyle(from);
  (to as SVGElement).setAttribute('style', STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
  to.removeAttribute('class');
  for (let i = 0; i < from.children.length; i++) inlineStyles(from.children[i]!, to.children[i]!);
}

/** The diagram as a standalone SVG document (text). */
export async function diagramSvg(svg: SVGSVGElement): Promise<{ text: string; width: number; height: number }> {
  const scene = svg.querySelector<SVGGElement>('g.scene');
  if (!scene) throw new Error('Nothing to export.');
  const box = scene.getBBox();
  const pad = 24, width = Math.ceil(box.width + 2 * pad), height = Math.ceil(box.height + 2 * pad);

  const out = document.createElementNS(SVG_NS, 'svg');
  out.setAttribute('xmlns', SVG_NS);
  out.setAttribute('viewBox', `${box.x - pad} ${box.y - pad} ${width} ${height}`);
  out.setAttribute('width', String(width));
  out.setAttribute('height', String(height));

  // Fonts (embedded) and the icon symbols and arrowhead the scene refers to.
  const [w5, w6, w7] = await Promise.all([fetchDataUrl(mono500), fetchDataUrl(mono600), fetchDataUrl(mono700)]);
  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = [[500, w5], [600, w6], [700, w7]].map(([w, url]) => `@font-face{font-family:"JetBrains Mono";font-weight:${w};src:url(${url}) format("woff2")}`).join('');
  out.appendChild(style);
  const defs = document.createElementNS(SVG_NS, 'defs');
  const used = new Set([...scene.querySelectorAll('use')].map((u) => u.getAttribute('href')?.slice(1)).filter(Boolean) as string[]);
  // Icon symbols keep their currentColor (the <use> carries the colour); the arrowhead takes the theme's ink.
  for (const id of used) {
    const src = document.getElementById(id);
    if (src) defs.appendChild(src.cloneNode(true));
  }
  const head = document.getElementById('head')?.cloneNode(true) as Element | undefined;
  if (head) {
    head.querySelectorAll('path').forEach((p) => { p.removeAttribute('class'); p.setAttribute('fill', getComputedStyle(document.documentElement).getPropertyValue('--edge').trim()); });
    defs.appendChild(head);
  }
  out.appendChild(defs);

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', String(box.x - pad));
  bg.setAttribute('y', String(box.y - pad));
  bg.setAttribute('width', String(width));
  bg.setAttribute('height', String(height));
  bg.setAttribute('fill', getComputedStyle(svg.closest('.canvas') ?? svg).backgroundColor);
  out.appendChild(bg);

  const copy = scene.cloneNode(true) as SVGGElement;
  inlineStyles(scene, copy);
  copy.querySelectorAll(DROP).forEach((el) => el.remove());
  for (const img of copy.querySelectorAll('image')) {
    const href = img.getAttribute('href');
    if (href && !href.startsWith('data:')) img.setAttribute('href', await fetchDataUrl(href));
  }
  out.appendChild(copy);
  return { text: new XMLSerializer().serializeToString(out), width, height };
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Download the diagram as an SVG or a PNG (twice the screen resolution). */
export async function exportImage(svg: SVGSVGElement, kind: 'svg' | 'png', base: string): Promise<void> {
  const { text, width, height } = await diagramSvg(svg);
  const svgBlob = new Blob([text], { type: 'image/svg+xml' });
  if (kind === 'svg') return download(svgBlob, `${base}.svg`);
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('The picture could not be drawn.')); img.src = url; });
    const scale = 2, canvas = Object.assign(document.createElement('canvas'), { width: width * scale, height: height * scale });
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('The picture could not be made.');
    download(png, `${base}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
