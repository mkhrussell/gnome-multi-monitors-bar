import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import * as WorkspacesView from 'resource:///org/gnome/shell/ui/workspacesView.js';

// GJS internals needed to replace a vfunc on an already-registered GObject
// class. Assigning to `prototype.vfunc_allocate` is NOT enough: the method is
// copied into the GLib class struct at registration time, so plain monkey
// patching leaves the old vfunc in charge.
function findSymbol(object, description) {
    return Object.getOwnPropertySymbols(object ?? {})
        .find(symbol => symbol.description === description);
}

const gi = globalThis.imports?._gi;
const HOOK_UP_VFUNC = gi?.hook_up_vfunc_symbol ??
    findSymbol(GObject.Object.prototype, '__GObject__hook_up_vfunc');

let hookedPrototype = null;
let originalAllocate = null;
let loggedFirstAllocation = false;

function patchedAllocate(box) {
    if (!loggedFirstAllocation) {
        loggedFirstAllocation = true;
        console.log('[MMBv2 overview] patched allocation active on secondary monitor');
    }
    this.set_allocation(box);

    const themeNode = this.get_theme_node();
    const contentBox = themeNode.get_content_box(box);
    const [width, height] = contentBox.get_size();
    const {expandFraction} = this._thumbnails;
    const spacing = themeNode.get_length('spacing') * expandFraction;

    // Upstream uses `padding = round((1 - 0.80) * height / 2)` here to scale
    // secondary-monitor previews down to 80%. Zero it so the workspace views
    // are laid out at the same size as on the primary monitor.
    const padding = 0;
    const thumbnailsHeight = this._getThumbnailsHeight(contentBox);

    if (this._thumbnails.visible) {
        const childBox = new Clutter.ActorBox();
        childBox.set_origin(0, padding);
        childBox.set_size(width, thumbnailsHeight);
        this._thumbnails.allocate(childBox);
    }

    const {currentState, initialState, finalState, transitioning, progress} =
        this._overviewAdjustment.getStateTransitionParams();
    let workspacesBox;
    const workspaceParams = [contentBox, padding, thumbnailsHeight, spacing];
    if (!transitioning) {
        workspacesBox = this._getWorkspacesBoxForState(currentState, ...workspaceParams);
    } else {
        const initialBox = this._getWorkspacesBoxForState(initialState, ...workspaceParams);
        const finalBox = this._getWorkspacesBoxForState(finalState, ...workspaceParams);
        workspacesBox = initialBox.interpolate(finalBox, progress);
    }
    this._workspacesView.allocate(workspacesBox);
}

export function applyOverviewPatch() {
    if (originalAllocate)
        return;

    const proto = WorkspacesView.SecondaryMonitorDisplay?.prototype;
    if (!proto) {
        console.warn('[MMBv2 overview] SecondaryMonitorDisplay not found; patch skipped');
        return;
    }

    const gobjectPrototype = gi?.gobject_prototype_symbol ??
        findSymbol(proto, '__GObject__prototype');
    if (!HOOK_UP_VFUNC || typeof proto[gobjectPrototype]?.[HOOK_UP_VFUNC] !== 'function') {
        console.warn('[MMBv2 overview] GJS vfunc hook unavailable; patch skipped');
        return;
    }

    const giPrototype = proto[gobjectPrototype];
    const original = proto.vfunc_allocate;
    if (typeof original !== 'function') {
        console.warn('[MMBv2 overview] vfunc_allocate not found; patch skipped');
        return;
    }

    giPrototype[HOOK_UP_VFUNC]('allocate', patchedAllocate);
    hookedPrototype = giPrototype;
    originalAllocate = original;
    console.log('[MMBv2 overview] secondary-monitor workspace scaling disabled');
}

export function revertOverviewPatch() {
    if (!originalAllocate)
        return;
    if (hookedPrototype && HOOK_UP_VFUNC)
        hookedPrototype[HOOK_UP_VFUNC]('allocate', originalAllocate);
    hookedPrototype = null;
    originalAllocate = null;
    loggedFirstAllocation = false;
    console.log('[MMBv2 overview] patch reverted');
}
