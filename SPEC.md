# Archboard — product spec

Status: **M1 done** (2026-11-21); **M2 done** (2026-11-21): diagram as code, auto-layout, flat view, notes, Present mode
and the read-only embed, and section 9 passes in `tools/check_quality.py` (speed, WCAG 2.2 AA by axe-core in both themes,
keyboard, reduced motion, offline). Not covered by any check: a screen reader, Firefox and Safari, touch. **M3 started.** "Archboard" is a working name.

## 1. What it is

A web editor for designing the architecture of **any** system: web apps, microservices, data pipelines, IoT, internal
platforms, cloud deployments. Services are 3D (isometric) blocks on a grid, zones are raised floor plates, and the same
diagram can be edited as text. The editor itself is **vendor-neutral**: a diagram is written in generic roles (service,
database, queue, cache...) and generic zones (region, network, subnet...). **Icon packs** only rename and re-icon it:
Generic, AWS and Open source first, others (Google Cloud, Azure, Kubernetes) later.

It is a separate product with its own folder, build and release. Anyone can use it free in the browser. Other sites use
it through an embed API and a checker API (section 8); one of them is the Cloud Computing course's lab site (`../labsite`),
which adds an optional **learning mode** (challenges with checks). The core editor knows nothing about courses.

Feature model: the kind of tool Eraser (eraser.io) is for diagrams (a canvas and a "diagram as code" text view kept in
sync, auto-layout, notes, export, embed), with a 3D look and generic roles. Text syntax, look and names are our own.

It also has a **simulator** (section 13): run problem scenarios (traffic spikes, failures, slow databases, cut links)
against the diagram and see whether the design copes with its resources and their capacity, ending in a plain verdict.
It is a teaching model with indicative numbers, never a cloud emulator. **Labs** (section 14) build on it as a host add-on.

Look: soft neo-brutalism after designed-to-scale.vercel.app (warm paper, ink outlines, hard offset shadows, mono type,
isometric blocks on a faint diagonal grid). Tokens, components and screens: `design/` (open `design/design-system.html`).

## 2. Users and what they need

| User | Context | Main jobs | Success looks like |
|---|---|---|---|
| Engineer or team | Designing or documenting a system, any stack | Sketch fast, keep the file in git, export a clean picture, show it in AWS or open-source terms | A 15-block diagram drawn and exported in 10 minutes |
| Student | Any course with system design; first host: Cloud Computing at ITC | Draw an architecture for a scenario; see equivalent products across vendors; hand in for checks (learning mode) | Draws a 3-tier app from blank without reading help |
| Teacher | Writes scenarios and checks (learning mode, through a host) | Write a challenge (scenario + rules); see which rules each student met | Writes a challenge in 20 minutes; never grades the rule-checkable parts by eye |

Research before M1 (5 people, think-aloud, 20 minutes each, on the clickable mock): can they find a service without
knowing a vendor's name? do they read zones as containers? do they find and use "Show as"?

## 3. Principles

1. **Neutral core, swappable packs.** The file stores roles and zone kinds; a pack decides names and icons. Changing the
   pack never moves or loses anything. A role with no product in a pack shows its generic name and line icon.
2. **Role first, product second.** A block reads as its name, then its product (`orders-db` over `RDS` or `PostgreSQL`).
   Checks read roles, so any product is a correct answer.
3. **3D that explains.** Shape is the kind (a rack server is a virtual machine or an autoscaling group of them, a box runs
   other code, a cylinder keeps data, a low box stores files, a plate is people or devices outside the system); colour is the category; the sticker on top is the product. A flat view is one click away.
