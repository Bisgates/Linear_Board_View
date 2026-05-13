import { SelectionMode } from "@xyflow/react";

/**
 * ReactFlow props shared by every Board / view in this app. Behaviors that
 * should stay consistent across views (selection, pan, zoom, fit-view) live
 * here; per-view overrides (node/edge types, connect rules, double-click
 * handlers) stay in the individual board component.
 *
 * Selection model:
 *  - drag empty pane = box-select with partial-overlap touch-to-select
 *  - two-finger trackpad scroll pans (panOnScroll)
 *  - middle-mouse drag also pans (panOnDrag=[1]) as a mouse fallback
 *  - pinch zooms; wheel does not (would conflict with scroll-to-pan)
 *  - no double-click zoom (we use double-click for our own create gestures)
 */
export const SHARED_FLOW_PROPS = {
  panOnScroll: true,
  zoomOnScroll: false,
  zoomOnPinch: true,
  zoomOnDoubleClick: false,
  selectionOnDrag: true,
  selectionMode: SelectionMode.Partial,
  panOnDrag: [1] as number[],
  preventScrolling: true,
  minZoom: 0.2,
  maxZoom: 2.5,
  fitView: true,
  fitViewOptions: { padding: 0.2 },
  proOptions: { hideAttribution: true },
} as const;
