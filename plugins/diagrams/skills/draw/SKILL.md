---
name: draw
description: Draw technical diagrams (architecture, system, data flow, incident, deployment, sequence) in the Clear standard with real brand logo badges, colour-coded flows and status tags, and in another look when the user names one (Sketch, Blueprint, Isometric, Dark, Infographic). Use when the user asks for an architecture, system or sequence diagram, to restyle one, to see the diagram styles, kinds, layouts or badges as pictures, or to build a page (explainer, blog post, wiki page) around a diagram.
---

<!-- The one source of the diagrams skill. `python3 build.py plugin` copies it into plugins/diagrams/skills/draw/ with every file it needs, and `python3 build.py skill` packs the same folder as diagrams-skill.zip (renamed `diagrams`). The same text runs in Claude Code, claude.ai chat, the desktop app and Cowork, so keep every instruction true on all of them. -->

# Cloud-native diagrams

This skill comes with the `diagrams` plugin and works the same in Claude Code, claude.ai, the Claude desktop app and Cowork. You draw the diagram once as data (a model) and export it in the house standard, the `clear` style, as SVG and PNG. `SKILL/STANDARD.md` holds the rules and why; read it once. Clear is the default look. The user can ask for any diagram in another look by name: **Sketch**, **Blueprint**, **Isometric**, **Dark** or **Infographic** (names any case; the ids `sketch`, `blueprint`, `iso`, `dark`, `infographic` work too). Draw in `clear` unless the user names one of those. The first time you draw for the user in a conversation, add one line saying the other five looks exist and show `SKILL/thumbs/six-looks.png` (pictures, never just names). `cloud` and `swiss` stay in the catalogue but are not offered; use them only if the user asks for them by name.

## Pick by picture

`SKILL/gallery.html` shows every choice as a picture, each labelled with the words to ask for it: the **kind** (1 Map, 2 Sequence), the page **layout** (A to F), the **look** (Clear and five others) and **mixes** of them ("page, Plate, Sketch"; filter chips show any look on every layout). `SKILL/thumbs/gallery.png` (light) and `SKILL/thumbs/gallery-dark.png` are the same gallery as one picture, for a surface that cannot show HTML.

- **The user named what they want** ("an architecture diagram of X", "page, Long read, Blueprint"): draw it straight away, in Clear unless they named a look. The gallery is for browsing, never a gate.
- **The user named nothing, or asks what is possible** ("what can you draw?", "show me the options", "make me a diagram" with no kind or look): show the gallery first and ask for a number, a letter or a mix by its words. Do not ask a text question instead of showing pictures. Show it as you would `picker.html` (see "Just show the styles"): open it on the user's own computer, otherwise copy it to `<out>` and present it, or publish it as a private artifact; if you cannot show HTML, present `thumbs/gallery.png` (or `gallery-dark.png` on a dark surface).

Every page you build, the gallery, the style picker and the preview switch **Light / Dark / Auto** with a toggle that changes the whole page and its drawings together; the choice is remembered per page.

### The four kinds

| | Kind | Use it for | How |
|---|---|---|---|
| 1 | **Map** | Architecture, data flow, deployment: the parts and what talks to what. The default. | "Draw a diagram" below; any look, any page layout. |
| 2 | **Sequence** | One request in time order, one lane per part. | Draw the Map with numbered steps, then export with `--view sequence` (or Mermaid `sequence`). |

`SKILL` below is this skill's base directory, the folder holding this file (`${CLAUDE_SKILL_DIR}`). Run every command with its full path; the scripts work from any folder. The skill folder may be read-only, so never write inside it. `<out>` below is where the user's files go: in Claude Code, the user's project (by default `docs/diagrams/`, so the diagram can be restyled or edited later); on claude.ai, the session's output folder (`/mnt/user-data/outputs`); in Cowork, the user's working folder.

## Just show the styles

When the user only wants to see or compare the styles or badges:

1. If the user wants to see everything (kinds, layouts and mixes too), show `SKILL/gallery.html` as in "Pick by picture" and stop there.
2. `python3 SKILL/build.py styles` lists the six looks on offer: name, id, what each is good for, and its thumbnail.
3. Show pictures, not names. `SKILL/picker.html` shows both example systems in every style, plus the searchable badge library; `SKILL/thumbs/six-looks.png` is one diagram in the six looks. On the user's own computer, open `picker.html` (`open` on macOS, `xdg-open` on Linux, `start ""` on Windows). Elsewhere, copy it to `<out>` and present it as a file, or publish it as a private artifact where the app offers one. If you cannot show HTML, present the PNG.
4. Reply with the six looks as a short list: name, then one line on when to use it. Say that Clear is the default and any diagram can be asked for in another look by name.

For a badge question ("is there a Kafka logo?"), run `python3 SKILL/build.py find kafka`.

## Draw a diagram

### 0. Write the contract

