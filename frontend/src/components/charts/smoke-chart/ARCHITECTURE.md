# Smoke Chart Architecture

> **⚠️ READ THIS FIRST:** This document describes the architecture and interdependencies of the smoke chart. Understanding these relationships is crucial before making any changes to avoid breaking other parts of the chart.

## Overview

The Smoke Chart is a D3.js-based visualization that displays network latency data over time. It consists of multiple rendering layers that are composed together in a specific order, sharing common scales and data structures.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ChartControls                                   │
│  (React component for toggling visibility of chart elements)                │
└─────────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────────┐
│                             D3SmokeChart                                     │
│  (Main orchestrator - manages state, dimensions, and layer composition)     │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ SVG Canvas                                                              │ │
│  │  ┌─────────────┬────────────────────────────────────────┬────────────┐ │ │
│  │  │   Y-Axis    │           Chart Area                   │   Stats    │ │ │
│  │  │             │  ┌──────────────────────────────────┐  │   Panel    │ │ │
│  │  │             │  │ Layers (bottom to top):          │  │            │ │ │
│  │  │             │  │  1. Packet Loss (background)     │  │            │ │ │
│  │  │             │  │  2. Smoke Bars (variance)        │  │            │ │ │
│  │  │             │  │  3. Stat Lines (min/max/avg)     │  │            │ │ │
│  │  │             │  │  4. Median Line + Points         │  │            │ │ │
│  │  │             │  │  5. Grid Lines                   │  │            │ │ │
│  │  │             │  │  6. Tooltip Overlay (invisible)  │  │            │ │ │
│  │  │             │  └──────────────────────────────────┘  │            │ │ │
│  │  └─────────────┴────────────────────────────────────────┴────────────┘ │ │
│  │                           X-Axis (Time)                                 │ │
│  │                             Legend                                      │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## File Structure

```
smoke-chart/
├── D3SmokeChart.tsx    # Main component - orchestrates all layers
├── ChartControls.tsx   # UI controls for toggling chart features
├── types.ts            # TypeScript interfaces shared across all files
├── utils.ts            # Data transformation and helper functions
├── ARCHITECTURE.md     # This file
└── layers/
    ├── renderSmokeBars.ts     # Variance "smoke" rectangles
    ├── renderPacketLoss.ts    # Background coloring for packet loss
    ├── renderStatLines.ts     # Min/Max/Avg/Median line rendering
    ├── renderGridAndAxes.ts   # Grid lines and axis rendering
    ├── renderStatsPanel.ts    # Right-side statistics panel
    ├── renderLegend.ts        # Bottom legend
    └── renderTooltip.ts       # Interactive tooltip on hover
```

## Data Flow

```
┌──────────────────┐
│ BucketDataPoint[]│  (Raw API data from backend)
│ from props       │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ prepareChartData │  (utils.ts - converts to ChartDataPoint[])
│                  │  - Converts Unix timestamps to milliseconds
│                  │  - Calculates packet loss percentage
│                  │  - Sorts by timestamp
└────────┬─────────┘
         │
         ├──────────────────────────────────────────┐
         ▼                                          ▼
┌──────────────────┐                    ┌───────────────────┐
│ chartData        │                    │ filterValidLatency│
│ (all data points)│                    │ (utils.ts)        │
│                  │                    │                   │
│ Used by:         │                    │ Filters to points │
│ - Packet Loss    │                    │ with non-null     │
│ - Tooltip        │                    │ min/max/avg       │
│ - Stats          │                    │                   │
└──────────────────┘                    │ Used by:          │
                                        │ - Smoke Bars      │
                                        │ - Stat Lines      │
                                        │ - Y-Scale calc    │
                                        └───────────────────┘
```

## Shared Dependencies

### 1. ChartScales (CRITICAL)

All layers depend on the same `ChartScales` object created in `D3SmokeChart.tsx`:

```typescript
interface ChartScales {
  xScale: d3.ScaleTime<number, number>;  // Maps timestamp → x position
  yScale: d3.ScaleLinear<number, number>; // Maps latency (ms) → y position
}
```

**⚠️ Modifying scale calculations affects ALL layers:**
- If you change how `xScale` is computed, all horizontal positioning breaks
- If you change how `yScale` is computed, all vertical positioning breaks
- The y-scale domain is based on either `max` values or P99, controlled by `clipToP99`

### 2. Bucket Interval

The `bucketInterval` (calculated in `utils.ts`) represents the median time gap between data points. It's used by multiple layers to:
- Calculate bar widths that fill gaps without overlapping
- Detect gaps in data (time difference > 2× interval means gap)
- Split lines into segments at gaps

**⚠️ If you modify `calculateBucketInterval`, these layers are affected:**
- Smoke Bars (bar width calculation)
- Packet Loss (region boundaries)
- Stat Lines (segment detection)
- Median Line (segment detection)

### 3. Chart Dimensions

```
┌─────────────────────────────────────────────────────────────────┐
│                          dimensions.width                        │
│  ┌──────────┬──────────────────────────────────────┬──────────┐ │
│  │ margin   │            innerWidth                │  margin  │ │
│  │ .left    │                                      │  .right  │ │
│  │          │  ┌────────────────────────────────┐  │ (Stats   │ │
│  │          │  │         chartHeight            │  │  Panel)  │ │
│  │          │  │  (innerHeight - 40px for       │  │          │ │
│  │          │  │   packet loss area below)      │  │          │ │
│  │          │  └────────────────────────────────┘  │          │ │
│  └──────────┴──────────────────────────────────────┴──────────┘ │
│  margin.bottom (includes X-axis + Legend)                        │
└─────────────────────────────────────────────────────────────────┘
```

