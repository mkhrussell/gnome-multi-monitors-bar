import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    CATALOG_KEY,
    DATE_POSITIONS,
    DATE_POSITION_KEY,
    PANEL_POSITIONS,
    ROLE_LABELS,
    SHOW_ACTIVITIES_KEY,
    SHOW_APP_MENU_KEY,
    SHOW_DATE_TIME_KEY,
    SHOW_PANEL_KEY,
    SHOW_STATUS_KEY,
    indicatorIsEnabled,
    panelColor,
    panelPosition,
    roleLabel,
    setIndicatorEnabled,
    setPanelLayoutValue,
    setTranslator,
    uniqueRoleLabels,
} from './settings.js';

setTranslator(_);

function readCatalog(settings) {
    try {
        const value = JSON.parse(settings.get_string(CATALOG_KEY));
        return value && typeof value === 'object' ? value : {};
    } catch {
        return {};
    }
}

function clearPreferencesGroup(group) {
    if (typeof group.remove_all === 'function') {
        group.remove_all();
        return;
    }
    if (typeof group.get_rows === 'function') {
        for (const row of [...group.get_rows()])
            group.remove(row);
        return;
    }
    let child = group.get_first_child?.();
    while (child) {
        const next = child.get_next_sibling();
        try {
            group.remove(child);
        } catch {
            // Ignore internal children.
        }
        child = next;
    }
}

function comboRow(title, values, selected, onChanged) {
    const row = new Adw.ComboRow({title, model: Gtk.StringList.new(values)});
    row.selected = Math.max(0, values.indexOf(selected));
    row.connect('notify::selected', () => onChanged(values[row.selected]));
    return row;
}

export default class GNOMEMultiMonitorsBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const signalIds = [];

        window.set_default_size(620, 720);

        const generalPage = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(generalPage);

        const behavior = new Adw.PreferencesGroup({
            title: _('Panels'),
            description: _('Top bar features shown on additional monitors.'),
        });
        generalPage.add(behavior);

        const switches = [
            [SHOW_PANEL_KEY, _('Show panels'), _('Create top bars on additional monitors.')],
            [SHOW_ACTIVITIES_KEY, _('Activities'), _('Show the Activities button.')],
            [SHOW_APP_MENU_KEY, _('Application menu'), _('Show the focused application menu.')],
            [SHOW_DATE_TIME_KEY, _('Date and time'), _('Show the clock and calendar menu.')],
            [SHOW_STATUS_KEY, _('Status indicators'), _('Show Quick Settings and status icons.')],
        ];

        for (const [key, title, subtitle] of switches) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            behavior.add(row);
        }

        behavior.add(comboRow(
            _('Date and time position'),
            DATE_POSITIONS,
            settings.get_string(DATE_POSITION_KEY),
            value => settings.set_string(DATE_POSITION_KEY, value)));

        const colorGroup = new Adw.PreferencesGroup({
            title: _('Default color'),
            description: _('Leave empty to follow the GNOME Shell theme.'),
        });
        generalPage.add(colorGroup);

        const colorRow = new Adw.ActionRow({title: _('Panel background')});
        const colorEntry = new Gtk.Entry({
            placeholder_text: _('Theme default'),
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });
        colorEntry.set_text(settings.get_string('panel-color'));
        colorEntry.connect('changed', () => settings.set_string('panel-color', colorEntry.get_text()));
        colorRow.add_suffix(colorEntry);
        colorGroup.add(colorRow);

        const monitorsPage = new Adw.PreferencesPage({
            title: _('Monitors'),
            icon_name: 'video-display-symbolic',
        });
        window.add(monitorsPage);

        const monitorGroup = new Adw.PreferencesGroup({
            title: _('Per-monitor settings'),
            description: _('Settings follow each monitor by connector name.'),
        });
        monitorsPage.add(monitorGroup);

        const rebuild = () => {
            clearPreferencesGroup(monitorGroup);
            const catalog = readCatalog(settings);
            const monitors = (catalog.monitors ?? []).filter(monitor => !monitor.primary);

            if (!monitors.length) {
                monitorGroup.add(new Adw.ActionRow({
                    title: _('No additional monitors detected'),
                    subtitle: _('Connect another monitor or enable the extension after logging in.'),
                }));
                return;
            }

            const catalogRoles = (catalog.roles ?? []).map(item =>
                typeof item === 'string' ? item : item?.role).filter(Boolean);
            const roles = uniqueRoleLabels(
                (catalogRoles.length ? catalogRoles : Object.keys(ROLE_LABELS))
                    .map(role => ({role, label: roleLabel(role)})));

            for (const monitor of monitors) {
                const key = monitor.key;
                const label = monitor.connector || key.replace(/^monitor:/, 'Monitor ');
                const expander = new Adw.ExpanderRow({
                    title: label,
                    subtitle: `${monitor.width}×${monitor.height}`,
                });
                monitorGroup.add(expander);

                expander.add_row(comboRow(
                    _('Position'),
                    PANEL_POSITIONS,
                    panelPosition(settings, key),
                    value => setPanelLayoutValue(settings, key, 'position', value)));

                const color = new Adw.ActionRow({title: _('Color override')});
                const entry = new Gtk.Entry({
                    placeholder_text: _('Use default'),
                    hexpand: true,
                    valign: Gtk.Align.CENTER,
                });
                entry.set_text(panelColor(settings, key) === settings.get_string('panel-color')
                    ? ''
                    : panelColor(settings, key));
                entry.connect('changed', () =>
                    setPanelLayoutValue(settings, key, 'color', entry.get_text() || null));
                color.add_suffix(entry);
                expander.add_row(color);

                for (const {role, label: roleTitle} of roles) {
                    const row = new Adw.SwitchRow({title: roleTitle ?? roleLabel(role)});
                    row.active = indicatorIsEnabled(settings, key, role);
                    row.connect('notify::active', () =>
                        setIndicatorEnabled(settings, key, role, row.active));
                    expander.add_row(row);
                }
            }
        };

        rebuild();
        signalIds.push(settings.connect(`changed::${CATALOG_KEY}`, rebuild));
        window.connect('close-request', () => {
            for (const id of signalIds)
                settings.disconnect(id);
            return false;
        });
    }
}
