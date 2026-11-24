# GNOME Multi Monitors Bar V2

A GNOME Shell extension that adds top bars to additional monitors.

This version is built by starting from the installed Ubuntu GNOME Shell panel code
(`org.gnome.shell.ui.panel`) and adapting it for secondary-monitor use.

## Status

Initial skeleton - implementation in progress.

## Development

- Target: GNOME Shell 50+ (Ubuntu 26.04)
- Extension UUID: `gnome-multi-monitors-bar-v2@kamrul`
- Do not install or run on the system without explicit confirmation.

## Provenance

Base panel implementation extracted from:

- `/usr/lib/gnome-shell/libshell-18.so` gresource `/org/gnome/shell/ui/panel.js`
- Ubuntu package: `gnome-shell 50.1-0ubuntu1`