**Key constants:**
- `STATS_PANEL_WIDTH = 150` - Width reserved for stats panel
- `MOBILE_BREAKPOINT = 480` - Below this, use compact layout
- `chartHeight = innerHeight - 40` - 40px reserved for packet loss

### 4. Clip Path

The smoke bars layer creates a clip path (`#chart-clip`) that:
- Clips rendered content to the chart area
- Is reused by packet loss layer
- Prevents content from overflowing into margins

**⚠️ If smoke bars are disabled, the clip path is NOT created.** If packet loss is enabled but smoke bars are disabled, this could cause issues.

## Layer Dependencies Matrix

| Layer | Depends On | Affects |
|-------|------------|---------|
| **Smoke Bars** | scales, validLatencyData, bucketInterval, dimensions | Creates clip path used by Packet Loss |
| **Packet Loss** | scales, chartData, bucketInterval, dimensions | Uses clip path from Smoke Bars |
| **Stat Lines** | scales, validLatencyData, bucketInterval | None (pure rendering) |
| **Median Line** | scales, validLatencyData, bucketInterval | None (uses renderStatLine internally) |
| **Grid & Axes** | scales, dimensions, themeColors | None (pure rendering) |
| **Stats Panel** | stats (from calculateChartStats), dimensions, themeColors | Affects margin.right |
| **Legend** | dimensions, visibility, themeColors | None (pure rendering) |
| **Tooltip** | scales, chartData, dimensions, themeColors | Creates DOM element in body (cleanup required) |

## Rendering Order

Layers are rendered in this specific order in `D3SmokeChart.tsx`:

```typescript
// 1. Smoke Bars (includes clip path creation)
if (visibility.showSmokeBars) { renderSmokeBars(...) }

// 2. Packet Loss (inserted BEFORE smoke layer in DOM)
if (visibility.showPacketLoss) { renderPacketLoss(...) }

// 3. Statistical Lines (on top of smoke/packet loss)
if (visibility.showMedianLine) { renderMedianLine(...) }
if (visibility.showMinLine) { renderStatLine(..., min) }
if (visibility.showMaxLine) { renderStatLine(..., max) }
if (visibility.showAvgLine) { renderStatLine(..., avg) }

// 4. Grid and Axes
renderGrid(...);
renderAxes(...);

// 5. Stats Panel (positioned outside chart area)
if (visibility.showStatsPanel) { renderStatsPanel(...) }

// 6. Legend (below chart area)
renderLegend(...);

// 7. Tooltip (transparent overlay on top of everything)
setupTooltip(...);
```

**⚠️ DOM Order Matters:**
- Packet Loss uses `.insert('g', '.smoke-layer')` to ensure it renders BEHIND smoke bars
- Tooltip overlay must be on top to capture mouse events
- Grid lines should be behind data visualization

## Visibility Options

The `ChartVisibilityOptions` interface controls what's shown:

```typescript
interface ChartVisibilityOptions {
  showMedianLine: boolean;   // Green line with points
  showMinLine: boolean;      // Blue min line
  showMaxLine: boolean;      // Red max line
  showAvgLine: boolean;      // Amber avg line
  showSmokeBars: boolean;    // Gray variance rectangles
  showPacketLoss: boolean;   // Background coloring
  showStatsPanel: boolean;   // Right-side panel (affects margins!)
  clipToP99: boolean;        // Clip y-scale to 99th percentile
}
```

**⚠️ `showStatsPanel` affects chart dimensions:**
When enabled, `margin.right` becomes `STATS_PANEL_WIDTH (150px)`. This changes `innerWidth` and thus affects ALL layers that use horizontal positioning.

## Color System

Colors are defined in `/lib/chartColors.ts` and should be modified there only:

```typescript
chartColors.median  // #22c55e - green for median line
chartColors.avg     // #f59e0b - amber for average
chartColors.min     // #3b82f6 - blue for minimum
chartColors.max     // #ef4444 - red for maximum
chartColors.packetLoss.none/low/medium/high // Severity colors
```

Theme colors (`ThemeColors`) adapt to light/dark mode and are passed to layers.

## Common Pitfalls

### 1. Forgetting to handle null values
```typescript
// ❌ Wrong - will crash on null
yScale(d.avg)

// ✅ Correct - use validLatencyData or check
yScale(d.avg!)  // Only if filtered through filterValidLatencyData
```

### 2. Modifying scales after creation
```typescript
// ❌ Don't modify scales after passing to layers
scales.yScale.domain([0, 200]);

// ✅ Calculate domain correctly before creating scales
const latencyMax = visibility.clipToP99 ? p99Value : absoluteMax;
const yScale = d3.scaleLinear().domain([0, latencyMax * 1.15])...
```

### 3. Not considering mobile layout
Many layers have mobile-specific adjustments:
- Smaller fonts
- Tighter margins
- Fewer axis ticks

### 4. DOM cleanup
The tooltip creates a DOM element in `document.body`. Always ensure cleanup is called in the useEffect return function.

## Adding a New Layer

1. Create a new file in `layers/` following the existing pattern
2. Define an options interface with required dependencies
3. Add the render call in `D3SmokeChart.tsx` in the correct order
4. Consider if the layer needs:
   - Clip path (use existing `#chart-clip` or create new)
   - Theme colors
   - Visibility toggle
5. Update this document with the new layer's dependencies
6. Add visibility toggle to `ChartControls.tsx` if user-controllable

## Testing Changes

After any modification:
1. Test with various time ranges (1h, 24h, 7d)
2. Test with data containing gaps
3. Test with 100% packet loss periods
4. Test in light and dark themes
5. Test on mobile viewport sizes
6. Test with all visibility options toggled on/off
7. Run `mise run frontend:build` to verify types
