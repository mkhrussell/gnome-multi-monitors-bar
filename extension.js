import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {PanelManager} from './panelManager.js';
import {
    clearMonitorConnectors as clearIdentityConnectors,
    migrateMonitorSettings,
    refreshMonitorConnectors,
} from './monitorIdentity.js';
import {setTranslator} from './settings.js';

setTranslator(_);

export default class GNOMEMultiMonitorsBarV2Extension extends Extension {
    enable() {
        this._settings = this.getSettings();
        migrateMonitorSettings(this._settings);

        this._connectorsReady = false;
        refreshMonitorConnectors(() => {
            if (!this._settings)
                return;
            this._connectorsReady = true;
            migrateMonitorSettings(this._settings);
            this._manager?.sync();
        });

        this._manager = new PanelManager(this._settings);
    }

    disable() {
        this._manager?.destroy();
        this._manager = null;

        clearIdentityConnectors();
        this._settings = null;
    }
}
