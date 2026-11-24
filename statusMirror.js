// Generic mirror for status-area indicators added by other extensions.
// Extension-owned indicators cannot be re-parented into multiple panels, so we
// draw a Clutter clone and temporarily retarget the source menu while open.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {roleLabel} from './settings.js';

export const StatusIndicatorMirror = GObject.registerClass(
class StatusIndicatorMirror extends PanelMenu.Button {
    _init(panel, role, source) {
        super._init(0.0, null, true);

        this._panel = panel;
        this._role = role;
        this._source = source;
        this._sourceActor = source?.container ?? source ?? null;
        this._menuRestore = null;
        this._menuCloseId = 0;

        this.set_accessible_name(roleLabel(role));
        this.reactive = true;

        this._box = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
            x_expand: false,
            y_expand: false,
        });
        this.add_child(this._box);

        if (this._sourceActor) {
            this._clone = new Clutter.Clone({
                source: this._sourceActor,
                reactive: false,
            });
            this._box.add_child(this._clone);

            this._sourceActor.connectObject(
                'notify::allocation', () => this._sync(),
                'notify::visible', () => this._sync(),
                'notify::mapped', () => this._sync(),
                this);
            this._source.connectObject('destroy', () => this.destroy(), this);
        }

        this.connectObject('destroy', () => this._cleanup(), this);
        this._sync();
    }

    _sync() {
        if (this._sourceActor) {
            const width = Math.max(1, Math.round(this._sourceActor.width));
            const height = Math.max(1, Math.round(this._sourceActor.height));

            this._clone?.set_size(width, height);
            this._box.set_size(width, height);
            this.set_size(width, height);
            this.visible = this._sourceActor.visible;
        }
        this.queue_relayout();
    }

    _openMenu() {
        const menu = this._source?.menu;
        if (!menu)
            return Clutter.EVENT_PROPAGATE;

        if (menu.isOpen)
            menu.close();

        const previousMenuSource = menu.sourceActor;
        const previousBoxSource = menu.actor?._sourceActor ?? null;

        menu.sourceActor = this;
        if (menu.actor)
            menu.actor._sourceActor = this;

        this._menuRestore = () => {
            menu.sourceActor = previousMenuSource;
            if (menu.actor)
                menu.actor._sourceActor = previousBoxSource;
        };

        if (this._menuCloseId)
            menu.disconnect(this._menuCloseId);

        this._menuCloseId = menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen)
                return;
            menu.disconnect(this._menuCloseId);
            this._menuCloseId = 0;
            this._menuRestore?.();
            this._menuRestore = null;
        });

        menu.open();
        return Clutter.EVENT_STOP;
    }

    vfunc_button_press_event(_event) {
        return this._openMenu();
    }

    vfunc_key_press_event(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter ||
            symbol === Clutter.KEY_space) {
            this._openMenu();
            return Clutter.EVENT_STOP;
        }
        return super.vfunc_key_press_event(event);
    }

    _cleanup() {
        if (this._menuCloseId && this._source?.menu) {
            this._source.menu.disconnect(this._menuCloseId);
            this._menuCloseId = 0;
        }
        this._menuRestore?.();
        this._menuRestore = null;

        this._source?.disconnectObject(this);
        this._sourceActor?.disconnectObject(this);
        this._source = null;
        this._sourceActor = null;
    }
});