Before anything else, write five lines and keep them in front of you (put them in the model as `contract`, see step 3):

1. **Question**: the one question the diagram answers ("How does an order reach the warehouse?").
2. **Reader**: who reads it and what they already know (on-call SREs, a vendor review, new joiners).
3. **Must show**: the places, the flows that matter, and the boundary being crossed.
4. **Left out**: what is left out on purpose, so nobody reads a gap as an error.
5. **Where shown**: a slide, a README, a runbook page, light or dark, phone or laptop.

Ask the user only for the lines you cannot work out from the request and their files.

### 1. Understand the system

Get the parts, the products (Lambda, Grafana, Kafka...), the flow between them, and the stages they group into. Read the user's code, docs or files if the diagram is of their project. Ask only what you cannot find out. If the user named a look ("in Sketch", "make it Dark"), use it instead of `clear`.

### 2. Find a badge for every named product

```
python3 SKILL/build.py find lambda grafana kafka
```

Use the printed id as the node's `b`. Every named product gets its real logo badge; an unbranded thing (a person, a policy, a report, an agent) gets a glyph, `g:person`. If a product has no badge, use the closest glyph and tell the user it can be added to `diagrams/badges/catalogue.json` in the cloud-native-diagrams repo.

### 3. Write the model

Save it as `<out>/<id>.json`. Start from `SKILL/examples/serverless-web-app.json` (small) or `SKILL/examples/incident-response.json` (full). The keys are in the "Add an example" section of `SKILL/README.md`. Rules that keep it readable:

- Group nodes into 3 to 6 numbered zones (stages), numbered in reading order. Give each a palette colour (`violet`, `blue`, `amber`, `green`, `red`) for the other styles; `clear` draws every zone in neutral grey on purpose.
- Decide what colour on the lines means, if anything (which door, which kind of traffic, which team), and name it once in `"flows"`: `{"api": {"t": "Kubernetes API", "c": "blue"}}`, colours `blue`, `orange`, `green`, `pink`, `sky`, `vermillion`, `grey`, at most five. Give each edge `"f": "api"`. Colour never means two things, and never encode a meaning by line pattern alone.
- Status (needs a new rule, planned, broken) is a tag, not a colour: `"tags": {"new": {"t": "New rule", "k": "bad", "m": "router rule to add"}}` and `"tag": "new"` on the node. Kinds: `bad`, `good`, `info`. See `SKILL/examples/lab-access.json`.
- Name on top, role underneath (`"t": "Lambda", "s": ["business logic"]`). Keep names short.
- Edges are orthogonal point lists. With no flows, mark the main path `"hot": 1` and number its steps; with flows, the colour already shows the paths, so leave `hot` off.
- Set `type` (Architecture, Deployment, Data flow...), `scope` (what it covers: "Production, eu-west-1") and `updated` (today, YYYY-MM-DD). They print beside the key, which the renderer draws itself.
- Label every line that crosses zones: `"l": ["HTTPS 443", "what moves"]`, protocol and port first. Solid is a request, `dash` is async or batch, `dot` is still to confirm; arrows point the way the data goes, so draw two edges instead of `head: both`. Never invent a port or a product: ask, or mark the line `dot`.
- Mark planned or optional parts `"ghost": 1`.
- Places inside places (a namespace in a cluster in a VPC, a VLAN in a site): give the inner zone `"in": "<outer zone id>"` and a `kind` (`cloud`, `region`, `vpc`, `subnet`, `cluster`, `namespace`, `node`, `site`, `vlan`). See `SKILL/examples/kubernetes-platform.json` and `SKILL/examples/on-prem-site.json`.
- Let the layout be automatic when there are more than a handful of boxes: leave `x`, `y`, `w`, `h` off, put each box in its zone with `"in"`, and give edges `"from"` and `"to"` instead of `pts`. Preview and export lay it out (needs Node). `"free": 1` on an edge lets the boxes it joins stack in one column. To fine-tune by hand afterwards, `node SKILL/layout.js MODEL.json PLACED.json` writes the coordinates out.
- Coordinates on an 8 to 20 px grid; leave about 100 units at the top for the title and about 100 units between boxes where a labelled line runs; set `w` and `h` to fit (the key is added below `h`).
- Put the five contract lines in the model as `"contract": ["question", "reader", "must show", "left out", "where shown"]`; nothing draws them.
- `build.py preview` prints warnings about unlabelled lines between zones: fix them.

### 4. Preview it

```
python3 SKILL/build.py preview <out>/<id>.json <out>/<id>.preview.html
```

The page draws the user's diagram in every style, each with Download SVG and Download PNG buttons. It is self-contained (fonts and badges inlined). Show it: on the user's own computer, open it (`open`, `xdg-open` or `start ""`); elsewhere, present it as a file they can open, or publish it as a private artifact where the app offers one. If you cannot show HTML, run the export below with `all` instead of a look name and present those PNGs, or present `SKILL/thumbs/six-looks.png`.

