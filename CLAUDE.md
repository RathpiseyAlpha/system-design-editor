# System design editor ("Archboard", working name)

A browser editor for designing the architecture of **any** system: 3D (isometric) blocks on a grid, a text ("diagram as
code") view kept in sync, and swappable **icon packs** (Generic, AWS, Open source; more later) over a vendor-neutral core,
plus a **simulator** that runs problem scenarios against the diagram (SPEC section 13). Free for anyone. Its first host is the Cloud Computing course's lab site, which adds an optional learning mode; the core
editor knows nothing about courses. Owner: Heng Rathpisey. Repository: https://github.com/RathpiseyAlpha/system-design-editor

## Status

**M0, design phase (2026-11-20).** No application code yet. What exists:

- `SPEC.md`: the product spec (users, scope by version, catalog and packs, file format, rule engine, embed and checker APIs,
  screen sizes, stack, milestones, open decisions). It is the scope: change it first when the scope changes.
- `design/tokens.css`: the one source of colours, type, sizes, shadows and motion.
- `design/design-system.html`: design system and key screens A to E (E is the simulator at 1280 × 720). Its script is a
  working prototype of the isometric renderer (rounded blocks, cylinders, plates, zone plates, stickers, grid-axis
  connections, fit to canvas, load fill, switched-off blocks and zones, traffic dots): port that geometry, do not redraw it.
  Screen E's numbers come from one table (`SIM`) with the arithmetic in a comment; keep every pill, label and tile reading from it.
- `tools/fetch_icons.py`: fetches, cleans and catalogs the icons into `design/icons/` (`manifest.json`, `catalog.js`, `oss/`,
  `aws/`). `design/icons/SOURCES.md` records sources, pins and terms.

Next is M1 (SPEC section 11), only after the instructor approves the design.

## Decided by the instructor (2026-11-20; do not reopen without them)

- **Separate project** with its own CLAUDE.md and SPEC.md. Hosts (the lab site `../labsite`, a student portal, anyone) use it
  only through an API or plugin (SPEC section 8). Never import a host's code here, and never add accounts, marks or deadlines here.
- **Generic, not tied to AWS or to one course.** The core is vendor-neutral roles and zone kinds; vendors are packs; courses
  are hosts that turn on learning mode. Never hard-code a vendor's or a course's name, product or rule in the core.
- **Plan and design first**, build after approval.
- **Look:** soft neo-brutalism combined with designed-to-scale.vercel.app, **3D (isometric)** blocks with **small rounded edges**.
  Use our tokens; do not copy that site's colour values, artwork or text.
- **Real product icons** (AWS official icons, open-source project logos).
- **Eraser.io-like features** (diagram as code in sync with the canvas, auto-layout, notes, embed), with our own syntax and look.
- **Built for 16:9 laptops and monitors**: 15.6" laptops (1280 × 720 at 150% scaling up to 1536 × 864) and 22" and larger
  monitors (1920 × 1080 and up). SPEC section 9 has the layout per size.
- **Simulator** after M3 (SPEC section 13): scenarios (load, spike, block, zone and region failure, slow database, cache
  misses, queue backlog, link cut), step-through with narration, per-block capacity settings with role defaults, results
  on the canvas and in a panel, a plain verdict ("Handles it" / "Breaks") naming the bottleneck or single point of failure,
  versioned scenario files. A **teaching model with indicative numbers**: pure code over the diagram JSON in a Web Worker,
  never a cloud emulator, never deploys anything, reads roles not products, optional fields only, works at 1280 × 720.
- **Labs** after the simulator (SPEC section 14), as a host add-on like learning mode: brief, starting diagram, scenarios,
  behaviour checks; the host re-runs the simulation on its server through the checker API to score.

## Proposed in M0, waiting for approval

- Canvas as our own SVG scene (no Three.js, no React Flow; `d3-zoom` for pan and zoom). Trade-off: hit testing, drag with snap,
  box select, connecting, routing and keyboard access are our code, the largest cost of M1.
- The file stores ground grid cells and roles, never pixels, view state or a pack's product names.
- Simulation engine: rate-based with a fixed 1 s step (not discrete-event), deterministic (id order, seeded random only,
  no clock, rounded each tick, `engine` version on results). The routing rules, verdict and behaviour defaults are in SPEC 13.3–13.4.
- **One TypeScript engine** (rules and simulation) runs in the browser's Web Worker and in a Node checker service, so the
  browser and the judge never disagree. This replaces the earlier Python `archboard-check` package (SPEC open decision 9).
- Labs lock per-instance capacity, latency and hit rate and give a budget (total instances), so checks cannot be passed by
  typing big numbers.
- The working name, the text syntax draft, JetBrains Mono + IBM Plex Sans, the green highlighter accent.

## Rules

- Read `SPEC.md` and `design/tokens.css` before writing UI. Colours, fonts, sizes and motion come only from the tokens; a new
  value goes into `tokens.css` first, for both themes.
- Both themes always: light on bare `:root`, dark under `prefers-color-scheme` and `[data-theme="dark"]`.
- Layout rules are **container queries on the editor's own size** (it can be embedded); check every screen change at
  1280 × 720, 1366 × 768, 1536 × 864 and 1920 × 1080 (the size switcher on Screen A of the design page does this).
- **Icons:** only through `tools/fetch_icons.py` (pinned sources, allowlist cleaning, licence recorded). Show AWS icons and
  logos unmodified on the light sticker (`--sticker`): never redraw, recolour, crop or skew them. A product goes in the
  Open source pack only if its licence is OSI-approved, read from its own repository. `design/icons/aws/` is git-ignored
  until the instructor decides on redistribution (SPEC open decision 2).
- Status is word + icon + colour. One primary (highlighter) button per view. Sentence case; buttons are verb + object.
- No sideways page scroll at any width; the canvas pans inside itself. Touch targets 44 px on phones.
- Accessibility: every canvas action has a keyboard path; the code view is the canvas's text alternative; respect `prefers-reduced-motion`.
- Fonts and icons are bundled; no requests to Google or other third parties from the app.
- A diagram file from outside is untrusted: validate it with the schema and limits in SPEC section 6; render labels as text,
  never as HTML. The embed API accepts messages only from the declared host origin.
- A server-side checker is the judge; a score or a simulation result computed in the browser is a hint only.
- Simulator: label every number as indicative ("Teaching model: indicative numbers"); never call it an emulator; never
  read from or write to a real cloud. Simulation reads roles and zones, never products. Node and edge `sim` fields are
  optional v1 fields; a diagram with none must simulate with the role defaults. Traffic dots respect `prefers-reduced-motion`
  (SMIL ignores the CSS query: check `matchMedia` and draw still dots). Run is the one primary button in Simulate mode.
- Learning mode and labs are add-ons a host turns on. Never put course wording, deadlines or marks in the core editor.
- Record each decision the instructor takes in `SPEC.md` section 12 in the same change.

## Commands

- `python -I tools/fetch_icons.py`: fetch and clean the icons, write `design/icons/` (downloads cached in the system temp folder).
- Look at the design page: open `design/design-system.html` in a browser (add `#light` or `#dark` to force a theme).
  Headless check: `chrome --headless=new --allow-file-access-from-files --window-size=1400,9200 --screenshot=out.png "file:///.../design/design-system.html#light"`.
- When the app exists (Vite): the path contains `&`, so `npm run` fails on this machine; run tools directly, for example
  `node node_modules/vite/bin/vite.js build`. On this machine `python` is 3.12.
