# Hosting a challenge in labsite (handover)

What labsite needs to build to run an Archboard challenge in class (SPEC section 8.3). The work happens in `labsite/`,
following its own CLAUDE.md and HANDOVER; nothing here changes labsite. `tools/learn-host/` is a working stand-in that does
all of this in about 100 lines, and `tools/check_learn.py` proves it end to end.

## What runs where

| Part | Where | Notes |
|---|---|---|
| The editor (static files) | GitHub Pages, or any static host over https | `apps/editor/dist` after a build. The embed is `<editor>/embed/`. |
| The checker service | A container next to labsite, on labsite's Docker network, no published port | `apps/checker/Dockerfile`. The image has not been built and run yet: do that first. |
| The challenge | labsite's server (database or file) | A file from `challenges/`. Never send `*.solution.json` to a browser. |
| The checker key | labsite's server environment only | `ARCHBOARD_KEYS="labsite:<secret>"` in the checker; the same secret in labsite. 24+ characters. |

## The page

1. Put the editor in an iframe:
   `<iframe src="<editor>/embed/?mode=learn&origin=<labsite origin>" allow="fullscreen" title="Diagram editor">`.
   The origin must be exactly labsite's (https, or http on localhost for development).
2. Listen for messages from that iframe only (`event.origin` is the editor's origin and `event.source` the iframe).
   Send `{type: "hello", v: 1}` when your listener starts, in case `ready` came before it.
3. On `ready`, send `load`:
   `{type: "load", v: 1, diagram: <the student's last saved diagram, or the challenge's start>, brief: <challenge.brief>,
   rules: <challenge.rules>, readOnly: <true after the deadline>}`.
4. On `change {diagram, dirty}`, store the diagram as the student's draft (the embed keeps nothing itself). This is the
   student's only autosave.
5. Hand in (labsite's own button): send `{type: "requestSave", v: 1}`, then on `save {diagram}` POST the diagram to
   labsite's server.

## The server

On hand in, labsite's server, never the browser:

1. Takes only the diagram from the request. Ignore any score, rules or results the page sends.
2. Calls `POST http://checker:8787/v1/check` with `Authorization: Bearer <secret>`, `Content-Type: application/json` and
   `{"diagram": <diagram>, "ruleset": <labsite's own copy of challenge.rules>}`.
3. Stores the answer `{valid, results, score, max, engine}` with the hand-in, and applies labsite's own rules for deadlines,
   late work and marks. A 503 means try again; never score it as zero.

The editor's Check button in the page is only a hint for the student (`hints` messages are marked `indicative`). Rules sent
into the page are visible to the student: a check that must stay secret goes only into the server's copy.

## Still to decide in labsite

- Where the Cloud Computing course lives (a new course inside labsite was chosen on 2026-11-20).
- How a challenge is published to a group, with its deadline.
- Whether students see the per-rule results after hand in, or only the score.
