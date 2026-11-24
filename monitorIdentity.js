// Shell-side monitor identity. Mutter renumbers monitors, so per-monitor
// settings are keyed by physical connector when available.

import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    CATALOG_KEY,
    PANEL_LAYOUT_KEY,
    VISIBILITY_KEY,
    migrateMonitorKeys,
    monitorKey,
} from './settings.js';

const DISPLAY_CONFIG_NAME = 'org.gnome.Mutter.DisplayConfig';
const DISPLAY_CONFIG_PATH = '/org/gnome/Mutter/DisplayConfig';

let connectorNames = [];
let cancellable = null;

export function monitorConnector(index) {
    const manager = global.backend?.get_monitor_manager?.();
    if (!manager)
        return null;
    return connectorNames.find(name =>
        manager.get_monitor_for_connector(name) === index) ?? null;
}

export function refreshMonitorConnectors(onChanged) {
    cancellable?.cancel();
    const pending = cancellable = new Gio.Cancellable();

    Gio.DBus.session.call(
        DISPLAY_CONFIG_NAME,
        DISPLAY_CONFIG_PATH,
        DISPLAY_CONFIG_NAME,
        'GetCurrentState',
        null,
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        pending,
        (_connection, result) => {
            if (cancellable === pending)
                cancellable = null;

            let reply;
            try {
                reply = _connection.call_finish(result);
            } catch (error) {
                if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.warn(`[MultiMonitorsBar] Could not read connectors: ${error.message}`);
                return;
            }

            const [, monitors] = reply.deep_unpack();
            const names = monitors.map(([[connector]]) => connector).sort();
            if (names.join('\n') === connectorNames.join('\n'))
                return;

            connectorNames = names;
            onChanged();
        });
}

export function clearMonitorConnectors() {
    cancellable?.cancel();
    cancellable = null;
    connectorNames = [];
}

export function currentMonitorKey(index) {
    const primary = Main.layoutManager.primaryIndex;
    return monitorKey(index, primary, index === primary ? null : monitorConnector(index));
}

export function migrateMonitorSettings(settings) {
    const primary = Main.layoutManager.primaryIndex;
    const monitors = Main.layoutManager.monitors
        .map((_monitor, index) => ({
            index,
            connector: index === primary ? null : monitorConnector(index),
        }))
        .filter(monitor => monitor.connector);

    for (const key of [VISIBILITY_KEY, PANEL_LAYOUT_KEY])
        migrateMonitorKeys(settings, key, monitors);
}

export function publishCatalog(settings, roles = []) {
    const primary = Main.layoutManager.primaryIndex;
    const monitors = Main.layoutManager.monitors.map((monitor, index) => ({
        key: currentMonitorKey(index),
        primary: index === primary,
        connector: monitorConnector(index),
        width: monitor.width,
        height: monitor.height,
    }));

    const catalog = {monitors, roles, version: 1};
    const encoded = JSON.stringify(catalog);
    if (settings.get_string(CATALOG_KEY) !== encoded)
        settings.set_string(CATALOG_KEY, encoded);
}
