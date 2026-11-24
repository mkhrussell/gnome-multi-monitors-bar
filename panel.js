/* Secondary GNOME Shell panel for additional monitors.
 *
 * Based on Ubuntu GNOME Shell 50 panel.js (libshell-18 gresource), adapted for
 * per-monitor use in an extension. Upstream provenance is preserved in
 * upstream/panel.js.
 */

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';
import {Spinner} from 'resource:///org/gnome/shell/ui/animation.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import {ANIMATION_TIME} from 'resource:///org/gnome/shell/ui/overview.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {QuickSettingsMenu, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import * as RemoteAccessStatus from 'resource:///org/gnome/shell/ui/status/remoteAccess.js';
import * as PowerProfileStatus from 'resource:///org/gnome/shell/ui/status/powerProfiles.js';
import * as RFKillStatus from 'resource:///org/gnome/shell/ui/status/rfkill.js';
import * as CameraStatus from 'resource:///org/gnome/shell/ui/status/camera.js';
import * as VolumeStatus from 'resource:///org/gnome/shell/ui/status/volume.js';
import * as BrightnessStatus from 'resource:///org/gnome/shell/ui/status/brightness.js';
import * as SystemStatus from 'resource:///org/gnome/shell/ui/status/system.js';
import * as LocationStatus from 'resource:///org/gnome/shell/ui/status/location.js';
import * as NightLightStatus from 'resource:///org/gnome/shell/ui/status/nightLight.js';
import * as DarkModeStatus from 'resource:///org/gnome/shell/ui/status/darkMode.js';
import * as DoNotDisturb from 'resource:///org/gnome/shell/ui/status/doNotDisturb.js';
import * as BacklightStatus from 'resource:///org/gnome/shell/ui/status/backlight.js';
import * as ThunderboltStatus from 'resource:///org/gnome/shell/ui/status/thunderbolt.js';
import * as AutoRotateStatus from 'resource:///org/gnome/shell/ui/status/autoRotate.js';
import * as BackgroundAppsStatus from 'resource:///org/gnome/shell/ui/status/backgroundApps.js';

import {DateMenuButton} from 'resource:///org/gnome/shell/ui/dateMenu.js';
import {ATIndicator} from 'resource:///org/gnome/shell/ui/status/accessibility.js';
import {InputSourceIndicator} from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import {DwellClickIndicator} from 'resource:///org/gnome/shell/ui/status/dwellClick.js';
import {ScreenRecordingIndicator, ScreenSharingIndicator} from 'resource:///org/gnome/shell/ui/status/remoteAccess.js';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {StatusIndicatorMirror} from './statusMirror.js';
import {
    BUILTIN_ROLES,
    DATE_POSITIONS,
    EXCLUDED_MIRROR_ROLES,
    indicatorIsEnabled,
    mergePanelColorStyle,
    monitorKey,
    panelColor,
    panelColorDeclaration,
    setTranslator,
} from './settings.js';

setTranslator(_);

const PANEL_ICON_SIZE = 16;
const APP_MENU_ICON_MARGIN = 0;

const BUTTON_DND_ACTIVATION_TIMEOUT = 250;

const N_QUICK_SETTINGS_COLUMNS = 2;

const INACTIVE_WORKSPACE_DOT_SCALE = 0.75;

const WorkspaceDot = GObject.registerClass({
    Properties: {
        'expansion': GObject.ParamSpec.double('expansion', null, null,
            GObject.ParamFlags.READWRITE,
            0.0, 1.0, 0.0),
        'width-multiplier': GObject.ParamSpec.double(
            'width-multiplier', null, null,
            GObject.ParamFlags.READWRITE,
            1.0, 10.0, 1.0),
    },
}, class WorkspaceDot extends Clutter.Actor {
    constructor(params = {}) {
        super({
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
            ...params,
        });

        this._dot = new St.Widget({
            style_class: 'workspace-dot',
            y_align: Clutter.ActorAlign.CENTER,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
            request_mode: Clutter.RequestMode.WIDTH_FOR_HEIGHT,
        });
        this.add_child(this._dot);

        this.connect('notify::width-multiplier', () => this.queue_relayout());
        this.connect('notify::expansion', () => {
            this._updateVisuals();
            this.queue_relayout();
        });
        this._updateVisuals();

        this._destroying = false;
    }

    _updateVisuals() {
        const {expansion} = this;

        this._dot.set({
            opacity: Util.lerp(0.50, 1.0, expansion) * 255,
            scaleX: Util.lerp(INACTIVE_WORKSPACE_DOT_SCALE, 1.0, expansion),
            scaleY: Util.lerp(INACTIVE_WORKSPACE_DOT_SCALE, 1.0, expansion),
        });
    }

    vfunc_get_preferred_width(forHeight) {
        const factor = Util.lerp(1.0, this.widthMultiplier, this.expansion);
        return this._dot.get_preferred_width(forHeight).map(v => Math.round(v * factor));
    }

    vfunc_get_preferred_height(forWidth) {
        return this._dot.get_preferred_height(forWidth);
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        box.set_origin(0, 0);
        this._dot.allocate(box);
    }

    scaleIn() {
        this.set({
            scale_x: 0,
            scale_y: 0,
        });

        this.ease({
            duration: 500,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            scale_x: 1.0,
            scale_y: 1.0,
        });
    }

    scaleOutAndDestroy() {
        this._destroying = true;

        this.ease({
            duration: 500,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            scale_x: 0.0,
            scale_y: 0.0,
            onComplete: () => this.destroy(),
        });
    }

    get destroying() {
        return this._destroying;
    }
});

