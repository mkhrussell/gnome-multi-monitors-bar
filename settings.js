// Shared settings helpers. Free of GNOME Shell imports so prefs.js can reuse it.

export const SHOW_PANEL_KEY = 'show-panel';
export const SHOW_ACTIVITIES_KEY = 'show-activities';
export const SHOW_APP_MENU_KEY = 'show-app-menu';
export const SHOW_DATE_TIME_KEY = 'show-date-time';
export const SHOW_STATUS_KEY = 'show-status-indicators';
export const DATE_POSITION_KEY = 'date-time-position';
export const PANEL_COLOR_KEY = 'panel-color';
export const PANEL_LAYOUT_KEY = 'monitor-panel-layout';
export const CATALOG_KEY = 'monitor-indicator-catalog';
export const VISIBILITY_KEY = 'monitor-indicator-visibility';

export const PANEL_POSITIONS = ['top', 'bottom'];
export const DATE_POSITIONS = ['center', 'left', 'right-before-tray', 'right-after-tray'];

let translate = value => value;
export function setTranslator(gettext) {
    if (typeof gettext === 'function')
        translate = gettext;
}
function _(text) {
    return translate(text);
}

export const BUILTIN_ROLES = [
    'activities',
    'appMenu',
    'dateMenu',
    'quickSettings',
    'a11y',
    'keyboard',
    'dwellClick',
    'screenRecording',
    'screenSharing',
];

export const EXCLUDED_MIRROR_ROLES = [
    ...BUILTIN_ROLES,
    'screencast',
    'power',
    'unsafeModeIndicator',
    'backgroundApps',
];

export const ROLE_LABELS = {
    activities: 'Activities',
    appMenu: 'Application menu',
    dateMenu: 'Date and time',
    quickSettings: 'Quick Settings',
    a11y: 'Accessibility',
    keyboard: 'Keyboard layout',
    dwellClick: 'Dwell click',
    screenRecording: 'Screen recording',
    screenSharing: 'Screen sharing',
};

const ROLE_GLOBAL_KEYS = {
    activities: SHOW_ACTIVITIES_KEY,
    appMenu: SHOW_APP_MENU_KEY,
    dateMenu: SHOW_DATE_TIME_KEY,
    quickSettings: SHOW_STATUS_KEY,
    a11y: SHOW_STATUS_KEY,
    keyboard: SHOW_STATUS_KEY,
    dwellClick: SHOW_STATUS_KEY,
    screenRecording: SHOW_STATUS_KEY,
    screenSharing: SHOW_STATUS_KEY,
};

export function globalKeyForRole(role) {
    return ROLE_GLOBAL_KEYS[role] ?? null;
}

