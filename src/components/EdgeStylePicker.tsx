import { useEffect, useRef, useState } from "react";
import { DEFAULT_EDGE_STYLE, EDGE_STYLE_PRESETS, type EdgeStylePreset } from "../lib/edgeStyles";

interface EdgeStylePickerProps {
  value: string;
  onChange: (id: string) => void;
}

/**
 * A dropdown picker that shows edge style presets with visual previews.
 * Clicking on a style immediately applies it to all edges on the board.
 */
export function EdgeStylePicker({ value, onChange }: EdgeStylePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentPreset = EDGE_STYLE_PRESETS.find((p) => p.id === value) ?? DEFAULT_EDGE_STYLE;

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        title="Edge Style"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 10px",
          background: open ? "var(--panel-soft)" : "transparent",
          border: "1px solid var(--hairline)",
          borderRadius: 4,
          cursor: "pointer",
          color: "var(--ink-soft)",
          fontFamily: "var(--sans)",
          fontSize: 11,
          fontWeight: 500,
          transition: "background 0.15s, border-color 0.15s",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = "var(--panel-soft)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "transparent";
        }}
      >
        <EdgePreviewLine preset={currentPreset} width={32} />
        <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: 180,
            background: "var(--panel)",
            border: "1px solid var(--hairline)",
            borderRadius: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)",
            zIndex: 1000,
            padding: "6px 0",
          }}
        >
          <div
            style={{
              padding: "4px 12px 8px",
              fontSize: 10,
              fontWeight: 600,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Edge Style
          </div>
          {EDGE_STYLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => {
                onChange(preset.id);
                setOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                padding: "8px 12px",
                background: preset.id === value ? "var(--accent-soft)" : "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                color: "var(--ink)",
                fontFamily: "var(--sans)",
                fontSize: 12,
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => {
                if (preset.id !== value) {
                  e.currentTarget.style.background = "var(--panel-soft)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  preset.id === value ? "var(--accent-soft)" : "transparent";
              }}
            >
              <EdgePreviewLine preset={preset} width={48} />
              <span style={{ flex: 1 }}>{preset.name}</span>
              {preset.id === value && (
                <span style={{ fontSize: 10, color: "var(--accent)" }}>✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A small SVG preview of an edge style, showing the line and arrowhead.
 */
function EdgePreviewLine({ preset, width }: { preset: EdgeStylePreset; width: number }) {
  const height = 20;
  const arrowSize = Math.min(8, preset.markerSize * 0.5);
  const lineY = height / 2;
  const startX = 4;
  const endX = width - 4 - arrowSize;

  // Generate a unique marker id for this preview
  const markerId = `preview-marker-${preset.id}`;

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        <marker
          id={markerId}
          markerWidth={arrowSize}
          markerHeight={arrowSize}
          refX={arrowSize * 0.9}
          refY={arrowSize / 2}
          orient="auto"
        >
          {preset.markerType === "arrow" ? (
            <polyline
              points={`0,0 ${arrowSize},${arrowSize / 2} 0,${arrowSize}`}
              fill="none"
              stroke={preset.markerColor ?? preset.strokeColor}
              strokeWidth={preset.strokeWidth * 0.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <polygon
              points={`0,0 ${arrowSize},${arrowSize / 2} 0,${arrowSize}`}
              fill={preset.markerColor ?? preset.strokeColor}
            />
          )}
        </marker>
      </defs>
      <line
        x1={startX}
        y1={lineY}
        x2={endX}
        y2={lineY}
        stroke={preset.strokeColor}
        strokeWidth={preset.strokeWidth}
        strokeDasharray={preset.strokeDasharray}
        strokeLinecap={preset.lineCap ?? "butt"}
        markerEnd={`url(#${markerId})`}
      />
    </svg>
  );
}
