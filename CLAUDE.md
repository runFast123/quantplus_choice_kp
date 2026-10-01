@AGENTS.md

Claude-specific notes:
- UI work: the `ui-ux-pro-max` skill is installed in `.claude/skills/`. The project's design system is already
  decided — read `design-system/quantspulse/MASTER.md` and follow it; don't regenerate a new palette.
- The 21st.dev MCP (`.mcp.json`) can `search` / `get_theme` for free; `get_component` costs the owner credits — ask first.
- Charts: load the `dataviz` skill before writing chart code; gain/loss colors are already validated (see MASTER.md).
