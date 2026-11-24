// Creates and destroys one secondary top bar per non-primary monitor.

import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    EXCLUDED_MIRROR_ROLES,
    PANEL_LAYOUT_KEY,
    ROLE_LABELS,
    SHOW_PANEL_KEY,
    panelGeometry,
    panelPosition,
    roleLabel,
    uniqueRoleLabels,
} from './settings.js';
import {currentMonitorKey, monitorConnector, publishCatalog} from './monitorIdentity.js';
import {SecondaryPanel} from './panel.js';

class PanelChrome {
    constructor(monitor, position) {
        this._monitor = monitor;
        this._position = position;
        this._destroyed = false;
        this._geometryIdle = 0;
        this._allocationId = 0;

        this.actor = new St.BoxLayout({
            name: 'panelBox',
            clip_to_allocation: true,
            visible: true,
        });

        Main.layoutManager.addChrome(this.actor, {affectsStruts: true});
        Main.uiGroup.set_child_below_sibling(
            this.actor, Main.layoutManager.panelBox);

        global.display.connectObject(
            'in-fullscreen-changed', () => this._syncFullscreen(), this.actor);
        global.window_group.connectObject(
            'notify::visible', () => this._syncFullscreen(), this.actor);

        this._allocationId = this.actor.connect('notify::allocation',
            () => this._queueGeometry());
        this._syncFullscreen();
        this._applyGeometry();
    }

    get thickness() {
        if (Main.panel) {
            const [, height] = Main.panel.get_preferred_height(-1);
            if (height > 0)
                return Math.round(height);
        }
        return Math.round(Main.layoutManager.panelBox.height || 30);
    }

    geometry() {
        return panelGeometry(this._monitor, this._position, this.thickness);
    }

    update(monitor, position) {
        if (this._destroyed)
            return;
        this._monitor = monitor;
        this._position = position;
        this._syncFullscreen();
        this._applyGeometry();
    }

    setPosition(position) {
        if (this._destroyed || this._position === position)
            return;
        this._position = position;
        this._applyGeometry();
    }

    _syncFullscreen() {
        if (this._destroyed)
            return;
        const index = this._monitor.index;
        const monitor = Main.layoutManager.monitors[index];
        const fullscreen = global.window_group.visible && !!monitor?.inFullscreen;
        this.actor.visible = !fullscreen;
    }

    _queueGeometry() {
        if (this._destroyed || this._geometryIdle)
            return;
        this._geometryIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._geometryIdle = 0;
            this._applyGeometry();
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyGeometry() {
        if (this._destroyed)
            return;
        const geometry = this.geometry();
        if (Math.round(this.actor.x) === geometry.x &&
            Math.round(this.actor.y) === geometry.y &&
            Math.round(this.actor.width) === geometry.width &&
            Math.round(this.actor.height) === geometry.height) {
            return;
        }

        this.actor.set_position(geometry.x, geometry.y);
        this.actor.set_size(geometry.width, geometry.height);
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;

        if (this._geometryIdle)
            GLib.source_remove(this._geometryIdle);
        if (this._allocationId)
            this.actor.disconnect(this._allocationId);

        global.display.disconnectObject(this.actor);
        global.window_group.disconnectObject(this.actor);
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
    }
}

export class PanelManager {
    constructor(settings) {
        this._settings = settings;
        this._entries = new Map();
        this._destroyed = false;
        this._syncIdle = 0;
        this._geometryIdle = 0;
        this._originalAddToStatusArea = null;

        this._patchStatusArea();

        Main.layoutManager.connectObject(
            'monitors-changed', () => this._queueSync(), this);
        global.display.connectObject(
            'workareas-changed', () => this._queueGeometry(), this);
        Main.sessionMode.connectObject('updated', () => this._queueSync(), this);
        settings.connectObject(
            `changed::${SHOW_PANEL_KEY}`, () => this._queueSync(), this);
        settings.connectObject(
            `changed::${PANEL_LAYOUT_KEY}`, () => this._queueSync(), this);

        this.sync();
    }

