# System design editor ("Archboard", working name)

A browser editor for cloud architecture diagrams: 3D (isometric) blocks on a grid, a text ("diagram as code") view kept in
sync, AWS products with their open-source equivalents, and later rule-based checks for course challenges. Made for GICI5CC
(Introduction to Cloud Computing, ITC, **year 5**: keep the wording technical) and free for anyone.
Instructor and owner: Heng Rathpisey. Repository: https://github.com/RathpiseyAlpha/system-design-editor

## Status

**M0, design phase (2026-11-20).** There is no application code yet. What exists:

- `SPEC.md`: the product spec: users, scope by version, service catalog, diagram format, rule engine, embed and checker APIs,
  stack, milestones, open decisions. It is the scope: build what it says, and change it first when the scope changes.
- `design/tokens.css`: the one source of colours, type, sizes, shadows and motion.
- `design/design-system.html`: the design system page and the key screens (editor 3D view, split code view, challenge mode
  embedded in a host, phone). Its script is a working prototype of the isometric renderer; port that geometry, do not redraw it.

Next is M1 (SPEC section 11), only after the instructor approves the design.

## Decisions already taken (do not reopen without the instructor)

- **Separate project.** Its own folder, repo, build and release. Hosts (the lab site `../labsite`, the student portal) use it
  only through the embed API (iframe + postMessage, optional JS mount) and the checker API (HTTP or the Python package);
  SPEC section 8. Never import labsite code here, and never add accounts, marks or deadlines here: those belong to the host.
- **3D by default, drawn as SVG.** Isometric projection of ground grid cells. No Three.js, no WebGL, no React Flow; pan and
  zoom with `d3-zoom`. A flat view of the same file exists for dense diagrams and printing.
- **The file stores ground cells**, never pixels or React state (SPEC section 6). The checker reads roles, zones and edges, never positions.
- **Role first, product second.** A node's `role` is what the checker reads; AWS or open-source product is how it is shown.
- **Look:** soft neo-brutalism after designed-to-scale.vercel.app: warm paper, ink outlines, hard offset shadows, JetBrains
  Mono, a green highlighter for active and selected. Use our tokens; do not copy that site's colour values, artwork or text.
- **Diagram as code** is an Eraser-like feature with our own syntax (SPEC section 4, v1.5). Do not copy Eraser's syntax or look.

## Rules

- Read `SPEC.md` and `design/tokens.css` before writing UI. Colours, fonts, sizes and motion come only from the tokens; a new
  value goes into `tokens.css` first, for both themes.
- Both themes always: light on bare `:root`, dark under `prefers-color-scheme` and `[data-theme="dark"]`.
- Status is word + icon + colour. One primary (highlighter) button per view. Sentence case; buttons are verb + object.
- No sideways page scroll at any width; the canvas pans inside itself. Touch targets 44 px on phones.
- Accessibility: every canvas action has a keyboard path; the canvas has a text alternative (the code view); respect
  `prefers-reduced-motion`.
- Fonts are bundled (`@fontsource`), no requests to Google or other third parties from the app.
- Official AWS Architecture Icons are not bundled until the instructor has read and accepted their terms (SPEC open decision 2).
- A diagram file from outside is untrusted: validate it with the schema and limits in SPEC section 6 before use; render labels as
  text, never as HTML. The embed API accepts messages only from the declared host origin.
- The server-side checker is the judge; a score computed in the browser is a hint only.
- Record each decision the instructor takes in `SPEC.md` (section 12 moves to the decided list) in the same change.

## Commands

None yet. When the app exists (Vite): the path contains `&`, so `npm run` fails on this machine. Run tools directly, for example
`node node_modules/vite/bin/vite.js build` and `node node_modules/vitest/vitest.mjs run`. On this machine `python` is 3.12.

To look at the design page: open `design/design-system.html` in a browser (it loads `tokens.css` next to it). A headless check:
`chrome --headless=new --screenshot=out.png --window-size=1400,6400 file:///.../design/design-system.html`.