const WorkspaceIndicators = GObject.registerClass(
class WorkspaceIndicators extends St.BoxLayout {
    constructor() {
        super();

        this._workspacesAdjustment = Main.createWorkspacesAdjustment(this);
        this._workspacesAdjustment.connectObject(
            'notify::value', () => this._updateExpansion(),
            'notify::upper', () => this._recalculateDots(),
            this);

        for (let i = 0; i < this._workspacesAdjustment.upper; i++)
            this.insert_child_at_index(new WorkspaceDot(), i);
        this._updateExpansion();
    }

    _getActiveIndicators() {
        return [...this].filter(i => !i.destroying);
    }

    _recalculateDots() {
        const activeIndicators = this._getActiveIndicators();
        const nIndicators = activeIndicators.length;
        const targetIndicators = this._workspacesAdjustment.upper;

        let remaining = Math.abs(nIndicators - targetIndicators);
        while (remaining--) {
            if (nIndicators < targetIndicators) {
                const indicator = new WorkspaceDot();
                this.add_child(indicator);
                indicator.scaleIn();
            } else {
                const indicator = activeIndicators[nIndicators - remaining - 1];
                indicator.scaleOutAndDestroy();
            }
        }

        this._updateExpansion();
    }

    _updateExpansion() {
        const nIndicators = this._getActiveIndicators().length;
        const activeWorkspace = this._workspacesAdjustment.value;

        let widthMultiplier;
        if (nIndicators <= 2)
            widthMultiplier = 3.625;
        else if (nIndicators <= 5)
            widthMultiplier = 3.25;
        else
            widthMultiplier = 2.75;

        this.get_children().forEach((indicator, index) => {
            const distance = Math.abs(index - activeWorkspace);
            indicator.expansion = Math.clamp(1 - distance, 0, 1);
            indicator.widthMultiplier = widthMultiplier;
        });
    }
});

const ActivitiesButton = GObject.registerClass(
class ActivitiesButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, null, true);

        this.set({
            name: 'panelActivities',
            accessible_role: Atk.Role.TOGGLE_BUTTON,
            /* Translators: If there is no suitable word for "Activities"
               in your language, you can use the word for "Overview". */
            accessible_name: _('Activities'),
        });

        this.add_child(new WorkspaceIndicators());

        Main.overview.connectObject('showing',
            () => this.add_style_pseudo_class('checked'),
            this);
        Main.overview.connectObject('hiding',
            () => this.remove_style_pseudo_class('checked'),
            this);

        this._xdndTimeOut = 0;

        this._clickGesture = new Clutter.ClickGesture();
        this._clickGesture.connect('recognize', () => {
            if (Main.overview.shouldToggleByCornerOrButton())
                Main.overview.toggle();
        });
        this.add_action(this._clickGesture);
    }

    handleDragOver(source, _actor, _x, _y, _time) {
        if (source !== Main.xdndHandler)
            return DND.DragMotionResult.CONTINUE;

        if (this._xdndTimeOut !== 0)
            GLib.source_remove(this._xdndTimeOut);
        this._xdndTimeOut = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, BUTTON_DND_ACTIVATION_TIMEOUT, () => {
            this._xdndToggleOverview();
        });
        GLib.Source.set_name_by_id(this._xdndTimeOut, '[gnome-shell] this._xdndToggleOverview');

        return DND.DragMotionResult.CONTINUE;
    }

    vfunc_scroll_event(event) {
        return Main.wm.handleWorkspaceScroll(event);
    }

    vfunc_key_release_event(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_space) {
            if (Main.overview.shouldToggleByCornerOrButton()) {
                Main.overview.toggle();
                return Clutter.EVENT_STOP;
            }
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _xdndToggleOverview() {
        const [x, y] = global.get_pointer();
        const pickedActor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);

        if (pickedActor === this && Main.overview.shouldToggleByCornerOrButton())
            Main.overview.toggle();

        GLib.source_remove(this._xdndTimeOut);
        this._xdndTimeOut = 0;
    }
});

