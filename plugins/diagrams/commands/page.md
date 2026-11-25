---
description: Build a page around a diagram: pick a layout (A Scroll-along, B Plate, C Long read, D Incident review, E Reference, F Explorer), a look and a theme (Light, Dark or Auto), or say "show me all" to pick from pictures.
argument-hint: "[layout] [look] [light|dark|auto] | show me all"
---

Use the `draw` skill from this plugin and follow its "Put a diagram on a page" part. The request: $ARGUMENTS

- A named combination ("Long read, Blueprint, dark"): build that page directly.
- "Show me all": draw the diagram once, show the six layouts on one sheet (lettered and named), let the user pick one, show that layout in the six looks, let the user pick again, then build it.
- Nothing named: ask one question (explain it, argue a point, or let people look things up?), recommend a layout, and build it in Clear with the Auto theme.