4. **Real icons, shown as they are.** Official AWS icons and project logos sit upright on a light sticker, never redrawn,
   recoloured or skewed. AWS icons fill their sticker and take its rounded corners (instructor's decision, section 12).
5. **Never stuck.** No blocking dialogs; everything can be undone; the diagram autosaves.
6. **The diagram is the document.** One small, readable JSON format (section 6) that people, checkers and git can read.
7. **Fits the screen people have.** Designed at 1280 × 720 first and grows to large monitors (section 9).

## 4. Scope

### v1 (M1) — the editor
- **3D canvas** (isometric) with pan, zoom, fit, minimap. Blocks snap to grid cells; arrow keys move one cell along a grid
  axis; **Rotate view** turns the camera in 90° steps (the file does not change). The flat view (the file from above) comes in M2.
- Blocks drawn back to front; outer edges rounded (5 px); connections along the grid axes with right-angle turns at half
  block height; labels as pills on the longest straight part.
- **Palette** by category; search reads every pack ("postgres", "rds", "sql" all find Relational database). Drag onto the
  canvas, or select and press Enter to add at the centre. A **custom block** takes any name and a line icon.
- **Zones**: region, network, failure zone, subnet (public or private), group. Drop a block inside to put it there; zones nest.
- **Connections**: request (solid), async message (dashed), data (dotted), optional label.
- **Inspector**: name, role, what each pack shows (and a product choice where a pack has several), zone, connections, notes.
- **Show as** (icon pack): Generic, AWS, Open source. Per-block product override within a pack.
- Undo / redo (100 steps), duplicate, delete, multi-select, align. Keyboard map in the design page.
- Files: autosave in the browser; Open / Save as `.archboard.json`; Export PNG and SVG.
- Templates: Blank, Static website, 3-tier web app, Microservices, Serverless API, Event pipeline.
- Light and dark themes; English UI.

### v1.5 (M2) — the Eraser-like layer
- **Diagram as code** in a text panel (Split view) or full width (Code view); text and canvas are two views of one diagram.
  Typing updates the canvas after a short pause; canvas edits rewrite the text. An error is underlined on its line with a
  plain message; the canvas keeps the last valid diagram. New blocks from text are placed by **auto-layout** (ELK).
  Syntax (ours, draft):

  ```text
  title "Online shop"
  show aws                       // pack: generic | aws | oss

  Customers: client
  media: object-storage

  network shop-net {
    subnet public-a public {
      web-lb: load-balancer
    }
    subnet private-a private {
      app-1, app-2: vm
      orders-db: relational-db [product: postgresql]
    }
  }

  Customers > web-lb "HTTPS"     // request
  web-lb > app-1, app-2
  app-1 ~> jobs                  // async message
  orders-db .> media "backups"   // data
  ```
- **Auto-layout** for the whole diagram or one zone. **Notes**: a Markdown document inside the file. **Present** mode.
- **Share and embed** (when hosted): read-only link and `<iframe>` embed.

### v2 (M3) — learning mode and packs
- **Learning mode** (an add-on a host turns on): hints from the rule engine, a challenge brief, "Check" with a result per rule.
- More packs: Google Cloud, Azure, Kubernetes, if their icons' terms allow (section 5).

### v3 (M4) — simulator (section 13)
Simulate mode: scenario picker, run and step controls, blocks filling with load, moving traffic dots, failed blocks and zones
switched off, results panel with a verdict, capacity settings per block, scenario files. Pack-independent; works at 1280 × 720.

### v4 (M5) — labs (section 14)
A host add-on: a brief, a starting diagram, scenarios to survive and behaviour checks, scored by the host through the checker API.

### Later
Cost estimate, Terraform export, AI first draft, real-time co-editing.

### Not doing
Deploying anything. Reading anyone's cloud account. Free drawing not tied to blocks (use a whiteboard for that).

## 5. Catalog and icon packs

The neutral catalog (roles, categories, block shapes) and the packs are generated by `tools/fetch_icons.py` into
`design/icons/manifest.json` (and `catalog.js`). Sources, pins and licences: `design/icons/SOURCES.md`.

**Roles (34):** users, mobile app, device, external system, web front end, service, batch job, DNS, CDN, load balancer,
API gateway, web firewall, NAT, virtual machine, autoscaling group, containers, Kubernetes cluster, function, image
registry, object / block / file storage, relational / NoSQL database, cache, search index, data warehouse, queue, pub/sub
topic, event stream, monitoring, logs, identity, secrets.

**Packs:**

| Pack | Shows | Source and terms |
|---|---|---|
| Generic | Role name and our line icon | Ours |
| AWS | The AWS product and its official icon (28 services, 5 zone icons) | AWS Architecture Icons, release 2026-07-31. AWS: "We allow customers and partners to use these toolkits and assets to create architecture diagrams." Shown upright and uncoloured; corners rounded to match the stickers (section 12). |
| Open source | Projects under OSI-approved licences, with their logos (29 logos) | Logos from gilbarbara/logos (CC0, pinned commit), Simple Icons 16.38.0 (CC0) and cncf/artwork (CoreDNS, Linux Foundation trademark policy). Project licences read from each repository on 2026-11-20. |

Left out of the Open source pack (licence not OSI-approved, read 2026-11-20): HashiCorp Nomad and Vault (BSL 1.1),
ScyllaDB (source-available agreement, April 2026), MongoDB (SSPL), OpenFaaS CE (EULA, commercial use needs a licence).
Redis is listed under its AGPLv3 option; Valkey is the default cache. Without a logo yet: Varnish, ModSecurity, Grafana Loki.

Logos and product names are trademarks of their owners and are used only to name the products.

## 6. Diagram format v1

```json
{
  "format": "archboard",
  "version": 1,
  "title": "Online shop",
  "show": "aws",
  "zones": [
    { "id": "z1", "kind": "network", "label": "shop-net", "x": 3, "y": -0.5, "w": 13.5, "h": 11 },
    { "id": "z2", "kind": "subnet", "access": "public",  "label": "public-a",  "parent": "z1", "x": 3.8, "y": 0.5, "w": 3.8, "h": 9.2 },
    { "id": "z3", "kind": "subnet", "access": "private", "label": "private-a", "parent": "z1", "x": 8.6, "y": 0.5, "w": 7.2, "h": 9.2 }
  ],
  "nodes": [
    { "id": "n1", "role": "client", "label": "Customers", "x": 0, "y": 6 },
    { "id": "n2", "role": "load-balancer", "label": "web-lb", "zone": "z2", "x": 5.7, "y": 6 },
    { "id": "n3", "role": "vm", "label": "app-1", "zone": "z3", "x": 10.2, "y": 3 },
    { "id": "n4", "role": "relational-db", "label": "orders-db", "zone": "z3", "x": 14, "y": 3, "product": { "oss": "postgresql" } }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n2", "kind": "request", "label": "HTTPS" },
    { "id": "e2", "from": "n2", "to": "n3", "kind": "request" },
    { "id": "e3", "from": "n3", "to": "n4", "kind": "request", "label": "SQL" }
  ]
}
```

- `show` is the pack the diagram opens in; it changes names and icons only.
- Connections store no route. The editor routes each one along the grid axes, trying an L-shaped and a Z-shaped path
  and keeping one that crosses no other block; a hand-drawn bend is not part of v1.
- Zone kinds: `region`, `network`, `zone` (failure zone), `subnet` (with `access`), `group`. Packs name them (AWS: VPC, Availability Zone).
- Positions are **ground grid cells**, not pixels: a node's `x, y` is the centre of its footprint, a zone's `x, y, w, h` its
  rectangle on the ground (halves allowed). The 3D view projects them (one cell = 34.64 px across, 20 px down at 100%); the
  flat view draws them from above. The file does not depend on the view, zoom or rotation.
- `product` optionally picks a product per pack for one node (`{ "oss": "mysql" }`); it must be one the pack lists for that role.
- A custom block is `{ "role": "custom", "icon": "<line icon name>", "label": "..." }`.
- `sim` (optional) on a node holds its capacity settings, and `sim` (optional) on an edge a traffic share or link latency
  (section 13.2). Both are **known v1 fields**, so a v1 reader keeps them; a file without them opens and simulates with the
  role defaults (section 13.3).
- Never store view state (selection, measured sizes). Limits checked on open and on servers: 200 nodes, 400 edges, 40 zones,
  labels ≤ 60 characters, notes ≤ 500, file ≤ 256 KB. Unknown fields are dropped; an unknown role or a dangling edge makes
  the file invalid with a message that names it. Later versions only add fields; v1 files must always open.

## 7. Rule engine (learning mode, v2, sketch)

A challenge is a scenario plus rules over roles, zones and edges, never over positions, labels or packs:

```json
{ "id": "r1", "points": 2, "text": "Users reach the app through a load balancer",
  "rule": { "path": ["client", "load-balancer", ["vm", "service", "containers", "kubernetes"]] } }
{ "id": "r2", "points": 2, "text": "The database is not in a public subnet",
  "rule": { "placement": { "role": "relational-db", "notIn": { "kind": "subnet", "access": "public" } } } }
{ "id": "r3", "points": 1, "text": "The app runs in at least two failure zones",
  "rule": { "spread": { "roles": ["vm", "service"], "zoneKind": "zone", "min": 2 } } }
{ "id": "r4", "points": 1, "text": "Users never talk to the database directly",
  "rule": { "noEdge": { "from": "client", "to": "relational-db" } } }
```

Rule kinds: `count`, `path`, `placement`, `spread`, `noEdge`, `edgeKind`. One TypeScript implementation runs in the browser (live hints)
and in the checker service (the judge), so the two can never disagree (section 12, decision 9).
Behaviour checks that need the simulator are part of labs (section 14).

## 8. Integration: embed API and checker API

The editor owns the editor, the format, the packs, the rules and the checker. A host owns people, deadlines and marks.
They meet through two small, versioned APIs; neither imports the other's code.

```
 Host page                                            Archboard (own origin)
 ┌──────────────────────────────────┐   postMessage   ┌──────────────────────────────┐
 │ brief, deadline, "Hand in"        │ ─────────────▶ │ <iframe> editor              │
 │                                  │ ◀───────────── │  ready / change / submit      │
 └───────────────┬──────────────────┘                └──────────────────────────────┘
                 │ server to server: POST /v1/check {diagram, ruleset} → {results, score}
                 ▼
          Archboard checker service (stateless), or the same checker as a Python package
```

### 8.1 Embed API
- `https://<editor>/embed/?mode=edit|view|learn&origin=<host origin>` (with the slash: the page loads `../assets/`, so `/embed`
  works only where the server redirects it). Messages are JSON `{type, v: 1, ...}`, sent only to the
  declared host origin and accepted only from it.
  - host → editor: `load {diagram, readOnly, show?, packs?, brief?, rules?}`, `setTheme`, `requestSave`.
  - editor → host: `ready`, `change {diagram, dirty}` (debounced), `save {diagram}`, `submit {diagram}`, `hints {results}`.
- Built in M2 (decision 32): `mode=view` only, at `/embed/` (a second page of the same app). The origin must be https, or
  http on localhost for development. host → editor: `load {diagram, show?}` (the diagram as an object or its text; same
  size limit and schema as an opened file), `setTheme {theme}`. editor → host: `ready {mode}`, `loaded {title, nodes, edges,
  zones}`, `error {errors}` (a refused message; what is shown stays). `tools/embed-host.html` is a stand-in host.
- A host may limit the packs offered (`packs: ["generic", "oss"]`).
- Optional JS mount for same-origin hosts: `Archboard.mount(element, {diagram, mode, onChange, onSubmit})`.
- The editor never calls a host's server and never sees a person's identity.

### 8.2 Checker API
- `POST /v1/check` `{diagram, ruleset}` → `{valid, results: [{id, pass, points, message}], score, max}`; stateless.
- `POST /v1/check` `{diagram, lab}` (labs, section 14) also validates the diagram against the lab's budget and locks and
  re-runs every lab scenario with the simulation engine and the lab's seeds; results carry the `engine` version.
- The checker service is a small Node service around the **same TypeScript packages** (rules and simulation) the
  browser uses; hosts in any language (labsite is Flask) call it over HTTP. This replaces the earlier idea of a Python
  `archboard-check` package, because a port would drift from the browser and students would dispute marks (decision 9).
- **The host's server is the judge**; a score or a simulation result sent from a browser is never trusted.

### 8.3 First host: the course lab site (work done in labsite, not here)
A course page embeds the editor in learning mode, stores drafts and hand-ins, calls the checker, and sends the score
through its own rules (deadlines, late work, marks), following labsite's CLAUDE.md.

## 9. Screens and quality bar

Designed for 16:9 laptops and monitors. The editor's layout answers its own size (container queries), so it works the same
embedded in a narrower host page.

| Screen | Size the editor gets | Layout |
|---|---|---|
| 15.6" Full HD laptop at 150% scaling | 1280 × 720 (smallest supported for editing) | Palette as a 64 px icon rail, inspector 288 px, icon-only view switch, "Show as" as a select, 48 px bars, no minimap |
| 15.6" HD laptop | 1366 × 768 | Palette 240 px, inspector 296 px, icon-only view switch, compact bars |
| 15.6" Full HD laptop at 125% | 1536 × 864 | Palette 240 px, inspector 296 px, "Show as" select, minimap |
| 22"–24" Full HD monitor (e.g. Dell 22") | 1920 × 1080 | Full layout: palette 264 px, inspector 320 px |
| 27" QHD monitor | 2560 × 1440 | Full layout; extra space goes to the canvas |
| Below 1024 px wide | tablet, phone | Canvas full screen; palette and inspector as bottom sheets |

- First paint < 1.5 s on a classroom laptop; 150 blocks pan and zoom smoothly at 1280 × 720.
- WCAG 2.2 AA contrast in both themes; every action reachable by keyboard; visible focus; `prefers-reduced-motion` respected.
- No sideways page scroll at any width (the canvas pans inside itself).
- Works offline once loaded; no third-party requests (fonts and icons bundled).

## 10. Stack (decided 2026-11-20)

One repository, npm workspaces, TypeScript everywhere, Node 22 LTS.

```
packages/engine   file format + zod schema, rules, simulation engine, scenario and lab formats.
                  Plain TypeScript: no DOM, no framework, no clock, no Math.random. Fully unit-tested.
apps/editor       the editor: a static single-page app (Vite build), embeddable by iframe.
apps/checker      the checker service: a small HTTP service around packages/engine, one Docker container.
tools/            fetch_icons.py and other scripts.   design/   tokens, icons, design page.
```

**Editor (`apps/editor`)**
- React 19, TypeScript, Vite (a static SPA, no server rendering: no Next.js).
- Tailwind CSS 4 with our `design/tokens.css`; shadcn/ui (Radix) for panels, menus, dialogs, inputs.
- State: Zustand. The diagram store holds the file; a separate simulation store holds the latest tick. Components subscribe
  to their own slice (one block reads only its own numbers), so a tick or a drag re-renders only what changed.
- **Canvas renderer: our own SVG scene. No Three.js, no WebGL, no React Flow.** An isometric view is a fixed 2D projection,
  so SVG draws it exactly, and React Flow assumes rectangular nodes in screen space. Pan and zoom: `d3-zoom`. Hit testing in
  ground cells, drag with snap, box select, connecting, grid routing and keyboard access are our code (the largest cost of
  M1). The design page's script is the reference geometry.
- Fast paths stay out of React: dragging moves the block directly and writes the store once on drop; traffic dots are SVG
  animations (still dots under reduced motion); the simulation worker posts at most 10 updates a second.
- Web Workers for the simulation and for auto-layout (elkjs), talked to through Comlink.
- Code view: CodeMirror 6 with a small grammar for our syntax.
- Export: SVG directly, PNG by drawing that SVG to a canvas.
- Fonts bundled with `@fontsource` (JetBrains Mono, IBM Plex Sans); icons from `tools/fetch_icons.py`. No third-party requests.
- Interface strings in one file per language, English only for now, so a translation needs no code change.

**Checker service (`apps/checker`)**
- Hono on Node 22, TypeScript, running the same `packages/engine` the browser uses, so a score always matches what the
  student saw. Endpoints: `POST /v1/check`, `GET /v1/health`.
- Stateless: no database, no accounts, no student data. Every request body is untrusted: zod schema and the size limits of
  section 6, then rules and simulations in a `worker_threads` worker with a time limit and a memory limit (`resourceLimits`).
- One API key per host (`Authorization: Bearer`), a rate limit per key, results stamped with the `engine` version.
- One Docker container. First deployment: next to labsite on the instructor's server, on the same Docker network, so labsite
  (Flask) calls it at an internal address and it is not exposed to the internet.
- Not Python (the engine would exist twice and drift), not NestJS (boilerplate for two endpoints), not Express (older,
  untyped), not free serverless or edge plans (CPU-time limits can cut a simulation short).

**Later, only when wanted:** read-only share links stored in SQLite in the same service (long unguessable ids, no accounts;
Postgres only if it outgrows one server); real-time co-editing with Yjs and a Hocuspocus server in the same service.

**Quality tools:** Vitest (engine, stores, components), Playwright (editor at 1280 × 720, 1366 × 768, 1536 × 864 and
1920 × 1080, light and dark), a determinism test that runs the same scenario in Node and in a browser worker and compares
the results exactly. GitHub Actions: typecheck, test, build on every push; the editor deploys to GitHub Pages from `main`.

## 11. Milestones

| | What | Done when |
|---|---|---|
| M0 | Spec, design system, key screens, icon packs (this) | The instructor approves the look and the scope |
| M1 | Editor core: 3D canvas, palette, zones, connections, inspector, packs, undo, files, templates, themes, responsive layout | Someone draws the 3-tier template from blank at 1280 × 720; the JSON round-trips; pack switching loses nothing |
| M2 | Diagram as code with two-way sync, auto-layout, notes, flat view, export, accessibility pass | Text → canvas → text keeps the same diagram; section 9 passes |
| M3 | Learning mode, rule engine, embed API, checker API; first host (labsite course page, work done in labsite) | A host page embeds the editor and gets a server-side score; one real challenge used in class |
| M4 | **Simulator** (section 13): Simulate mode, scenarios, engine in a Web Worker, results and verdict, capacity settings, scenario files | The design page's Screen E works on a real diagram at 1280 × 720; the same scenario gives the same numbers in the browser and in Node |
| M5 | **Labs** (section 14): lab files, budget and locks, behaviour checks, server re-run through the checker API; labsite runs a lab | One real lab used in class, scored on the server |

## 12. Decisions

### Decided by the instructor (2026-11-20)

Separate project; plan and design first; soft neo-brutalism with the reference site's look and 3D blocks; Eraser-like
features; integration only through an API or plugin; small rounded edges on blocks; real product icons; **generic for any
system architecture, not tied to AWS or one course**; built for 16:9 laptops (15.6") and monitors (22" and up).

Simulator and labs: add a **simulator** after M3 that runs problem scenarios (load, block, zone and region failures, slow
database, cache misses, queue backlog, link cut) with a step-through and narration, per-block capacity settings with role
defaults so a diagram works with no settings, results on the canvas and in a panel, a plain verdict naming the bottleneck or
single point of failure, and versioned scenario files. It is a **teaching model with indicative numbers**, pure code over the
diagram JSON in a Web Worker, never a cloud emulator, never deploys anything, reads roles not products, adds only optional
fields (v1 files still open), and works at 1280 × 720 with our tokens and both themes. **Labs** come after the simulator as a
host add-on: brief, starting diagram, scenarios, behaviour checks; the host re-runs the simulation on its server through the
checker API to score. Learning mode and labs stay add-ons; the core stays course-neutral.

### Decided on the instructor's behalf (2026-11-20, "decide for me and go with the best practice")

Each can be reversed; the reason is given so a later change knows what it trades.

| # | Decision | Reason |
|---|---|---|
| 1 | **M0 design approved**; M1 may start. | The design page and this spec cover every M1 screen. |
| 2 | **Canvas: our own SVG renderer** (no Three.js, no React Flow). | The only way to get the chosen isometric blocks with grid routing; costs the most in M1. |
| 3 | **File stores ground grid cells and roles**, never pixels or product names. | Packs, the flat view, the simulator and checks all rely on it. |
| 4 | **Stack as in section 10**: React 19 + Vite + Zustand + shadcn editor; one TypeScript engine package; Hono checker service. | Fewest mistakes for AI-assisted building, shadcn is React-first, labsite's portal is React; one engine means marks never disagree with the browser. |
| 5 | **Name "Archboard" stays the working name.** | Renaming is cheap until a public launch. A trademark search comes before any public launch (still open, below). |
| 6 | **AWS icon files are fetched at build time, not committed.** | AWS's wording covers making diagrams; redistributing the files in a public repository is a separate question, so the cautious choice. The deployed editor does serve them to its users, inside the diagram tool, as other diagram tools do; without them (a fresh clone, CI) the editor shows the generic line icons. |
| 7 | **Draft text syntax (section 4) approved**, refined while building M2. | Good enough to build against; small changes are cheap before M2 ships. |
| 8 | **Hosting**: the editor on GitHub Pages; the checker service in Docker next to labsite on the instructor's server, internal only. | Free, already where the repository is; the checker needs no public address. |
| 9 | **One TypeScript engine** in the browser's Web Worker and in the Node checker; the Python `archboard-check` package is dropped. | A port would drift and students would dispute marks. labsite calls the checker over HTTP. |
| 10 | **Engine: rate-based, fixed 1 s step**, deterministic (section 13.4). Discrete-event is not planned. | Fast, simple, identical in browser and server; per-request detail is not needed for a teaching model. |
| 11 | **Behaviour table (13.3) adopted as the starting defaults**, tuned during M4 testing with real diagrams. | Indicative by design; tuning needs a working engine. |
| 12 | **Scenario files**: saved with a reference to the diagram (title and hash); "Export with diagram" embeds it for sharing. | Small files by default, one-file sharing when wanted. |
| 13 | **Step-through narration** uses the active pack's product names; the logic uses roles. | Reads naturally ("RDS"), stays pack-independent underneath. |
| 14 | **Lab budget**: a total instance count in M5; a cost model only if wanted later. | Simple to explain and to check. |
| 15 | **Next pack**: Kubernetes, after its icon terms are read; Google Cloud and Azure later. | Clearest open terms; useful for any stack. |
| 16 | **No AI first draft** for now. | Needs an API key, a budget and a privacy decision. |
| 17 | **English only**, with strings kept in one file so translation needs no code change. | Cheapest now, open later. |
| 18 | **Connections are routed automatically**; the file stores no bends. | Keeps the file clean and the text view simple; hand-drawn bends can be added later as an optional field. |
| 19 | **Roles and zone kinds have one source**, `packages/engine/src/roles.json`; `tools/fetch_icons.py` reads it, and a test fails if the manifest differs. | One list, so the engine, the packs and the editor cannot disagree. |
| 20 | **The flat view moves to M2**; M1 is the 3D view only. | M1 is already the largest milestone. |
| 21 | **Zone membership follows position**: after any change, a zone's parent is the smallest zone holding its whole rectangle and a block's zone the innermost zone it stands in. Moving a zone (by its name tab) moves everything inside it. | One rule, so the file never disagrees with the canvas, whatever was dragged where. |
| 22 | **Positions and zone corners snap to half cells** as they are dropped (as seen in the current view). | Tidy diagrams and stable text in the code view. |
| 23 | **Labels are placed automatically**: zone tabs first, then connection labels, each at the first candidate place that covers no block and no other label. | Readable diagrams without hand-placing labels; no extra fields in the file. |
| 24 | **Exported pictures** are standalone (embedded fonts and icons), without the grid, selection or handles; PNG at twice the screen resolution. | They look the same in slides, documents and chats. |
| 25 | **The text format** (`packages/engine/src/text.ts`): names are unquoted when they are letters, digits, `-`, `_` and `.`, otherwise "quoted" (keywords too); two blocks with the same name get `[id: n3]` and are reached with `@n3`; attributes are `product` (the open-source product), `icon` (custom blocks) and `id`; `//` starts a comment. Zone names are not unique and are not referenced. | Readable text that round-trips every diagram, including duplicate names. |
| 26 | **Text merges into the file by name.** Blocks the text still names keep their id, position, notes, capacity settings and other packs' products; new names are new blocks; missing names are removed. A rename in the text is a rename: when a name disappears and a new one appears with the same role in the same zone (for zones: same kind, same parent), it is the same block or zone, keeping its id, place, notes and connections. Within one such group the k-th old item pairs with the k-th new one, and only when the counts are equal; otherwise (a rename and a removal in the same place, or a rename that also changes the role) it stays a removal plus an addition, which Undo reverses. A connection still using the old name offers the new one as a fix. Connections match by their two ends. The text decides what is inside what: blocks and zones are moved into the zone the text puts them in, and zones grow to hold their contents, so the canvas and the nesting agree. | The text never loses what it cannot say, and the canvas never contradicts the text. |
| 27 | **The canvas rewrites the text**, so comments in the text are lost when something is changed on the canvas. Notes and capacity settings live only in the file and the panels, not in the text. | Two-way sync with a simple printer; comments are rare in short diagrams. |
| 28 | **New blocks from text are placed by a fixed rule** (inside their zone at the first free spot, else next to a block they connect to), not by ELK; ELK runs only when Auto-layout is pressed. | Typing must not rearrange the user's diagram; the rule is instant and deterministic. |
| 29 | **The flat view is a look, not a layout**: a 3D / Flat switch on the canvas (it works in Split too), view-only like Rotate view. Seen from above a cell is 44 px; blocks are cards the size of their footprint with a hard shadow (discs for stores, dark servers with three status lights), names under the card; zones are rounded areas with their tab on the border. A connection that enters or leaves a card vertically stops below the name. The top bar's "3D" became "Canvas". | One file, two looks; Split keeps whichever look was chosen. |
| 30 | **Notes sit beside the text**: the side panel in Split and Code has two tabs, Text and Notes. Notes are Markdown (headings, lists, quotes, fenced code, inline code, bold, italic, https links only), drawn from a parsed tree as React elements; nothing in a note is ever read as HTML. Typing is one undo step. | A wide place to write; files from anyone are safe to open. |
| 31 | **Present mode** shows only the canvas (full screen when the browser allows): the whole diagram first, then each zone in reading order (outer zones first). Arrows, Space, Page Up/Down, Home, End step; Esc exits. The view glides 0.42 s (instantly with reduced motion), zooms to at most 160 % and keeps room for the bar. Nothing can be changed while presenting. | Teaching from the diagram without the editor's chrome; zones are the natural chapters. |
| 32 | **The embed's first version is view-only** (`/embed/?mode=view&origin=…`). It listens only to its parent window at the declared origin and posts only there, never reads or writes the editor's autosave, does not save the host's theme, and answers `loaded` and `error` (added to section 8.1). Edit and learning modes come with M3. Hosting it (for example on GitHub Pages) is left to the instructor. | Hosts can show diagrams now; nothing a host sends can change the user's own work. |
| 33 | **Offline by a service worker** written at build time (`apps/editor/offline.ts`): it keeps a copy of every file of the build, pages network first, hashed files from the copy, one cache per build. Section 9's "works offline once loaded" is checked by going offline after load (text view, notes, auto-layout) and reopening the page offline. | Before it, a dropped network made the text view and notes fail to load and took the whole editor down; preloading parts would not cover icons, the layout worker or a reload. |
| 34 | **How section 9 is measured** (`tools/check_quality.py`): "classroom laptop" is Chrome with the CPU slowed 4x and a 20 Mbit/s, 20 ms network, cache empty (median of 3 loads); "smooth" for 150 blocks is real drags and wheel turns with the CPU slowed 2x, median frame at most 20 ms and 95 % at most 34 ms, with no more frames counted than 60 a second (one timer only); contrast and names by axe-core 4.10.3 (WCAG 2.2 AA tags) on every screen in both themes, plus two passes of our own where axe cannot decide: every text and tspan on the canvas (blocks, zone tabs, connection labels; 3D, flat and the AWS pack) against the shapes under it, and page text axe leaves undecided against its composited background (a block's product name is 88 % ink on its face colour for this); every visible control reached with Tab (members of a toolbar or group through its tab stop) and a ring on every stop. Small text in a colour (code highlighting) uses the `-text` tokens (`--marker-text`, `--port-text`), which reach 4.5:1 on every surface. | A target that is not measured is not met; these numbers are written down so a later change can be held to them. |

Also decided by the instructor (2026-11-20): **AWS icons get rounded corners** to match the stickers (they fill the sticker and
are clipped to its corner radius, as are the AWS zone icons in tabs). AWS's icon guidelines ask that icons not be cropped;
this trims a few pixels of each icon's background square. Reverse it by drawing the icon inset in the sticker again.

### Still open (for the instructor)

- **Licence of this repository** (for example MIT for the code). Logos and AWS icons keep their own terms either way.
- **Trademark check on the name** before any public launch.

## 13. Simulation (v3, M4)

Let anyone test whether a design holds up: run problem scenarios against the diagram and see whether its blocks, with
their instances and capacity, cope. It is a **teaching model with indicative numbers**, never a cloud emulator: it never
deploys anything and never touches an account. It reads roles, zones and edges, never products, so every icon pack gives
the same result. Design page: Screen E.

### 13.1 What the user does

- **Simulate mode** (top bar switch: Design / Simulate). Left: the scenario panel. Right: results. Bottom of the canvas:
  run controls and a timeline. Run is the one primary button in this mode.
- **Scenarios**, picked from presets and combined on one timeline, each with a few fields:
  steady load (requests per second), traffic spike (from, to, at), block fails (which, at), zone goes down, region goes down,
  slow database (latency and capacity factors), cache misses (hit rate), queue backlog (producer burst or slower consumers),
  network link cut (which connection, at). Each can end with a recovery.
- **Run** plays the scenario (default 5 simulated minutes) at ×1, ×10 or ×60; pause, scrub and reset.
  **Step** sends one request through the system as it is at the paused moment, hop by hop, with a narration panel
  ("web-lb sends the request to app-1, because zone-b is down"), like the lessons on designed-to-scale.
- **On the canvas** (all from the same numbers as the results panel):
  - each block fills from the bottom with its utilisation: ok below 70%, warn from 70%, bad at 100% and over; warn and bad
    blocks get a status pill (word + icon + colour: "Busy 83%", "Over capacity 200%");
  - moving dots on the connections show traffic, more dots for more traffic (static dots when reduced motion is on);
    connection labels show the rate;
  - failed blocks and zones look switched off (grey, dashed outline); a failed zone's tab says "down";
  - connections into something switched off are drawn dashed in the error colour, with no dots.
- **Results panel**: throughput (served of offered requests per second), error rate, p95 latency, longest queue, users
  served (yes or no), what happened when, and a verdict: **Handles it** or **Breaks**, naming the bottleneck or single point
  of failure, with one hint. The panel says "Teaching model: indicative numbers".
- **Capacity settings** in the inspector (Simulate mode): optional per block; an empty field shows the role default in grey.
- **Scenario files** can be saved, shared and replayed.

### 13.2 Format additions

Node `sim` (optional; a known field of diagram format v1):

```json
{ "id": "n3", "role": "service", "label": "app-1", "zone": "z2", "x": 8, "y": 2.3,
  "sim": { "instances": 2, "capacity": 500, "latency": 25,
           "autoscale": { "min": 2, "max": 6, "threshold": 0.7, "warmup": 60 } } }
```

| Field | Meaning | Applies to |
|---|---|---|
| `instances` | number of copies (0 to 1,000) | all |
| `capacity` | requests per second one instance handles | all |
| `latency` | milliseconds per call at low load | all |
| `hitRate` | share answered without going further (0 to 1) | cache, CDN |
| `queueSize` | messages held before new ones are rejected | queue, pub/sub, stream |
| `autoscale` | `min`, `max` instances, `threshold` utilisation (0 to 1), `warmup` seconds | compute roles |

Edge `sim` (optional): `share` (fraction of the source's requests that take this connection, instead of every request calling
it) and `latency` (network milliseconds). Any missing value takes the role default (13.3).

Scenario file (its own format and version):

```json
{
  "format": "archboard-scenario", "version": 1,
  "title": "Spike, then zone-b goes down",
  "for": { "title": "Online shop", "hash": "sha256:…" },
  "duration": 300, "seed": 7,
  "load": [ { "from": "n1", "rps": [[0, 200], [60, 2000]] } ],
  "events": [
    { "at": 120, "type": "fail", "zone": "z3" },
    { "at": 150, "type": "slow", "role": "relational-db", "latency": 4, "capacity": 0.5 },
    { "at": 0,   "type": "hit-rate", "node": "n6", "value": 0.2 },
    { "at": 180, "type": "backlog", "node": "n8", "consumers": 0.3 },
    { "at": 200, "type": "cut", "edge": "e5" },
    { "at": 240, "type": "recover", "zone": "z3" }
  ],
  "expect": { "errorRate": 0.01, "p95": 500 }
}
```

- Event types: `fail`, `recover`, `slow`, `hit-rate`, `backlog`, `cut`; load changes live in `load`. A region going down is
  `fail` on a zone of kind `region`.
- A target is one `node`, `zone` or `edge` id, or a `role` (every block with that role). An unknown id makes the scenario
  invalid with a message that names it.
- A scenario either names the diagram it was written for (`for`) or embeds it (`diagram`) to be shared as one file.
- Limits: duration up to 3,600 s, 50 events, 20 load series.

### 13.3 Behaviour table (role defaults, indicative)

| Category, roles | Default per block | Behaviour |
|---|---|---|
| Client: users, mobile app, device, external system | none | Traffic sources: send the scenario's load along their request connections. A request counts as served when its whole chain of calls succeeds. |
| Network: load balancer | 1 × 20,000 req/s, 1 ms | Splits requests evenly across its healthy targets; stops sending to failed ones. |
| Network: DNS, CDN, API gateway, web firewall, NAT | 1 × 10,000 to 50,000 req/s, 1 to 5 ms | Pass requests through. CDN answers `hitRate` (default 0.6) itself. |
| Compute: service, virtual machine, containers, Kubernetes, web front end, batch job | 2 × 500 req/s (VM: 1 × 300), 25 ms | Every request calls each request dependency once (fan-out), unless an edge has a `share`. Autoscaling if set. |
| Compute: function | scales 0 to 1,000 × 10 req/s, 30 ms, +300 ms on cold start | Autoscaling on by default. |
| Database: relational | 1 × 1,000 req/s, 5 ms | One instance unless set: the usual bottleneck and single point of failure. |
| Database: NoSQL, search index, data warehouse | 1 × 5,000 / 500 / 50 req/s, 3 / 20 / 500 ms | As above. |
| Database: cache | 1 × 20,000 req/s, 1 ms, hit rate 0.8 | Cache-aside: when a block calls a cache and a database, the database gets only the misses. |
| Storage: object; block, file | object 1 × 5,000 req/s, 20 ms; block and file 1 × 2,000 req/s, 2 ms | As above. |
| Messaging: queue, pub/sub, event stream | 10,000 req/s in, queue size 100,000, 5 ms | Async connections fill the queue; the consuming blocks drain it at their capacity; the backlog is the queue length; a full queue rejects. |
| Observability, security | 1 × 1,000 req/s, 5 ms | On the request path only where drawn there. |

### 13.4 Engine (decided: section 12, decision 10)

- **Rate-based with a fixed 1 s step** over the scenario. Each tick: apply the events; push request rates from the sources
  along request connections, in id order; cap each block at instances × capacity, and the excess fails; fill and drain
  queues; run autoscaling (above the threshold for 30 s, then the warm-up); compute latency per call as
  latency ÷ (1 − min(utilisation, 0.95)) plus the connection latency. p95 is approximated as twice the mean latency of the
  slowest served chain, and the UI calls it indicative.
- **Routing:** clients are the sources. A load balancer splits across healthy targets; every other block fans out to each
  request dependency (or by `share`); cache-aside sends only misses to the database; async connections feed queues; data
  connections carry no user traffic. A failed block has capacity 0. A failed zone switches off every block inside it,
  nested zones included; blocks drawn outside it survive. A cycle of request connections is an error. A block no client
  reaches stays idle.
- **Verdict:** "Handles it" when the error rate is under `expect.errorRate` (default 1%), p95 is under `expect.p95` (default
  1,000 ms) and no queue grew over the last 30 s; otherwise "Breaks". The bottleneck is the busiest block on a served path at
  100% or more. A single point of failure is a block or zone whose failure alone drops users served below the threshold; the
  editor also flags it without running (one instance, no sibling behind the same balancer). One hint per cause: overloaded,
  add instances or autoscaling; single point of failure, a second zone or a standby; database overloaded, a cache or a read
  replica; queue growing, more consumers; link cut, a second path.
- **Step-through** traces one request through the state at the paused tick: the load balancer picks the next healthy target
  in turn, a cache hit or miss comes from the seeded random generator, and the narration is built from roles (shown with the
  active pack's names).
- **Deterministic:** blocks and connections processed in id order, a seeded random generator only (no `Math.random`, no
  clock), values rounded each tick, and every result carries the `engine` version. The same TypeScript package runs in a
  Web Worker in the browser and in Node in the checker service; the server's result is the one that counts.
- Speed: a 50-block diagram and a 300 s scenario in under 1 s on a classroom laptop, off the main thread.

## 14. Labs (v4, M5, host add-on)

Students play in the simulator and learn from scenarios. Like learning mode, labs are an add-on a host turns on; the core
editor stays course-neutral. A lab is a brief, a starting diagram, scenarios to survive and checks.

```json
{
  "format": "archboard-lab", "version": 1, "id": "survive-a-zone",
  "title": "Survive a zone outage",
  "brief": "The shop must keep serving customers when one failure zone goes down…",
  "start": { "format": "archboard", "version": 1, "…": "the starting diagram" },
  "budget": { "instances": 12 },
  "locked": ["capacity", "latency", "hitRate"],
  "scenarios": [ { "id": "peak", "…": "scenario" }, { "id": "zone-down", "…": "scenario" } ],
  "checks": [
    { "id": "c1", "points": 3, "text": "Still serves users after one zone fails", "scenario": "zone-down", "expect": { "served": true } },
    { "id": "c2", "points": 2, "text": "p95 under 200 ms at 1,000 requests per second", "scenario": "peak", "expect": { "p95": 200 } },
    { "id": "c3", "points": 1, "text": "The database is not in a public subnet",
      "rule": { "placement": { "role": "relational-db", "notIn": { "kind": "subnet", "access": "public" } } } }
  ]
}
```

- **Behaviour checks** name a scenario and what must hold (`served`, `p95`, `errorRate`, `maxQueue`); structure checks reuse
  the rule engine (section 7).
- **No passing by typing big numbers:** per-instance capacity, latency and hit rate come from the role defaults and are
  locked in labs; students change the structure, instances and autoscaling, within a budget (total instances for M5).
- **Student view:** the brief, the scenarios with Run and Step, the checks with live (indicative) results. Hand in belongs
  to the host.
- **Scoring:** the host calls `POST /v1/check {diagram, lab}`. The checker service validates the diagram against the lab
  (budget, locks), re-runs every scenario with the same engine and seeds, and returns per-check results and a score. The
  host never trusts a result from the browser.