function readObject(settings, key) {
    try {
        const value = JSON.parse(settings.get_string(key));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

export function monitorKey(index, primaryIndex, connector = null) {
    if (index === primaryIndex)
        return 'main';
    return connector ? `connector:${connector}` : `monitor:${index}`;
}

export function migrateMonitorKeys(settings, key, monitors) {
    const stored = readObject(settings, key);
    let changed = false;

    for (const {index, connector} of monitors) {
        const legacy = `monitor:${index}`;
        if (!connector || !Object.hasOwn(stored, legacy))
            continue;

        const connectorKey = `connector:${connector}`;
        if (!Object.hasOwn(stored, connectorKey))
            stored[connectorKey] = stored[legacy];
        delete stored[legacy];
        changed = true;
    }

    if (changed)
        settings.set_string(key, JSON.stringify(stored));
}

export function readVisibility(settings) {
    return readObject(settings, VISIBILITY_KEY);
}

export function indicatorIsEnabled(settings, key, role, fallback = true) {
    const value = readVisibility(settings)[key]?.[role];
    if (typeof value === 'boolean')
        return value;
    const globalKey = globalKeyForRole(role);
    return globalKey ? settings.get_boolean(globalKey) : fallback;
}

export function setIndicatorEnabled(settings, key, role, enabled) {
    const visibility = readVisibility(settings);
    const entry = {
        ...(visibility[key] && typeof visibility[key] === 'object' ? visibility[key] : {}),
        [role]: enabled,
    };
    if (!Object.keys(entry).length)
        delete visibility[key];
    else
        visibility[key] = entry;
    settings.set_string(VISIBILITY_KEY, JSON.stringify(visibility));
}

export function readPanelLayout(settings) {
    return readObject(settings, PANEL_LAYOUT_KEY);
}

export function panelPosition(settings, key) {
    const position = readPanelLayout(settings)[key]?.position;
    return PANEL_POSITIONS.includes(position) ? position : 'top';
}

export function panelColor(settings, key) {
    const color = readPanelLayout(settings)[key]?.color;
    if (typeof color === 'string' && color)
        return color;
    return settings.get_string(PANEL_COLOR_KEY);
}

export function setPanelLayoutValue(settings, key, field, value) {
    const layout = readPanelLayout(settings);
    const entry = {...(layout[key] && typeof layout[key] === 'object' ? layout[key] : {})};

    if (value === null || value === undefined || value === '')
        delete entry[field];
    else
        entry[field] = value;

    if (Object.keys(entry).length)
        layout[key] = entry;
    else
        delete layout[key];

    settings.set_string(PANEL_LAYOUT_KEY, JSON.stringify(layout));
}

export function panelGeometry(monitor, position, thickness) {
    if (position === 'bottom') {
        return {
            x: monitor.x,
            y: monitor.y + monitor.height - thickness,
            width: monitor.width,
            height: thickness,
        };
    }

    return {
        x: monitor.x,
        y: monitor.y,
        width: monitor.width,
        height: thickness,
    };
}

export function panelColorDeclaration(color) {
    return color ? `background-color: ${color} !important;` : null;
}

export function mergePanelColorStyle(style, previous, next) {
    let base = style ?? '';
    if (previous)
        base = base.split(previous).join('');
    base = base.trim();
    const merged = next ? `${base} ${next}`.trim() : base;
    return merged || null;
}

const EXTERNAL_ROLE_NAMES = {
    ding: 'Desktop Icons NG',
    software_update_available: 'Software Updates',
    unattended_upgrade: 'Unattended Upgrades',
    statusnotifieritem: 'Application indicator',
};

function titleCase(text) {
    return text
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
        .map(word => word[0].toUpperCase() + word.slice(1))
        .join(' ');
}

export function roleLabel(role) {
    if (ROLE_LABELS[role])
        return _(ROLE_LABELS[role]);
    if (typeof role !== 'string' || !role)
        return String(role);

    if (role.startsWith('appindicator-')) {
        const id = role.slice('appindicator-'.length);
        const parts = id.split(/[/@]+/).filter(Boolean);
        const candidate = (parts.at(-1) ?? id)
            .replace(/-\d+(?:-\d+)*$/, '')
            .toLowerCase();

        if (EXTERNAL_ROLE_NAMES[candidate])
            return _(EXTERNAL_ROLE_NAMES[candidate]);
        if (candidate.includes('statusnotifieritem'))
            return _('Application indicator');

        const label = titleCase(candidate);
        return label ? `${_('Application indicator')} — ${label}` : _('Application indicator');
    }

    const name = role.split('@')[0];
    const mapped = EXTERNAL_ROLE_NAMES[name.toLowerCase()];
    if (mapped)
        return _(mapped);
    const label = titleCase(name);
    return label || role;
}

export function uniqueRoleLabels(roles) {
    const totals = new Map();
    for (const item of roles) {
        const label = item.label ?? roleLabel(item.role);
        totals.set(label, (totals.get(label) ?? 0) + 1);
    }

    const seen = new Map();
    return roles.map(item => {
        const label = item.label ?? roleLabel(item.role);
        const index = (seen.get(label) ?? 0) + 1;
        seen.set(label, index);
        return {
            ...item,
            label: totals.get(label) > 1 ? `${label} (${index})` : label,
        };
    });
}
