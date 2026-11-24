# GNOME Multi Monitors Bar

A GNOME Shell extension that adds top bars to additional monitors.

This version is built by starting from the **installed Ubuntu GNOME Shell panel code**
(extracted from `libshell-18.so`, `org.gnome.shell.ui.panel`) and adapting it for
secondary-monitor use. The unmodified upstream sources are kept in `upstream/` for
provenance and diffing.

## Target

- GNOME Shell 50+ (developed against Ubuntu 26.04 / GNOME Shell 50.1)
- Extension UUID: `gnome-multi-monitors-bar@kamrul`
- Schema: `org.gnome.shell.extensions.gnome-multi-monitors-bar`

## What it does

- Creates a top bar on each non-primary monitor.
- Reuses upstream GNOME Shell panel widgets (Activities/workspace dots, date menu,
  Quick Settings, accessibility/keyboard/screen sharing indicators).
- Adds optional app menu support (GNOME 45+ removed it from default session modes).
- Mirrors third-party status indicators from the primary panel using Clutter clones.
- Supports per-monitor position, color override, and per-indicator visibility.
- Stores monitor settings by physical connector when available.

## Repository layout

- `upstream/` - unmodified Ubuntu GNOME Shell sources extracted for reference.
- `panel.js` - secondary panel adapted from upstream `ui/panel.js`.
- `panelManager.js` - monitor/chrome lifecycle and external indicator sync.
- `statusMirror.js` - clone/retarget mirror for extension-owned indicators.
- `monitorIdentity.js` - connector-based monitor identity/catalog.
- `settings.js` - shared settings/helpers (shell + prefs).
- `extension.js` - extension entry point.
- `prefs.js` - Adw preferences.
- `schemas/` - GSettings schema.

## Development notes

- Do **not** install/run/modify system files without explicit confirmation.
- Compile schemas after schema changes: `./build.sh`
- Upstream base: `gnome-shell 50.1-0ubuntu1` (Ubuntu 26.04).

## Status

Scaffolded and statically checked. Runtime validation on a live GNOME Shell session
is still needed before install/use.