/* Independent overview search for secondary monitors.
 *
 * Each secondary monitor owns a real GNOME SearchController with its own
 * St.Entry and SearchResultsView. Nothing is mirrored into, or reparented
 * from, the primary monitor's search UI.
 */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {SIDE_CONTROLS_ANIMATION_TIME} from 'resource:///org/gnome/shell/ui/overviewControls.js';
import * as SearchController from 'resource:///org/gnome/shell/ui/searchController.js';

const VERTICAL_SPACING_RATIO = 0.02;

const controllers = new Map(); // monitorIndex -> box
const blockedHandlers = new Set();
let activeMonitor = null;
let requestedMonitor = null;
let applied = false;
let focusId = 0;
let showingId = 0;
let shownId = 0;
let hidingId = 0;
let monitorsChangedId = 0;
let pendingFocusId = 0;

function primaryIndex() {
    return Main.layoutManager?.primaryIndex ?? 0;
}

function monitorAtPointer() {
    try {
        const [x, y] = global.get_pointer();
        const monitors = Main.layoutManager?.monitors ?? [];
        for (let i = 0; i < monitors.length; i++) {
            const monitor = monitors[i];
            if (x >= monitor.x && x < monitor.x + monitor.width &&
                y >= monitor.y && y < monitor.y + monitor.height) {
                return i;
            }
        }
    } catch (e) {
        console.warn(`[MMBv2 search] pointer monitor lookup failed: ${e.message}`);
    }
    return primaryIndex();
}

function monitorForActor(actor) {
    const primaryEntry = Main.overview?.searchEntry;
    for (let node = actor; node; node = node.get_parent?.()) {
        if (primaryEntry && (node === primaryEntry ||
            node === primaryEntry.clutter_text)) {
            return primaryIndex();
        }
        for (const box of controllers.values()) {
            if (node === box.entry || node === box.text ||
                node === box.bin || node === box.controller ||
                node === box.controller._searchResults) {
                return box.monitorIndex;
            }
        }
    }
    return null;
}

function targetMonitor() {
    const focusMonitor = monitorForActor(global.stage?.get_key_focus?.());
    if (focusMonitor !== null)
        return focusMonitor;
    if (activeMonitor !== null)
        return activeMonitor;
    if (requestedMonitor !== null)
        return requestedMonitor;
    return monitorAtPointer();
}

/** Set a one-shot focus hint from a secondary Activities button. */
export function requestOverviewSearchMonitor(monitorIndex) {
    requestedMonitor = monitorIndex === primaryIndex() ? null : monitorIndex;
}

function setHandlerBlocked(id, block) {
    if (!id)
        return;
    if (block && !blockedHandlers.has(id)) {
        GObject.signal_handler_block(global.stage, id);
        blockedHandlers.add(id);
    } else if (!block && blockedHandlers.has(id)) {
        GObject.signal_handler_unblock(global.stage, id);
        blockedHandlers.delete(id);
    }
}

/**
 * Only the search controller belonging to the monitor with key focus should
 * react to global key presses. This blocks the other controllers' stage
 * handlers without modifying any of their code.
 */
export function syncStageHandlers() {
    const focusMonitor = monitorForActor(global.stage?.get_key_focus?.());
    if (focusMonitor !== null)
        activeMonitor = focusMonitor === primaryIndex() ? null : focusMonitor;

    // Keep the last secondary search monitor active if a transient reset
    // temporarily clears key focus (e.g. deleting the last search term).
    const effectiveMonitor = focusMonitor ?? activeMonitor;
    const activeId = effectiveMonitor === null || effectiveMonitor === primaryIndex()
        ? Main.overview?.searchController?._stageKeyPressId
        : controllers.get(effectiveMonitor)?.controller?._stageKeyPressId;

    const liveIds = new Set();
    const primary = Main.overview?.searchController;
    if (primary?._stageKeyPressId)
        liveIds.add(primary._stageKeyPressId);
    for (const box of controllers.values()) {
        if (box.controller?._stageKeyPressId)
            liveIds.add(box.controller._stageKeyPressId);
    }

    // Drop stale ids from controllers that already disconnected on hiding.
    for (const id of [...blockedHandlers]) {
        if (!liveIds.has(id))
            blockedHandlers.delete(id);
    }

    for (const id of liveIds)
        setHandlerBlocked(id, id !== activeId);
}

