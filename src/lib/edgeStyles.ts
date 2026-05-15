import { MarkerType } from "@xyflow/react";

/**
 * Edge style preset definition. Each preset controls stroke color, width,
 * dash pattern, and marker (arrowhead) appearance.
 */
export interface EdgeStylePreset {
  id: string;
  name: string;
  /** CSS color for the edge stroke */
  strokeColor: string;
  /** Stroke width in pixels */
  strokeWidth: number;
  /** Optional dash array (e.g. "5,3" for dashed lines) */
  strokeDasharray?: string;
  /** Marker type at the end of the edge */
  markerType: MarkerType;
  /** Marker color (defaults to strokeColor if not specified) */
  markerColor?: string;
  /** Marker size (width & height) */
  markerSize: number;
  /** Optional: use a custom marker id instead of the built-in xyflow markers */
  customMarkerId?: string;
  /** Border radius for the smooth step path corners */
  borderRadius: number;
  /** Line cap style */
  lineCap?: "butt" | "round" | "square";
}

/**
 * Built-in edge style presets. Users can click to preview and select.
 */
export const EDGE_STYLE_PRESETS: EdgeStylePreset[] = [
  {
    id: "classic",
    name: "Classic",
    strokeColor: "var(--edge)",
    strokeWidth: 1.6,
    markerType: MarkerType.ArrowClosed,
    markerSize: 16,
    borderRadius: 10,
  },
  {
    id: "minimal",
    name: "Minimal",
    strokeColor: "#a8a090",
    strokeWidth: 1,
    markerType: MarkerType.Arrow,
    markerSize: 12,
    borderRadius: 6,
    lineCap: "round",
  },
  {
    id: "bold",
    name: "Bold",
    strokeColor: "#5c5548",
    strokeWidth: 2.5,
    markerType: MarkerType.ArrowClosed,
    markerSize: 20,
    borderRadius: 12,
    lineCap: "round",
  },
  {
    id: "elegant",
    name: "Elegant",
    strokeColor: "#7a8b66",
    strokeWidth: 1.4,
    markerType: MarkerType.ArrowClosed,
    markerSize: 14,
    borderRadius: 8,
    lineCap: "round",
  },
  {
    id: "warm",
    name: "Warm",
    strokeColor: "#b07a3e",
    strokeWidth: 1.8,
    markerType: MarkerType.ArrowClosed,
    markerSize: 16,
    borderRadius: 10,
  },
  {
    id: "cool",
    name: "Cool",
    strokeColor: "#4671a0",
    strokeWidth: 1.8,
    markerType: MarkerType.ArrowClosed,
    markerSize: 16,
    borderRadius: 10,
  },
  {
    id: "dashed",
    name: "Dashed",
    strokeColor: "#8a8170",
    strokeWidth: 1.6,
    strokeDasharray: "6,4",
    markerType: MarkerType.ArrowClosed,
    markerSize: 16,
    borderRadius: 10,
  },
  {
    id: "dotted",
    name: "Dotted",
    strokeColor: "#968d7d",
    strokeWidth: 2,
    strokeDasharray: "2,4",
    markerType: MarkerType.ArrowClosed,
    markerSize: 14,
    borderRadius: 8,
    lineCap: "round",
  },
];

const STORAGE_KEY = "linear_board_view:edge_style:v1";

/**
 * Load the saved edge style id from localStorage
 */
export function loadEdgeStyleId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && EDGE_STYLE_PRESETS.some((p) => p.id === stored)) {
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  return "classic";
}

/**
 * Save the selected edge style id to localStorage
 */
export function saveEdgeStyleId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore storage errors
  }
}

/**
 * The default "classic" preset (first in the list). Exported separately so
 * callers have a guaranteed non-undefined fallback.
 */
export const DEFAULT_EDGE_STYLE: EdgeStylePreset = EDGE_STYLE_PRESETS[0]!;

/**
 * Get the preset by id, falling back to classic if not found
 */
export function getEdgeStylePreset(id: string): EdgeStylePreset {
  return EDGE_STYLE_PRESETS.find((p) => p.id === id) ?? DEFAULT_EDGE_STYLE;
}
