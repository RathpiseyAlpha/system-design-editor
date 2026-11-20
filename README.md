# System design editor

Design the architecture of any system as 3D blocks on a grid, or type it as text. Show the same diagram as generic roles,
as AWS services or as open-source projects: the diagram stays the same, only names and icons change. A simulator runs
traffic spikes, failures and slow parts against the design and says plainly whether it holds up (a teaching model with
indicative numbers, not a cloud emulator). Free for anyone;
built first for the Cloud Computing course at the Institute of Technology of Cambodia, which embeds it with an optional
learning mode.

**Status: design phase.** No application code yet.

- [`SPEC.md`](SPEC.md): what it does, the file format, icon packs, the embed and checker APIs, screen sizes, milestones.
- [`design/design-system.html`](design/design-system.html): design system and key screens (open it in a browser).
- [`design/tokens.css`](design/tokens.css): colours, type, sizes and motion.
- [`tools/fetch_icons.py`](tools/fetch_icons.py) and [`design/icons/SOURCES.md`](design/icons/SOURCES.md): product icons,
  their sources and terms. The AWS icons are fetched by the script, not stored in this repository.

Working name: Archboard. Logos and product names are trademarks of their owners.