function updateSearchVisibility(box) {
    const active = box.controller.searchActive;
    const display = box.display;
    const targets = [box.controller];
    if (display?._workspacesView)
        targets.push(display._workspacesView);
    if (display?._thumbnails)
        targets.push(display._thumbnails);

    if (active)
        box.controller.show();

    for (const target of targets) {
        target.remove_all_transitions();
        const opacity = active ? 0 : 255;
        target.ease({
            opacity: target === box.controller ? (active ? 255 : 0) : opacity,
            duration: SIDE_CONTROLS_ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (target === box.controller && !active)
                    target.hide();
            },
        });
    }
}

function createController(monitorIndex) {
    const entry = new St.Entry({
        style_class: 'search-entry',
        hint_text: _('Type to search'),
        can_focus: true,
        track_hover: true,
    });
    entry.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);

    const bin = new St.Bin({
        style_class: 'multimonitor-overview-search',
        x_align: Clutter.ActorAlign.CENTER,
        child: entry,
    });

    // The controller expects a show-apps toggle; secondary panels do not have
    // one, so give it an inert one.
    const showAppsButton = new St.Button({
        toggle_mode: true,
        visible: false,
        can_focus: false,
    });

    const controller = new SearchController.SearchController(entry, showAppsButton);
    controller.visible = false;

    const box = {
        monitorIndex,
        entry,
        text: entry.clutter_text,
        bin,
        showAppsButton,
        controller,
        display: null,
        destroyId: 0,
        searchActiveId: 0,
        focusInId: 0,
    };
    box.searchActiveId = controller.connect('notify::search-active',
        () => updateSearchVisibility(box));
    box.focusInId = entry.connect('key-focus-in', () => {
        activeMonitor = monitorIndex;
        syncStageHandlers();
    });

    // GNOME resets search when the text becomes empty. Keep focus on our entry
    // so the next keystroke does not fall through to the primary search box.
    const originalReset = controller.reset.bind(controller);
    controller.reset = () => {
        const keepFocus = monitorForActor(global.stage.get_key_focus()) === monitorIndex;
        originalReset();
        if (keepFocus && applied) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                box.entry.grab_key_focus();
                return GLib.SOURCE_REMOVE;
            });
        }
    };

    // Avoid re-injecting a key into an entry that already owns focus.
    const originalStartSearch = controller.startSearch.bind(controller);
    controller.startSearch = event => {
        if (monitorForActor(global.stage.get_key_focus()) === monitorIndex)
            return;
        originalStartSearch(event);
    };

    controllers.set(monitorIndex, box);
    console.log(`[MMBv2 search] independent controller created for monitor ${monitorIndex}`);
    return box;
}

function ensureController(monitorIndex) {
    return controllers.get(monitorIndex) ?? createController(monitorIndex);
}

function destroyController(monitorIndex) {
    const box = controllers.get(monitorIndex);
    if (!box)
        return;
    detachBox(monitorIndex);
    if (box.searchActiveId)
        box.controller.disconnect(box.searchActiveId);
    if (box.focusInId)
        box.entry.disconnect(box.focusInId);
    box.controller.destroy();
    controllers.delete(monitorIndex);
}

function detachBox(monitorIndex) {
    const box = controllers.get(monitorIndex);
    if (!box?.display)
        return;

    const display = box.display;
    if (box.bin.get_parent() === display)
        display.remove_child(box.bin);
    if (box.controller.get_parent() === display)
        display.remove_child(box.controller);
    if (box.destroyId) {
        display.disconnect(box.destroyId);
        box.destroyId = 0;
    }
    box.display = null;

    if (display._workspacesView)
        display._workspacesView.opacity = 255;
    if (display._thumbnails)
        display._thumbnails.opacity = 255;
    box.controller.hide();
}

/** Remove our actors before GNOME destroys the old overview displays. */
export function detachAll() {
    for (const monitorIndex of [...controllers.keys()])
        detachBox(monitorIndex);
}

export function attachToDisplay(display, monitorIndex) {
    detachBox(monitorIndex);
    const box = ensureController(monitorIndex);

    display.add_child(box.bin);
    display.add_child(box.controller);
    box.display = display;
    box.destroyId = display.connect('destroy', () => detachBox(monitorIndex));

    display.queue_relayout();
    syncStageHandlers();
    console.log(`[MMBv2 search] attached independent search to monitor ${monitorIndex}`);
}

