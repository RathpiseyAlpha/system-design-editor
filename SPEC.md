# Archboard — product spec

Status: **design phase** (2026-11-20). No code yet. "Archboard" is a working name.

## 1. What it is

A web editor for drawing cloud system architectures from a prepared set of services. Every service is a *role*
(object storage, load balancer, queue…) that can be shown as its AWS product or its free open-source equivalent
(Amazon S3 ↔ MinIO). Students of GICI5CC (Introduction to Cloud Computing, ITC, year 5) use it to design and
explain architectures. Anyone else can use it free in the browser, with nothing to install.

It is a **separate product with its own folder, build and release**. Other sites (the course lab site `../labsite`,
the student portal) use it through an embed API and a checker API (section 8); it never depends on them.

Feature model: the kind of tool Eraser (eraser.io) is for cloud diagrams — a canvas you draw on **and** a text
("diagram as code") view of the same diagram that stays in sync, auto-layout, a notes document beside the diagram,
export and embed — narrowed to cloud architecture and made for teaching (roles, open-source equivalents, checks).
The text syntax, look and names are our own.

## 2. Users and what they need

| User | Context | Main jobs | Success looks like |
|---|---|---|---|
| Student (primary) | Year 5, has used the AWS console in the labs (EC2, S3, VPC, RDS, Lambda, API Gateway) | Draw an architecture for a scenario; see the open-source equivalent of each AWS service; hand in a diagram for a challenge and get feedback | Draws a 3-tier app in a VPC in under 10 minutes without reading help |
| Lecturer | Heng Rathpisey, teaches the course | Draw diagrams for slides; write a challenge (scenario + rules); see which rules each student met | Writes a challenge in under 20 minutes; never has to grade a diagram by eye for the rule-checkable parts |
| General user | Anyone sketching an architecture | Draw quickly, export a picture, keep the file | Exports a clean PNG of a 15-node diagram |

Research to do before M1 (method: 5 students, think-aloud, 20 minutes each, on the clickable mock):
can they find a service without knowing its AWS name? do they understand zones (VPC, subnet) as containers?
do they notice the AWS / open-source switch and use it?

## 3. Principles

1. **Role first, product second.** A node is "Relational database"; "Amazon RDS" or "PostgreSQL" is how it is shown.
   Checks read the role, so either flavour is a correct answer.
2. **Never stuck.** No blocking error dialogs. Every action can be undone; the diagram autosaves.
3. **The diagram is the document.** One small, readable JSON format (section 6) that people, the checker and git can read.
4. **Calm canvas, loud selection.** Pastel category fills, ink outlines; the green highlighter marks only what is active or selected.
5. **3D that explains.** The canvas is isometric: services are blocks standing on a grid and zones are raised floor plates,
   so "what is inside what" reads at a glance. Shape encodes kind (box runs code, cylinder keeps data, low box stores files,
   plate is people or devices); colour encodes category. A flat top-down view of the same file is one click away.
6. **Desktop first, phone usable.** Full editing with mouse and keyboard; on a phone you can view, move, add and rename.

Look: soft neo-brutalism after designed-to-scale.vercel.app (warm paper, ink outlines, hard offset shadows, mono type,
isometric blocks on a faint diagonal grid). Tokens, components and screens: `design/` (see `design/design-system.html`).

## 4. Scope

### v1 (M1 + M2) — the editor
- Canvas: **3D (isometric) view by default**, with pan, zoom, fit, minimap. Blocks snap to grid cells; arrow keys move one cell
  along a grid axis. **Rotate view** turns the camera in 90° steps so a block hidden behind another can be reached (the file
  does not change). **Flat view** shows the same file from above, for dense diagrams and printing.