const UnsafeModeIndicator = GObject.registerClass(
class UnsafeModeIndicator extends SystemIndicator {
    _init() {
        super._init();

        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'channel-insecure-symbolic';

        global.context.bind_property('unsafe-mode',
            this._indicator, 'visible',
            GObject.BindingFlags.SYNC_CREATE);
    }
});

const QuickSettings = GObject.registerClass(
class QuickSettings extends PanelMenu.Button {
    constructor() {
        super(0.0, C_('System menu in the top bar', 'System'), true);

        this._indicators = new St.BoxLayout({
            style_class: 'panel-status-indicators-box',
        });
        this.add_child(this._indicators);

        this.setMenu(new QuickSettingsMenu(this, N_QUICK_SETTINGS_COLUMNS));

        this._setupIndicators().catch(error =>
            logError(error, 'Failed to setup quick settings'));
    }

    async _setupIndicators() {
        if (Config.HAVE_NETWORKMANAGER) {
            const NetworkStatus = await import('resource:///org/gnome/shell/ui/status/network.js');
            this._network = new NetworkStatus.Indicator();
        } else {
            this._network = null;
        }

        if (Config.HAVE_BLUETOOTH) {
            const BluetoothStatus = await import('resource:///org/gnome/shell/ui/status/bluetooth.js');
            this._bluetooth = new BluetoothStatus.Indicator();
        } else {
            this._bluetooth = null;
        }

        this._system = new SystemStatus.Indicator();
        this._camera = new CameraStatus.Indicator();
        this._volumeOutput = new VolumeStatus.OutputIndicator();
        this._volumeInput = new VolumeStatus.InputIndicator();
        this._brightness = new BrightnessStatus.Indicator();
        this._remoteAccess = new RemoteAccessStatus.RemoteAccessApplet();
        this._location = new LocationStatus.Indicator();
        this._thunderbolt = new ThunderboltStatus.Indicator();
        this._nightLight = new NightLightStatus.Indicator();
        this._darkMode = new DarkModeStatus.Indicator();
        this._doNotDisturb = new DoNotDisturb.Indicator();
        this._backlight = new BacklightStatus.Indicator();
        this._powerProfiles = new PowerProfileStatus.Indicator();
        this._rfkill = new RFKillStatus.Indicator();
        this._autoRotate = new AutoRotateStatus.Indicator();
        this._unsafeMode = new UnsafeModeIndicator();
        this._backgroundApps = new BackgroundAppsStatus.Indicator();

        let pos = 0;
        this._indicators.insert_child_at_index(this._remoteAccess, pos++);
        this._indicators.insert_child_at_index(this._camera, pos++);
        this._indicators.insert_child_at_index(this._volumeInput, pos++);
        this._indicators.insert_child_at_index(this._location, pos++);

        this._indicators.add_child(this._brightness);
        this._indicators.add_child(this._thunderbolt);
        this._indicators.add_child(this._nightLight);
        if (this._network)
            this._indicators.add_child(this._network);
        this._indicators.add_child(this._darkMode);
        this._indicators.add_child(this._doNotDisturb);
        this._indicators.add_child(this._backlight);
        if (this._bluetooth)
            this._indicators.add_child(this._bluetooth);
        this._indicators.add_child(this._rfkill);
        this._indicators.add_child(this._autoRotate);
        this._indicators.add_child(this._volumeOutput);
        this._indicators.add_child(this._unsafeMode);
        this._indicators.add_child(this._powerProfiles);
        this._indicators.add_child(this._system);

        const sibling = this.menu.getFirstItem();
        this._addItemsBefore(this._system.quickSettingsItems, sibling, N_QUICK_SETTINGS_COLUMNS);
        this._addItemsBefore(this._volumeOutput.quickSettingsItems, sibling, N_QUICK_SETTINGS_COLUMNS);
        this._addItemsBefore(this._volumeInput.quickSettingsItems, sibling, N_QUICK_SETTINGS_COLUMNS);
        this._addItemsBefore(this._brightness.quickSettingsItems, sibling, N_QUICK_SETTINGS_COLUMNS);

        this._addItemsBefore(this._camera.quickSettingsItems, sibling);
        this._addItemsBefore(this._remoteAccess.quickSettingsItems, sibling);
        this._addItemsBefore(this._thunderbolt.quickSettingsItems, sibling);
        this._addItemsBefore(this._location.quickSettingsItems, sibling);
        if (this._network)
            this._addItemsBefore(this._network.quickSettingsItems, sibling);
        if (this._bluetooth)
            this._addItemsBefore(this._bluetooth.quickSettingsItems, sibling);
        this._addItemsBefore(this._powerProfiles.quickSettingsItems, sibling);
        this._addItemsBefore(this._nightLight.quickSettingsItems, sibling);
        this._addItemsBefore(this._darkMode.quickSettingsItems, sibling);
        this._addItemsBefore(this._doNotDisturb.quickSettingsItems, sibling);
        this._addItemsBefore(this._backlight.quickSettingsItems, sibling);
        this._addItemsBefore(this._rfkill.quickSettingsItems, sibling);
        this._addItemsBefore(this._autoRotate.quickSettingsItems, sibling);
        this._addItemsBefore(this._unsafeMode.quickSettingsItems, sibling);

        this._backgroundApps.quickSettingsItems.forEach(
            item => this.menu.addItem(item, N_QUICK_SETTINGS_COLUMNS));

        this._seedAudioDevices();
    }

    _addItemsBefore(items, sibling, colSpan = 1) {
        items.forEach(item => this.menu.insertItemBefore(item, sibling, colSpan));
    }

    _seedAudioDevices() {
        const control = VolumeStatus.getMixerControl();
        const uiDeviceId = stream =>
            stream ? control.lookup_device_from_stream?.(stream)?.get_id?.() : undefined;

        const seed = () => {
            for (const sink of control.get_sinks?.() ?? []) {
                const id = uiDeviceId(sink);
                if (id !== undefined)
                    this._volumeOutput?._output?._addDevice(id);
            }
            const defaultSinkId = uiDeviceId(control.get_default_sink?.());
            if (defaultSinkId !== undefined)
                this._volumeOutput?._output?._setActiveDevice(defaultSinkId);

            for (const source of control.get_sources?.() ?? []) {
                const id = uiDeviceId(source);
                if (id !== undefined)
                    this._volumeInput?._input?._addDevice(id);
            }
            const defaultSourceId = uiDeviceId(control.get_default_source?.());
            if (defaultSourceId !== undefined)
                this._volumeInput?._input?._setActiveDevice(defaultSourceId);
        };

        seed();
        control.connectObject('state-changed', seed, this);
    }

    addExternalIndicator(indicator, colSpan = 1) {
        let sibling = this._brightness ?? null;
        this._indicators.insert_child_below(indicator, sibling);
        sibling = this._backgroundApps?.quickSettingsItems?.at(-1) ?? null;
        this._addItemsBefore(indicator.quickSettingsItems, sibling, colSpan);
    }
});