/**
 * Allocate the secondary entry and its controller. Returns the height taken
 * at the top so the workspace/thumbnail code can shift everything down.
 */
export function allocateSearchUI(monitorIndex, box, width, height) {
    const localBox = controllers.get(monitorIndex);
    if (!localBox?.display)
        return 0;

    const primaryEntry = Main.overview?.searchEntry;
    const measureEntry = primaryEntry ?? localBox.entry;
    const [searchHeight] = measureEntry.get_preferred_height(width);
    const spacing = Math.round(height * VERTICAL_SPACING_RATIO);

    const entryBox = new Clutter.ActorBox();
    entryBox.set_origin(0, 0);
    entryBox.set_size(width, searchHeight);
    localBox.bin.allocate(entryBox);

    const resultsBox = new Clutter.ActorBox();
    resultsBox.set_origin(0, searchHeight + spacing);
    resultsBox.set_size(width, Math.max(0, height - searchHeight - spacing));
    localBox.controller.allocate(resultsBox);

    return searchHeight;
}

export function focusSearchOn(monitorIndex) {
    const box = controllers.get(monitorIndex);
    if (!box?.display)
        return false;
    box.entry.grab_key_focus();
    syncStageHandlers();
    return true;
}

function onOverviewShowing() {
    for (const box of controllers.values())
        box.controller.prepareToEnterOverview();
    syncStageHandlers();
}

function onOverviewShown() {
    const index = targetMonitor();
    requestedMonitor = null;
    if (index !== primaryIndex() && controllers.has(index)) {
        if (pendingFocusId)
            GLib.source_remove(pendingFocusId);
        pendingFocusId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            pendingFocusId = 0;
            focusSearchOn(index);
            return GLib.SOURCE_REMOVE;
        });
    }
    syncStageHandlers();
}

function onOverviewHiding() {
    requestedMonitor = null;
    activeMonitor = null;
    if (pendingFocusId) {
        GLib.source_remove(pendingFocusId);
        pendingFocusId = 0;
    }
    for (const box of controllers.values())
        box.controller.prepareToLeaveOverview();
    detachAll();
    syncStageHandlers();
}

function onMonitorsChanged() {
    const monitors = Main.layoutManager?.monitors ?? [];
    for (const monitorIndex of [...controllers.keys()]) {
        if (monitorIndex >= monitors.length || monitorIndex === primaryIndex())
            destroyController(monitorIndex);
    }
    for (let i = 0; i < monitors.length; i++) {
        if (i !== primaryIndex())
            ensureController(i);
    }
    syncStageHandlers();
}

export function applyOverviewSearch() {
    if (applied)
        return;
    applied = true;

    focusId = global.stage.connect('notify::key-focus', syncStageHandlers);
    if (Main.overview) {
        showingId = Main.overview.connect('showing', onOverviewShowing);
        shownId = Main.overview.connect('shown', onOverviewShown);
        hidingId = Main.overview.connect('hiding', onOverviewHiding);
    }
    monitorsChangedId = Main.layoutManager.connect('monitors-changed', onMonitorsChanged);
    onMonitorsChanged();
    console.log('[MMBv2 search] independent search patch applied');
}

export function revertOverviewSearch() {
    if (!applied)
        return;
    applied = false;

    if (pendingFocusId) {
        GLib.source_remove(pendingFocusId);
        pendingFocusId = 0;
    }
    if (focusId)
        global.stage.disconnect(focusId);
    if (showingId)
        Main.overview.disconnect(showingId);
    if (shownId)
        Main.overview.disconnect(shownId);
    if (hidingId)
        Main.overview.disconnect(hidingId);
    if (monitorsChangedId)
        Main.layoutManager.disconnect(monitorsChangedId);
    focusId = showingId = shownId = hidingId = monitorsChangedId = 0;

    for (const id of [...blockedHandlers]) {
        GObject.signal_handler_unblock(global.stage, id);
        blockedHandlers.delete(id);
    }
    for (const monitorIndex of [...controllers.keys()])
        destroyController(monitorIndex);
    requestedMonitor = null;
    activeMonitor = null;
    console.log('[MMBv2 search] independent search patch reverted');
}