- Blocks are drawn back to front (painter's order); connections run along the two grid axes with right-angle turns at half
  block height; labels are pills on the longest straight part.
- Palette of services by category, with search (finds by role, AWS name or open-source name: "s3", "minio", "bucket" all find Object storage). Drag onto the canvas, or select and press Enter to add at the centre.
- **Zones** (containers): Region, VPC, Availability Zone, Subnet (public or private). Drop a node inside to put it in the zone; zones nest.
- Edges: drag from a node's handle to another node. Kind: request (solid), async message (dashed), data replication/backup (dotted). Optional label ("HTTPS", "SQL", "S3 events").
- Inspector for the selection: label, role, product (AWS / open source / a named alternative), zone, connections, notes.
- Diagram-wide **flavour switch**: AWS ↔ Open source (renames every node at once; per-node override allowed).
- Undo / redo (100 steps), duplicate, delete, multi-select (shift-click, drag box), align.
- Keyboard: `A` add (opens palette search), `Del`, `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+D`, arrows nudge 8 px (Shift = 1 px), `Space`+drag pan, `F` fit, `?` shortcuts list.
- Files: autosave in the browser; Open / Save as `.archboard.json`; Export PNG and SVG.
- Templates: Blank, Static website, 3-tier web app, Serverless API, Event pipeline.
- Light and dark themes; English UI (Khmer later).

### v1.5 (M2) — the Eraser-like layer
- **Diagram as code.** A text panel beside the canvas (Split view), or full width (Code view). Text and canvas are two
  views of one diagram: typing updates the canvas after a short pause; moving or adding on the canvas rewrites the text.
  A line with an error is underlined with a plain message; the canvas keeps the last valid diagram meanwhile.
  New nodes from text are placed by **auto-layout** (ELK, left to right); nodes already on the canvas keep their place.
  Syntax (ours, draft):

  ```text
  title Course shop
  flavour aws

  Customers: client

  vpc shop-vpc {
    subnet public-a public {
      web-alb: load-balancer
    }
    subnet private-a private {
      app-1: vm
      orders-db: relational-db [product: mysql]
    }
  }

  Customers > web-alb "HTTPS"      // request
  web-alb > app-1
  app-1 > orders-db "SQL"
  app-1 ~> jobs                    // async message
  orders-db .> backups             // data / replication
  ```
- **Auto-layout** button for the whole diagram or a selected zone (tidy left-to-right or top-to-bottom).
- **Notes**: a short Markdown document saved inside the diagram file (design rationale, assumptions), shown in a side panel.
  For students this is where the "why" of a design goes.
- **Present**: full-screen, chrome hidden, step through zones one by one.
- **Share and embed** (when hosted): read-only link and `<iframe>` embed of a diagram.

### Later (Eraser has these; not before the course needs them)
- Generate a first draft from a text prompt with an AI model (needs an API key and a cost decision).
- Sequence diagrams and ERDs in the same text syntax.
- Real-time co-editing, comments.

### v2 (M3) — learning
- **Hints**: live, non-blocking notes from the rule engine ("Database is in a public subnet").
- **Challenge mode**: a brief (scenario + required properties), the student's diagram, "Check my diagram" with a result per rule and a score.
- Integration with labsite (section 8).

### Later
- Step-through mode: animate a request travelling along the edges (the reference site's idea).
- Cost estimate per diagram; Terraform/CloudFormation export; real-time co-editing.

### Not doing
- Deploying anything to a real cloud. Reading students' AWS accounts or credentials.
- Free drawing (shapes, arrows not tied to services). Use a whiteboard for that.

## 5. Service catalog (v1)

Each entry: role id, category, AWS product, open-source default (alternatives). Licences checked 2026-11: Vault and
Redis/Elasticsearch moved to source-available licences, so the defaults are their open forks.

| Role id | Category | AWS | Open source |
|---|---|---|---|
| `client` | Client | Users / browser | Users / browser |
| `mobile` | Client | Mobile app | Mobile app |
| `dns` | Network | Route 53 | CoreDNS (BIND) |
| `cdn` | Network | CloudFront | Varnish |
| `load-balancer` | Network | Elastic Load Balancing (ALB) | HAProxy (Nginx) |
| `api-gateway` | Network | API Gateway | Kong |
| `waf` | Security | AWS WAF | ModSecurity |
| `nat` | Network | NAT gateway | Linux NAT (nftables) |
| `vm` | Compute | EC2 instance | KVM virtual machine (OpenStack Nova) |
| `autoscaling` | Compute | EC2 Auto Scaling group | Kubernetes HPA |
| `containers` | Compute | ECS / Fargate | Docker (Nomad) |
| `kubernetes` | Compute | EKS | Kubernetes |
| `function` | Compute | Lambda | OpenFaaS (Knative) |
| `object-storage` | Storage | S3 | MinIO (Ceph RGW) |
| `block-storage` | Storage | EBS volume | Ceph RBD |
| `file-storage` | Storage | EFS | NFS server |
| `relational-db` | Database | RDS | PostgreSQL (MySQL, MariaDB) |
| `nosql-db` | Database | DynamoDB | ScyllaDB (Cassandra, MongoDB) |
| `cache` | Database | ElastiCache | Valkey (Memcached) |
| `queue` | Messaging | SQS | RabbitMQ |
| `pubsub` | Messaging | SNS | NATS |
| `stream` | Messaging | Kinesis Data Streams | Apache Kafka |
| `monitoring` | Observability | CloudWatch | Prometheus + Grafana |
| `logs` | Observability | CloudWatch Logs | Loki (OpenSearch) |
| `identity` | Security | IAM / Cognito | Keycloak |
| `secrets` | Security | Secrets Manager | OpenBao |
| `registry` | Compute | ECR | Harbor |

Zones: `region`, `vpc` (open source: "Private network"), `az` ("Failure domain / rack"), `subnet` with `access: public|private`.

Icons in v1: our own simple line icons per role + the category colour + the text name. The official AWS
Architecture Icons are **not** bundled until their terms of use have been read and accepted by the instructor.

## 6. Diagram format v1

```json
{
  "format": "archboard",
  "version": 1,
  "title": "Course shop — 3-tier",
  "flavour": "aws",
  "zones": [
    { "id": "z1", "kind": "vpc", "label": "shop-vpc", "x": 3, "y": -0.5, "w": 13.5, "h": 11 },
    { "id": "z2", "kind": "subnet", "access": "public",  "label": "public-a",  "parent": "z1", "x": 3.8, "y": 0.5, "w": 3.8, "h": 9.2 },
    { "id": "z3", "kind": "subnet", "access": "private", "label": "private-a", "parent": "z1", "x": 8.6, "y": 0.5, "w": 7.2, "h": 9.2 }
  ],
  "nodes": [
    { "id": "n1", "role": "client", "label": "Customers", "x": 0, "y": 6 },
    { "id": "n2", "role": "load-balancer", "label": "web-alb", "zone": "z2", "x": 5.7, "y": 6 },
    { "id": "n3", "role": "vm", "label": "app-1", "zone": "z3", "x": 10.2, "y": 3 },
    { "id": "n4", "role": "relational-db", "label": "orders-db", "zone": "z3", "x": 14, "y": 3, "product": "mysql" }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n2", "kind": "request", "label": "HTTPS" },
    { "id": "e2", "from": "n2", "to": "n3", "kind": "request" },
    { "id": "e3", "from": "n3", "to": "n4", "kind": "request", "label": "SQL" }
  ]
}
```

- Positions are **ground grid cells**, not pixels: a node's `x, y` is the centre of its footprint, a zone's `x, y, w, h` its
  rectangle on the ground (halves allowed). The 3D view projects them isometrically (one cell = 34.64 px across, 20 px down
  at 100%); the flat view draws them from above. So the file does not depend on the view, the zoom or the rotation.
- A node's zone is stored, never inferred by the checker.
- `product` overrides the flavour for one node; it must be a product listed for that role.
- Never store React Flow's internal objects (selection, measured size…): the app converts both ways.
- Limits (checked on open and on the server): 200 nodes, 400 edges, 40 zones, labels ≤ 60 characters, notes ≤ 500, file ≤ 256 KB.
  Unknown fields are dropped; an unknown role or a dangling edge makes the file invalid with a message that names it.
- A later version adds fields only; v1 files must always open.

## 7. Rule engine (v2, sketch)

A challenge is a scenario text plus a list of rules over roles, zones and edges, never over exact positions or labels:

```json
{ "id": "r1", "points": 2, "text": "Traffic from users reaches the app through a load balancer",
  "rule": { "path": ["client", "load-balancer", ["vm", "autoscaling", "containers", "kubernetes"]] } }
{ "id": "r2", "points": 2, "text": "The database is not in a public subnet",
  "rule": { "placement": { "role": "relational-db", "notIn": { "kind": "subnet", "access": "public" } } } }
{ "id": "r3", "points": 1, "text": "The app runs in at least two Availability Zones",
  "rule": { "spread": { "roles": ["vm"], "zoneKind": "az", "min": 2 } } }
{ "id": "r4", "points": 1, "text": "Users never talk to the database directly",
  "rule": { "noEdge": { "from": "client", "to": "relational-db" } } }
```

Rule kinds: `count`, `path`, `placement`, `spread`, `noEdge`, `edgeKind`. The server (Python, in labsite) is the judge;
a TypeScript copy gives live hints. Both read one shared file of test cases (the pattern of labsite's `tests/game_cases.json`).

## 8. Integration: embed API and checker API (v2)

The editor owns the editor, the diagram format, the rules and the checker. A host (labsite, the student portal,
any other site) owns accounts, deadlines and marks. They meet through two small, versioned APIs; neither imports
the other's code.

```
 Host page (labsite /cc/challenge/...)                 Archboard (own origin, e.g. editor.<domain>)
 ┌──────────────────────────────────────┐   postMessage   ┌──────────────────────────────┐
 │ brief, deadline, "Hand in" button     │ ─────────────▶ │ <iframe> editor in host mode  │
 │                                      │ ◀───────────── │  ready / change / submit      │
 └───────────────┬──────────────────────┘                └──────────────────────────────┘
                 │ server to server: POST /v1/check {diagram, ruleset} → {results, score}
                 ▼
          Archboard checker service (stateless)  — or the same checker as a Python package
```

### 8.1 Embed API (plugin)
- **Iframe embed** (any host, any framework): `https://<editor>/embed?mode=edit|view|challenge&origin=<host origin>`.
  Messages are JSON with `{type, v: 1, ...}`, sent only to the declared host origin and accepted only from it:
  - host → editor: `load {diagram, readOnly, brief?, rules?}`, `setTheme {light|dark}`, `requestSave`.
  - editor → host: `ready`, `change {diagram, dirty}` (debounced), `save {diagram}`, `submit {diagram}`, `hints {results}` (challenge mode).
- **JS mount** (same-origin hosts that want it inside their page): `Archboard.mount(element, {diagram, mode, onChange, onSubmit})`
  from a single ES module + CSS, no global React needed by the host. Iframe is the default; mount is optional.
- The editor never talks to a host's server itself and never sees a student's identity: the host decides who saves what.

### 8.2 Checker API
- `POST /v1/check` with `{diagram, ruleset}` → `{valid, results: [{id, pass, points, message}], score, max}`.
  Stateless, no storage, no accounts; limits as in section 6; rejects anything that fails validation.
- The same checker ships as a **Python package** (`archboard-check`) so a host like labsite can run it in-process instead
  of calling the service, and as a TypeScript module for live hints in the browser. One shared file of test cases keeps
  the three identical.
- **The host's server is the judge.** It re-checks the diagram it stored; it never trusts a score sent from the browser.

### 8.3 What labsite adds on its side (not in this project)
A course `cc`, a challenge page that embeds the editor, routes that store drafts and hand-ins and call the checker,
and the score through its `store()` so deadlines, late rules, XP and the lecturer table work as for any lab — following
labsite's own rules (hidden until published, server-side validation, no student id in addresses, a numbered migration, tests).

## 9. Quality bar

- First paint < 1.5 s on a classroom laptop; 150 nodes pan and zoom at 60 fps.
- WCAG 2.2 AA colour contrast in both themes; every action reachable by keyboard; visible focus; `prefers-reduced-motion` respected.
- No sideways page scroll at any width (the canvas pans inside itself).
- Works offline once loaded; no third-party requests (fonts bundled).

## 10. Stack (planned)

Vite, React 19, TypeScript, Tailwind CSS 4, shadcn/ui (Radix) for the panels and controls, zod, Vitest.

**Canvas renderer: our own SVG scene, no Three.js, no React Flow.** An isometric view is a fixed 2D projection, so plain SVG
draws it exactly (the reference site has no WebGL either); `design/design-system.html` already contains a working prototype of
the block, cylinder, plate, zone and connection drawing. Three.js would only pay off for free camera orbit or perspective, which
the spec does not want, and it adds about 150 KB and a harder accessibility story. React Flow (the earlier plan) assumes
rectangular nodes in screen space and would have to be fought for diamond footprints, painter's order and grid-axis routing.
Pan and zoom: `d3-zoom` (small, framework-free); everything else (hit testing in ground cells, drag with snap, box select,
routing) is our code over the diagram model. Export: SVG directly, PNG by drawing that SVG to a canvas.
Code panel: CodeMirror 6 with a small grammar for our syntax; auto-layout: elkjs (in a Web Worker).
Checker service: a small Python (FastAPI or Flask) app around the `archboard-check` package; deployable as one container.
Fonts bundled with `@fontsource` (JetBrains Mono for the interface, IBM Plex Sans for long text). The editor is its own app with its own React; hosts
embed it by iframe, so their stack does not matter.

## 11. Milestones

| | What | Done when |
|---|---|---|
| M0 | Spec, design system, key screens (this) | Instructor approves the look and the scope |
| M1 | Editor core: 3D canvas (SVG renderer, pan/zoom, drag with snap, painter's order), palette, zones, connections, inspector, undo, files, templates, themes | A student draws the 3-tier template from blank; the JSON round-trips |
| M2 | Diagram as code with two-way sync, auto-layout, notes, flavour switch, keyboard map, phone sheets, PNG/SVG export, accessibility pass | Text → canvas → text keeps the same diagram; checklist in section 9 passes |
| M3 | Rule engine (TS + Python), hints, challenge mode, embed API, checker API | A test host page embeds the editor and gets a server-side score |
| M4 | labsite course `cc` uses the embed + checker (work done in labsite) | One real challenge used in class |

## 12. Open decisions

1. Product name (working name "Archboard").
2. Bundle the official AWS Architecture Icons? Needs the terms read first.
3. Flavour per diagram (planned) or per node only?
4. Where it is hosted (needed for the iframe embed): GitHub Pages, Vercel, or the same server as labsite under its own subdomain?
5. UI language: English only, or English + Khmer from M2?
6. Text syntax: approve the draft in section 4 (v1.5) before M2.
7. AI draft from a prompt: wanted at all, and who pays for the model calls?
8. Block artwork: our simple line icons on the top face (planned), or richer illustrated blocks per service later?