const AppMenuButton = GObject.registerClass({
    Signals: {changed: {}},
}, class AppMenuButton extends PanelMenu.Button {
    _init(panel) {
        super._init(0.0, null, true);
        this.accessible_role = Atk.Role.MENU;
        this._startingApps = [];
        this._targetApp = null;
        this._menuManager = panel.menuManager;

        const bin = new St.Bin({name: 'appMenu'});
        this.add_child(bin);
        this.bind_property('reactive', this, 'can-focus', 0);
        this.reactive = false;

        this._container = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        bin.set_child(this._container);

        St.TextureCache.get_default().connectObject(
            'icon-theme-changed', () => this._onIconThemeChanged(), this);

        const iconEffect = new Clutter.DesaturateEffect();
        this._iconBox = new St.Bin({
            style_class: 'app-menu-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._iconBox.add_effect(iconEffect);
        this._container.add_child(this._iconBox);
        this._iconBox.connect('style-changed', () => {
            iconEffect.enabled =
                this._iconBox.get_theme_node().get_icon_style() === St.IconStyle.SYMBOLIC;
        });

        this._label = new St.Label({
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._container.add_child(this._label);

        this._spinner = new Spinner(PANEL_ICON_SIZE, {
            animate: true,
            hideOnStop: true,
        });
        this._container.add_child(this._spinner);

        const menu = new AppMenu(this);
        this.setMenu(menu);
        this._menuManager.addMenu(menu);

        Shell.WindowTracker.get_default().connectObject(
            'notify::focus-app', () => this._focusAppChanged(), this);
        Shell.AppSystem.get_default().connectObject(
            'app-state-changed', (_sys, app) => this._onAppStateChanged(app), this);
        global.window_manager?.connectObject('switch-workspace', () => this._sync(), this);
        Main.overview.connectObject(
            'hiding', () => this._sync(),
            'showing', () => this._sync(), this);

        this._visible = !Main.overview.visible;
        if (!this._visible)
            this.hide();
        this._sync();
    }

    _syncIcon(app) {
        this._iconBox.set_child(app.create_icon_texture(PANEL_ICON_SIZE - APP_MENU_ICON_MARGIN));
    }

    _onIconThemeChanged() {
        if (this._iconBox.child && this._targetApp)
            this._syncIcon(this._targetApp);
    }

    _onAppStateChanged(app) {
        if (app.state === Shell.AppState.STARTING) {
            if (!this._startingApps.includes(app))
                this._startingApps.push(app);
        } else {
            this._startingApps = this._startingApps.filter(item => item !== app);
        }
        this._sync();
    }

    _focusAppChanged() {
        const focusedApp = Shell.WindowTracker.get_default().focus_app;
        if (!focusedApp && global.stage.key_focus !== null)
            return;
        this._sync();
    }

    _findTargetApp() {
        const workspace = global.workspace_manager.get_active_workspace();
        const tracker = Shell.WindowTracker.get_default();
        const focusedApp = tracker.focus_app;
        if (focusedApp && focusedApp.is_on_workspace(workspace))
            return focusedApp;
        for (const app of this._startingApps) {
            if (app.is_on_workspace(workspace))
                return app;
        }
        return null;
    }

    _sync() {
        const targetApp = this._findTargetApp();
        if (this._targetApp !== targetApp) {
            this._targetApp?.disconnectObject(this);
            this._targetApp = targetApp;
            if (targetApp) {
                targetApp.connectObject('notify::busy', () => this._sync(), this);
                this._label.set_text(targetApp.get_name());
                this.set_accessible_name(targetApp.get_name());
                this._syncIcon(targetApp);
            }
        }

        const visible = targetApp !== null && !Main.overview.visibleTarget;
        if (visible)
            this.fadeIn();
        else
            this.fadeOut();

        const busy = targetApp !== null &&
            (targetApp.get_state() === Shell.AppState.STARTING || targetApp.get_busy());
        if (busy)
            this._spinner.play();
        else
            this._spinner.stop();

        this.reactive = visible && !busy;
        this.menu.setApp(targetApp);
        this.emit('changed');
    }

    fadeIn() {
        if (this._visible)
            return;
        this._visible = true;
        this.reactive = true;
        this.remove_all_transitions();
        this.ease({opacity: 255, duration: ANIMATION_TIME, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    fadeOut() {
        if (!this._visible)
            return;
        this._visible = false;
        this.reactive = false;
        this.remove_all_transitions();
        this.ease({opacity: 0, duration: ANIMATION_TIME, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    destroy() {
        this._targetApp?.disconnectObject(this);
        Shell.WindowTracker.get_default().disconnectObject(this);
        Shell.AppSystem.get_default().disconnectObject(this);
        St.TextureCache.get_default().disconnectObject(this);
        global.window_manager?.disconnectObject(this);
        Main.overview.disconnectObject(this);
        super.destroy();
    }
});

const PANEL_ITEM_IMPLEMENTATIONS = {
    activities: ActivitiesButton,
    appMenu: AppMenuButton,
    dateMenu: DateMenuButton,
    quickSettings: QuickSettings,
    a11y: ATIndicator,
    keyboard: InputSourceIndicator,
    dwellClick: DwellClickIndicator,
    screenRecording: ScreenRecordingIndicator,
    screenSharing: ScreenSharingIndicator,
};

export const SecondaryPanel = GObject.registerClass(
class SecondaryPanel extends St.Widget {
    _init(monitorIndex, settings, connector = null) {
        super._init({name: 'panel', reactive: true});
        this.add_style_class_name('multimonitor-panel');
        this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);

        this._monitorIndex = monitorIndex;
        this._settings = settings;
        this._key = monitorKey(
            monitorIndex, Main.layoutManager.primaryIndex, connector);
        this._destroyed = false;
        this._panelColorStyle = null;
        this._externalMirrors = new Map();

        this.statusArea = {};
        this.menuManager = new PopupMenu.PopupMenuManager(this);

        this._leftBox = new St.BoxLayout({name: 'panelLeft'});
        this.add_child(this._leftBox);
        this._centerBox = new St.BoxLayout({name: 'panelCenter'});
        this.add_child(this._centerBox);
        this._rightBox = new St.BoxLayout({name: 'panelRight'});
        this.add_child(this._rightBox);

        this._clickGesture = new Clutter.ClickGesture({recognize_on_press: true});
        this._clickGesture.connect('recognize', this._onWindowDragGestureRecognize.bind(this));
        this.add_action_full('window-drag', Clutter.EventPhase.TARGET, this._clickGesture);

        Main.overview.connectObject(
            'showing', () => this.add_style_pseudo_class('overview'),
            'hiding', () => this.remove_style_pseudo_class('overview'), this);

        Main.sessionMode.connectObject('updated', () => this._updatePanel(), this);
        global.display.connectObject('workareas-changed', () => this.queue_relayout(), this);

        for (const key of ['show-activities', 'show-app-menu', 'show-date-time',
            'show-status-indicators', 'date-time-position', 'monitor-indicator-visibility']) {
            settings.connectObject(`changed::${key}`, () => this._updatePanel(), this);
        }
        for (const key of ['panel-color', 'monitor-panel-layout']) {
            settings.connectObject(`changed::${key}`, () => this._applyColor(), this);
        }

        this._updatePanel();
    }

    get monitorIndex() {
        return this._monitorIndex;
    }

    get settingsKey() {
        return this._key;
    }

    _monitor() {
        return Main.layoutManager.monitors[this._monitorIndex] ?? null;
    }

    vfunc_get_preferred_width(_forHeight) {
        const monitor = this._monitor();
        return [0, monitor?.width ?? 0];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        const allocWidth = box.x2 - box.x1;
        const allocHeight = box.y2 - box.y1;

        const [, leftNaturalWidth] = this._leftBox.get_preferred_width(-1);
        const [, centerNaturalWidth] = this._centerBox.get_preferred_width(-1);
        const [, rightNaturalWidth] = this._rightBox.get_preferred_width(-1);

        const centerWidth = centerNaturalWidth;
        const monitor = this._monitor();
        let centerOffset = 0;
        if (monitor) {
            const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
            centerOffset = 2 * (workArea.x - monitor.x) + workArea.width - monitor.width;
        }

        const sideWidth = Math.max(0, (allocWidth - centerWidth + centerOffset) / 2);
        const childBox = new Clutter.ActorBox();

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.get_text_direction() === Clutter.TextDirection.RTL) {
            childBox.x1 = Math.max(allocWidth - Math.min(Math.floor(sideWidth), leftNaturalWidth), 0);
            childBox.x2 = allocWidth;
        } else {
            childBox.x1 = 0;
            childBox.x2 = Math.min(Math.floor(sideWidth), leftNaturalWidth);
        }
        this._leftBox.allocate(childBox);

        childBox.x1 = Math.ceil(sideWidth);
        childBox.y1 = 0;
        childBox.x2 = childBox.x1 + centerWidth;
        childBox.y2 = allocHeight;
        this._centerBox.allocate(childBox);

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.get_text_direction() === Clutter.TextDirection.RTL) {
            childBox.x1 = 0;
            childBox.x2 = Math.min(Math.floor(sideWidth), rightNaturalWidth);
        } else {
            childBox.x1 = Math.max(allocWidth - Math.min(Math.floor(sideWidth), rightNaturalWidth), 0);
            childBox.x2 = allocWidth;
        }
        this._rightBox.allocate(childBox);
    }

    _onWindowDragGestureRecognize() {
        if (Main.modalCount > 0)
            return;

        const event = this._clickGesture.get_point_event(0);
        const backend = global.stage.get_context().get_backend();
        const sprite = backend.get_sprite(global.stage, event);

        const coords = this._clickGesture.get_coords_abs();
        const dragWindow = this._getDraggableWindowForPosition(coords.x);

        if (!dragWindow)
            return;

        dragWindow.begin_grab_op(
            Meta.GrabOp.MOVING,
            sprite,
            event.get_time(),
            coords);
    }

    vfunc_key_press_event(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
            global.display.focus_default_window(event.get_time());
            return Clutter.EVENT_STOP;
        }

        return super.vfunc_key_press_event(event);
    }

    _toggleMenu(indicator) {
        if (!indicator || !indicator.mapped)
            return; // menu not supported by current session mode

        const menu = indicator.menu;
        if (!indicator.reactive)
            return;

        menu.toggle();
        if (menu.isOpen)
            menu.actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
    }

    _closeMenu(indicator) {
        if (!indicator || !indicator.mapped)
            return; // menu not supported by current session mode

        if (!indicator.reactive)
            return;

        indicator.menu.close();
    }

    toggleCalendar() {
        this._toggleMenu(this.statusArea.dateMenu);
    }

    toggleQuickSettings() {
        this._toggleMenu(this.statusArea.quickSettings);
    }

    closeCalendar() {
        this._closeMenu(this.statusArea.dateMenu);
    }

    closeQuickSettings() {
        this._closeMenu(this.statusArea.quickSettings);
    }

    set boxOpacity(value) {
        const isReactive = value > 0;

        this._leftBox.opacity = value;
        this._leftBox.reactive = isReactive;
        this._centerBox.opacity = value;
        this._centerBox.reactive = isReactive;
        this._rightBox.opacity = value;
        this._rightBox.reactive = isReactive;
    }

    get boxOpacity() {
        return this._leftBox.opacity;
    }

    _roleEnabled(role) {
        return indicatorIsEnabled(this._settings, this._key, role);
    }

    _removeRole(roles, role) {
        const index = roles.indexOf(role);
        if (index !== -1)
            roles.splice(index, 1);
    }

    _desiredRoles() {
        const session = Main.sessionMode.panel;
        let left = [...session.left].filter(role => this._roleEnabled(role));
        let center = [...session.center].filter(role => this._roleEnabled(role));
        let right = [...session.right].filter(role => this._roleEnabled(role));

        // GNOME 45+ session modes dropped appMenu; Ubuntu still exposes it.
        if (this._roleEnabled('appMenu')) {
            const activitiesIndex = left.indexOf('activities');
            if (!left.includes('appMenu'))
                left.splice(activitiesIndex + 1, 0, 'appMenu');
        }

        const position = DATE_POSITIONS.includes(this._settings.get_string('date-time-position'))
            ? this._settings.get_string('date-time-position')
            : 'center';

        this._removeRole(left, 'dateMenu');
        this._removeRole(center, 'dateMenu');
        this._removeRole(right, 'dateMenu');
        if (this._roleEnabled('dateMenu')) {
            if (position === 'left')
                left.push('dateMenu');
            else if (position === 'right-before-tray')
                right.unshift('dateMenu');
            else if (position === 'right-after-tray')
                right.push('dateMenu');
            else
                center.push('dateMenu');
        }

        return {left, center, right};
    }

    _updatePanel() {
        if (this._destroyed)
            return;

        const desired = this._desiredRoles();
        const hidden = new Set();
        for (const role of Object.keys(PANEL_ITEM_IMPLEMENTATIONS)) {
            const indicator = this.statusArea[role];
            if (indicator)
                hidden.add(indicator);
            indicator?.container.hide();
        }

        const all = [
            ...desired.left.map(role => [role, this._leftBox]),
            ...desired.center.map(role => [role, this._centerBox]),
            ...desired.right.map(role => [role, this._rightBox]),
        ];

        for (const [role, box] of all) {
            const indicator = this._ensureIndicator(role);
            if (!indicator)
                continue;
            this._addToPanelBox(role, indicator, box);
            hidden.delete(indicator);
        }

        this._applyColor();
        this._syncExternalIndicators();
        this.queue_relayout();
    }

    _hideIndicators() {
        for (const role in PANEL_ITEM_IMPLEMENTATIONS) {
            const indicator = this.statusArea[role];
            if (indicator)
                indicator.container.hide();
        }
    }

    _ensureIndicator(role) {
        let indicator = this.statusArea[role];
        if (indicator)
            return indicator;

        const Constructor = PANEL_ITEM_IMPLEMENTATIONS[role];
        if (!Constructor)
            return null;

        indicator = Constructor === AppMenuButton ? new AppMenuButton(this) : new Constructor();
        this.statusArea[role] = indicator;
        return indicator;
    }

    _addToPanelBox(role, indicator, box) {
        const container = indicator.container;
        container.show();

        const parent = container.get_parent();
        if (parent)
            parent.remove_child(container);
        box.add_child(container);

        this.statusArea[role] = indicator;

        if (!indicator._secondaryDestroyId) {
            indicator._secondaryDestroyId = indicator.connect('destroy', emitter => {
                delete this.statusArea[role];
                emitter._secondaryDestroyId = 0;
            });
        }
        if (!indicator._secondaryMenuId) {
            indicator._secondaryMenuId = indicator.connect('menu-set',
                () => this._onMenuSet(indicator));
        }
        this._onMenuSet(indicator);
    }

    addToStatusArea(role, indicator, position, box) {
        if (this.statusArea[role]) {
            const previous = this.statusArea[role];
            if (previous !== indicator)
                previous.destroy();
            delete this.statusArea[role];
        }

        if (!(indicator instanceof PanelMenu.Button))
            throw new TypeError('Status indicator must be an instance of PanelMenu.Button');

        const boxes = {
            left: this._leftBox,
            center: this._centerBox,
            right: this._rightBox,
        };
        const target = boxes[box] ?? this._rightBox;
        const container = indicator.container;
        container.show();

        const parent = container.get_parent();
        if (parent)
            parent.remove_child(container);
        target.insert_child_at_index(container, Math.max(0, position ?? 0));

        this.statusArea[role] = indicator;
        indicator.connect('destroy', emitter => {
            if (this.statusArea[role] === emitter)
                delete this.statusArea[role];
        });
        indicator.connect('menu-set', () => this._onMenuSet(indicator));
        this._onMenuSet(indicator);
        return indicator;
    }

    _onMenuSet(indicator) {
        const menu = indicator.menu;
        if (!menu || menu._openChangedConnected)
            return;
        this.menuManager.addMenu(menu);
        menu._openChangedConnected = true;
    }

    _syncExternalIndicators() {
        if (this._destroyed || !Main.panel?.statusArea)
            return;

        const roleByContainer = new Map();
        for (const [role, indicator] of Object.entries(Main.panel.statusArea)) {
            if (indicator?.container)
                roleByContainer.set(indicator.container, role);
        }

        const primaryChildren = Main.panel._rightBox?.get_children() ?? [];
        const wanted = new Set();
        const externalRoles = [];
        for (const container of primaryChildren) {
            const role = roleByContainer.get(container);
            if (!role || EXCLUDED_MIRROR_ROLES.includes(role))
                continue;
            if (!this._roleEnabled(role))
                continue;
            wanted.add(role);
            externalRoles.push(role);
        }

        for (const [role, mirror] of [...this._externalMirrors]) {
            if (!wanted.has(role)) {
                mirror.destroy();
                this._externalMirrors.delete(role);
            }
        }

        for (const role of externalRoles) {
            if (this._externalMirrors.has(role))
                continue;
            const source = Main.panel.statusArea[role];
            const mirror = new StatusIndicatorMirror(this, role, source);
            mirror.connect('destroy', () => this._externalMirrors.delete(role));
            this._externalMirrors.set(role, mirror);
            this.addToStatusArea(role, mirror, 0, this._rightBox);
        }

        this._syncExternalOrder(primaryChildren, roleByContainer, wanted);
    }

    _syncExternalOrder(primaryChildren, roleByContainer, externalRoles) {
        let anchor = null;
        for (const container of primaryChildren) {
            const role = roleByContainer.get(container);
            if (!role)
                continue;

            if (externalRoles.has(role)) {
                const mirror = this._externalMirrors.get(role)?.container;
                if (!mirror || !this._rightBox.contains(mirror))
                    continue;
                const children = this._rightBox.get_children();
                const currentIndex = children.indexOf(mirror);
                const anchorIndex = anchor ? children.indexOf(anchor) : -1;
                const desiredIndex = anchorIndex === -1 ? 0 : anchorIndex + 1;
                if (currentIndex !== desiredIndex) {
                    this._rightBox.remove_child(mirror);
                    const updatedAnchorIndex = anchor
                        ? this._rightBox.get_children().indexOf(anchor)
                        : -1;
                    this._rightBox.insert_child_at_index(
                        mirror,
                        updatedAnchorIndex === -1 ? 0 : updatedAnchorIndex + 1);
                }
                anchor = mirror;
                continue;
            }

            const builtin = this.statusArea[role]?.container;
            if (builtin && this._rightBox.contains(builtin))
                anchor = builtin;
        }
    }

    _applyColor() {
        const color = panelColor(this._settings, this._key);
        const next = panelColorDeclaration(color);
        this.style = mergePanelColorStyle(this.style, this._panelColorStyle, next);
        this._panelColorStyle = next;
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;

        this._settings.disconnectObject(this);
        Main.overview.disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
        global.display.disconnectObject(this);

        for (const mirror of this._externalMirrors.values())
            mirror.destroy();
        this._externalMirrors.clear();

        super.destroy();
    }

    _getDraggableWindowForPosition(stageX) {
        const workspaceManager = global.workspace_manager;
        const windows = workspaceManager.get_active_workspace().list_windows();
        const allWindowsByStacking =
            global.display.sort_windows_by_stacking(windows).reverse();

        return allWindowsByStacking.find(metaWindow => {
            const rect = metaWindow.get_frame_rect();
            return metaWindow.get_monitor() === this._monitorIndex &&
                   metaWindow.showing_on_its_workspace() &&
                   metaWindow.get_window_type() !== Meta.WindowType.DESKTOP &&
                   metaWindow.maximized_vertically &&
                   stageX > rect.x && stageX < rect.x + rect.width;
        });
    }
});
