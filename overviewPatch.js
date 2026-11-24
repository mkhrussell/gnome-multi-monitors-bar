import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import * as WorkspacesView from 'resource:///org/gnome/shell/ui/workspacesView.js';

import * as OverviewSearch from './overviewSearch.js';

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

// Leave only enough vertical headroom for a thin slice of the neighbouring
// workspace to peek in, without noticeably shrinking the previews again.
const MIN_WORKSPACE_EDGE = 8;

function heightRatioForEdge(width) {
    if (!(width > 0))
        return 1;
    const desiredEdge = Math.max(MIN_WORKSPACE_EDGE, Math.round(width * 0.01));
    const ratio = 1 - 2 * (desiredEdge + MIN_WORKSPACE_EDGE) / width;
    return Math.max(0.85, ratio);
}

let hookedPrototype = null;
let originalAllocate = null;
let originalUpdateWorkspacesViews = null;
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

    // Allocate the independent secondary search entry + controller and reserve
    // its height at the top of this monitor.
    const topInset = OverviewSearch.allocateSearchUI(
        this._monitorIndex, contentBox, width, height);

    const thumbnailsBox = contentBox.copy();
    thumbnailsBox.set_size(width, Math.max(0, height - topInset));
    const thumbnailsHeight = this._getThumbnailsHeight(thumbnailsBox);

    if (this._thumbnails.visible) {
        const childBox = new Clutter.ActorBox();
        childBox.set_origin(0, padding + topInset);
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
    const availableHeight = Math.max(1, workspacesBox.get_height() - topInset);
    const finalHeight = Math.max(1,
        Math.round(availableHeight * heightRatioForEdge(width)));
    workspacesBox.set_origin(workspacesBox.x1,
        workspacesBox.y1 + topInset + Math.round((availableHeight - finalHeight) / 2));
    workspacesBox.set_size(workspacesBox.get_width(), finalHeight);
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

    // Displays are recreated whenever the overview opens. Detach our actors
    // first so they are not destroyed with the old displays.
    const displayProto = WorkspacesView.WorkspacesDisplay?.prototype;
    if (displayProto?._updateWorkspacesViews) {
        originalUpdateWorkspacesViews = displayProto._updateWorkspacesViews;
        displayProto._updateWorkspacesViews = function (...args) {
            OverviewSearch.detachAll();
            originalUpdateWorkspacesViews.apply(this, args);
            for (const view of this._workspacesViews ?? []) {
                if (view._thumbnails && view._monitorIndex !== undefined)
                    OverviewSearch.attachToDisplay(view, view._monitorIndex);
            }
        };
    }

    console.log('[MMBv2 overview] secondary-monitor workspace scaling disabled');
}

export function revertOverviewPatch() {
    if (!originalAllocate)
        return;
    if (hookedPrototype && HOOK_UP_VFUNC)
        hookedPrototype[HOOK_UP_VFUNC]('allocate', originalAllocate);

    const displayProto = WorkspacesView.WorkspacesDisplay?.prototype;
    if (displayProto && originalUpdateWorkspacesViews)
        displayProto._updateWorkspacesViews = originalUpdateWorkspacesViews;

    hookedPrototype = null;
    originalAllocate = null;
    originalUpdateWorkspacesViews = null;
    loggedFirstAllocation = false;
    console.log('[MMBv2 overview] patch reverted');
}
