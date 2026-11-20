# Archboard — product spec

Status: **design phase** (2026-11-20). No application code yet. "Archboard" is a working name.

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
3. **3D that explains.** Shape is the kind (box runs code, cylinder keeps data, low box stores files, plate is people or
   devices outside the system); colour is the category; the sticker on top is the product. A flat view is one click away.
4. **Real icons, shown as they are.** Official AWS icons and project logos sit upright on a light sticker, never redrawn,
   recoloured, cropped or skewed.
5. **Never stuck.** No blocking dialogs; everything can be undone; the diagram autosaves.
6. **The diagram is the document.** One small, readable JSON format (section 6) that people, checkers and git can read.
7. **Fits the screen people have.** Designed at 1280 × 720 first and grows to large monitors (section 9).

## 4. Scope

### v1 (M1) — the editor
- **3D canvas** (isometric) with pan, zoom, fit, minimap. Blocks snap to grid cells; arrow keys move one cell along a grid
  axis; **Rotate view** turns the camera in 90° steps (the file does not change); **Flat view** shows the file from above.
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

### Later
Step-through mode (animate a request along the edges), cost estimate, Terraform export, AI first draft, real-time co-editing.

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
| AWS | The AWS product and its official icon (28 services, 5 zone icons) | AWS Architecture Icons, release 2026-07-31. AWS: "We allow customers and partners to use these toolkits and assets to create architecture diagrams." Shown unmodified. |
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
- Zone kinds: `region`, `network`, `zone` (failure zone), `subnet` (with `access`), `group`. Packs name them (AWS: VPC, Availability Zone).
- Positions are **ground grid cells**, not pixels: a node's `x, y` is the centre of its footprint, a zone's `x, y, w, h` its
  rectangle on the ground (halves allowed). The 3D view projects them (one cell = 34.64 px across, 20 px down at 100%); the
  flat view draws them from above. The file does not depend on the view, zoom or rotation.
- `product` optionally picks a product per pack for one node (`{ "oss": "mysql" }`); it must be one the pack lists for that role.
- A custom block is `{ "role": "custom", "icon": "<line icon name>", "label": "..." }`.
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

Rule kinds: `count`, `path`, `placement`, `spread`, `noEdge`, `edgeKind`. A server (Python) is the judge; a TypeScript copy
gives live hints. Both read one shared file of test cases.

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
- `https://<editor>/embed?mode=edit|view|learn&origin=<host origin>`. Messages are JSON `{type, v: 1, ...}`, sent only to the
  declared host origin and accepted only from it.
  - host → editor: `load {diagram, readOnly, show?, packs?, brief?, rules?}`, `setTheme`, `requestSave`.
  - editor → host: `ready`, `change {diagram, dirty}` (debounced), `save {diagram}`, `submit {diagram}`, `hints {results}`.
- A host may limit the packs offered (`packs: ["generic", "oss"]`).
- Optional JS mount for same-origin hosts: `Archboard.mount(element, {diagram, mode, onChange, onSubmit})`.
- The editor never calls a host's server and never sees a person's identity.

### 8.2 Checker API
- `POST /v1/check` `{diagram, ruleset}` → `{valid, results: [{id, pass, points, message}], score, max}`; stateless.
- Also a Python package (`archboard-check`) and a TypeScript module; one shared test file keeps them identical.
- **The host's server is the judge**; a score sent from a browser is never trusted.

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

## 10. Stack (planned)

Vite, React 19, TypeScript, Tailwind CSS 4, shadcn/ui (Radix) for panels and controls, zod, Vitest.

**Canvas renderer: our own SVG scene, no Three.js, no React Flow.** An isometric view is a fixed 2D projection, so plain SVG
draws it exactly (the reference site does not use Three.js either); `design/design-system.html` contains a working prototype
of the block, cylinder, plate, zone, sticker and connection drawing. Three.js would only pay off for free camera orbit or
perspective. React Flow assumes rectangular nodes in screen space and would have to be fought for diamond footprints,
painter's order and grid-axis routing. Pan and zoom: `d3-zoom`. Hit testing in ground cells, drag with snap, box select,
connecting, routing and keyboard access are our code: **the largest cost of M1**. Export: SVG directly, PNG via a canvas.

Code panel: CodeMirror 6 with a small grammar; auto-layout: elkjs in a Web Worker. Checker service: a small Python app around
`archboard-check`, one container. Fonts bundled with `@fontsource` (JetBrains Mono, IBM Plex Sans). Icons from
`tools/fetch_icons.py`, cleaned through an allowlist before they are bundled.

## 11. Milestones

| | What | Done when |
|---|---|---|
| M0 | Spec, design system, key screens, icon packs (this) | The instructor approves the look and the scope |
| M1 | Editor core: 3D canvas, palette, zones, connections, inspector, packs, undo, files, templates, themes, responsive layout | Someone draws the 3-tier template from blank at 1280 × 720; the JSON round-trips; pack switching loses nothing |
| M2 | Diagram as code with two-way sync, auto-layout, notes, flat view, export, accessibility pass | Text → canvas → text keeps the same diagram; section 9 passes |
| M3 | Learning mode, rule engine (TS + Python), embed API, checker API | A test host page embeds the editor and gets a server-side score |
| M4 | First host: labsite course page (work in labsite) | One real challenge used in class |

## 12. Open decisions

1. Product name (working name "Archboard").
2. AWS icon files: commit them to the public repository, or keep fetching them at build time (now git-ignored).
3. Hosting (needed for the iframe embed): GitHub Pages, Vercel, or a server with its own subdomain.
4. More packs (Google Cloud, Azure, Kubernetes): which, and after reading whose icon terms.
5. Text syntax: approve the draft in section 4 before M2.
6. AI first draft from a prompt: wanted, and who pays for the model calls?
7. UI language: English only, or more languages later.

Decided by the instructor (2026-11-20): separate project; plan and design first; soft neo-brutalism with the reference
site's look and 3D blocks; Eraser-like features; integration only through an API or plugin; small rounded edges on blocks;
real product icons; **generic for any system architecture, not tied to AWS or one course**; built for 16:9 laptops
(15.6") and monitors (22" and up).