    _patchStatusArea() {
        const panel = Main.panel;
        if (!panel)
            return;
        this._originalAddToStatusArea = panel.addToStatusArea;
        panel.addToStatusArea = (...args) => {
            const indicator = this._originalAddToStatusArea.apply(panel, args);
            this._queueSync();
            return indicator;
        };
    }

    _queueSync() {
        if (this._destroyed || this._syncIdle)
            return;
        this._syncIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._syncIdle = 0;
            this.sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _queueGeometry() {
        if (this._destroyed || this._geometryIdle)
            return;
        this._geometryIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._geometryIdle = 0;
            for (const entry of this._entries.values()) {
                const monitor = Main.layoutManager.monitors[entry.index];
                if (!monitor)
                    continue;
                entry.chrome.update(monitor, entry.position);
                entry.panel.set_size(entry.chrome.actor.width, entry.chrome.actor.height);
                entry.panel.queue_relayout();
            }
            Main.layoutManager._updateRegions?.();
            return GLib.SOURCE_REMOVE;
        });
    }

    _roleCatalog() {
        const roles = new Set(Object.keys(ROLE_LABELS));
        for (const role of Object.keys(Main.panel?.statusArea ?? {})) {
            if (!EXCLUDED_MIRROR_ROLES.includes(role))
                roles.add(role);
        }
        return uniqueRoleLabels(
            [...roles].map(role => ({role, label: roleLabel(role)})));
    }

    sync() {
        if (this._destroyed)
            return;

        publishCatalog(this._settings, this._roleCatalog());

        if (!this._settings.get_boolean(SHOW_PANEL_KEY)) {
            this._destroyAll();
            return;
        }

        const primary = Main.layoutManager.primaryIndex;
        const desired = new Set();

        for (let index = 0; index < Main.layoutManager.monitors.length; index++) {
            if (index === primary)
                continue;
            desired.add(index);

            const monitor = Main.layoutManager.monitors[index];
            const key = currentMonitorKey(index);
            const position = panelPosition(this._settings, key);
            let entry = this._entries.get(index);

            if (entry && entry.key !== key) {
                this._destroyEntry(entry);
                this._entries.delete(index);
                entry = null;
            }

            if (!entry) {
                const chrome = new PanelChrome(monitor, position);
                const panel = new SecondaryPanel(
                    index, this._settings, monitorConnector(index));
                chrome.actor.add_child(panel);

                const geometry = chrome.geometry();
                panel.set_size(geometry.width, geometry.height);

                entry = {index, key, position, chrome, panel};
                this._entries.set(index, entry);
            } else if (entry.position !== position) {
                entry.chrome.setPosition(position);
                entry.position = position;
            }

            entry.chrome.update(monitor, position);
            const geometry = entry.chrome.geometry();
            entry.panel.set_size(geometry.width, geometry.height);
            entry.panel.queue_relayout();
            entry.panel._syncExternalIndicators?.();
        }

        for (const [index, entry] of [...this._entries]) {
            if (!desired.has(index)) {
                this._destroyEntry(entry);
                this._entries.delete(index);
            }
        }

        Main.layoutManager._updateRegions?.();
    }

    _destroyEntry(entry) {
        entry.panel.destroy();
        entry.chrome.destroy();
    }

    _destroyAll() {
        for (const entry of this._entries.values())
            this._destroyEntry(entry);
        this._entries.clear();
        Main.layoutManager._updateRegions?.();
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;

        if (this._syncIdle)
            GLib.source_remove(this._syncIdle);
        if (this._geometryIdle)
            GLib.source_remove(this._geometryIdle);

        Main.layoutManager.disconnectObject(this);
        global.display.disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
        this._settings.disconnectObject(this);

        if (this._originalAddToStatusArea && Main.panel)
            Main.panel.addToStatusArea = this._originalAddToStatusArea;

        this._destroyAll();
    }
}