The preview shows `clear` first. Use it unless the user named another look. Do not ask which look: draw in Clear and let the user switch by name. If the user asks which look suits a job, `python3 SKILL/build.py styles` says what each one is good for: recommend one.

### 5. Save it

If Node and Playwright with Chromium are available (`node -e "require('playwright')"` succeeds):

```
node SKILL/export.js <out>/<id>.json clear <out>/<id>
```

(or the look the user named: `Sketch`, `Isometric`, `dark` and so on; names and ids both work). This writes `<id>.svg` (fonts embedded) and `<id>.png` (2x). Add `--theme both` to also write the dark twins, `<id>-dark.svg` and `<id>-dark.png`, in the same run (for a README or docs site that switches with the reader's theme). If Playwright is not available, do not install it: tell the user to press Download SVG or Download PNG under the Clear style (or the one they picked) on the preview page.

If it reports text too long for its box, shorten the text or widen the node and run it again.

Other outputs from the same model, when they fit where the diagram will live: add `--theme dark` for a dark page, `--no-header` when the page around it carries the title, `--view sequence` to draw the numbered steps as a sequence diagram; `node SKILL/export.js <model> mermaid <out>` writes Mermaid for a README or ADR (add `--icons builtin` for GitHub), `... sequence <out>` a Mermaid sequence diagram, and `... drawio <out> --style <id>` a draw.io file someone can edit by hand. These text formats need only Node.

**Read back before you hand it over.** Open the PNG and describe it in a short paragraph as a cold reader would: what the title and key say, where the data starts, what it crosses, where it lands. Compare that paragraph with the contract: could the reader answer the question from the picture alone? Is everything under "must show" visible, and nothing under "left out"? Check that lines do not cross boxes or labels, every line between zones has its label, every colour is in the key and means one thing, and nothing is cramped. Go through the review checklist at the end of `SKILL/STANDARD.md`. Fix the model and export again. Stop after two rounds of fixes and show the user what you have, saying what you are unsure of.

Hand over the files and say the model is in `<id>.json`: switching look later is one export with another look name (`Sketch`, `Dark`...) or one preview away. Delete the preview HTML unless the user wants to keep it.

## Put a diagram on a page

When the user wants a page, an explainer, a blog post or a wiki page built around a diagram (or types `/diagrams:page`), build the page around it from three independent choices. Read "Putting a diagram on a page" in `SKILL/STANDARD.md` first; `SKILL/pages/README.md` has the layouts and the content keys.

1. **Layout**, by the reader's job: Explainer **A Scroll-along** or **B Plate**; Blog **C Long read** or **D Incident review**; Wiki **E Reference** or **F Explorer** (`node SKILL/page.js --list`).
2. **Look**: Clear (default), Sketch, Blueprint, Isometric, Dark, Infographic.
3. **Theme**: **Light** (default), **Dark**, or **Auto** (follows the reader's device). Every page has a Light / Dark / Auto toggle and carries both drawings, so page and diagram always switch together.

Draw the model first (steps 0 to 3 above). Then, by what the user said:

- **A named combination** ("page, Long read, Blueprint, dark"): build it directly.
- **"Show me all"**: `node SKILL/page.js <out>/<id>.json --sheet layouts --out <out>` draws the diagram once and writes `<id>-layouts.png` (and `.html`): the six layouts, lettered and named. Show the PNG and ask for a letter. Then `node SKILL/page.js <out>/<id>.json --sheet looks --layout <letter> --out <out>` writes `<id>-looks-<letter>.png`, that layout in the six looks; ask for a look. Then build it.
- **Nothing named**: show the pictures first. Present `SKILL/gallery.html` (or `SKILL/thumbs/gallery.png`) at its Layout and Mix sections and ask for a letter or a mix by its words ("Plate, Sketch"). If the user would rather you choose, recommend a layout by the reader's job (explain: A, or B when every zone needs a note; argue: C, or D for an incident; look up: E, or F for a drawing wider than about 1600 units) and build it in Clear with the Auto theme. For the user's own drawing on every layout, use "Show me all" above.

Write the page's words in `<out>/<id>.page.json` (keys in `SKILL/pages/README.md`): the title, the answer in one or two sentences before anything else, then the steps, notes, sections or timeline in the reader's words. Use the drawing's own numbers for steps (`n` is the step marker or zone number on the drawing). Leave out what you have nothing real to say about; the model fills the rest. Then:

```
node SKILL/page.js <out>/<id>.json --layout C --look clear --theme auto --content <out>/<id>.page.json --out <out>/<id>.html
```

Present the page as a file the user can open, or publish it as a private artifact where the app offers one. Open it before you hand it over: the answer comes first, the step numbers match the drawing, and nothing is squeezed.

