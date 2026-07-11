---
name: PrinterFarm Dashboard
colors:
  primary: "#FFFFFF"
  secondary: "#A0AEC0"
  tertiary: "#38B2AC"
  background: "#0B0D0F"
  surface: "#1A1D24"
  surface-hover: "#222730"
  border: "#2D3748"
  status-busy: "#48BB78"
  status-free: "#4A5568"
  status-heating: "#ED8936"
typography:
  h1:
    fontFamily: Inter, sans-serif
    fontSize: 2rem
    fontWeight: 700
  h2:
    fontFamily: Inter, sans-serif
    fontSize: 1.25rem
    fontWeight: 600
  body:
    fontFamily: Inter, sans-serif
    fontSize: 1rem
  label:
    fontFamily: Inter, sans-serif
    fontSize: 0.875rem
    fontWeight: 500
rounded:
  sm: 4px
  md: 8px
  lg: 16px
  full: 9999px
spacing:
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
components:
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  button-primary:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.background}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
---

## Overview

A premium, glassmorphism-inspired dark mode dashboard for monitoring a fleet of 3D printers. The design evokes a high-tech command center.

## Colors

The palette is rooted in deep OLED-style blacks with vibrant, neon-like status indicators to draw the eye immediately to active printers.

- **Primary (#FFFFFF):** High contrast white for main text and readouts.
- **Secondary (#A0AEC0):** Cool slate for metadata and secondary labels.
- **Tertiary (#38B2AC):** Neon teal for primary interactive elements (like the Upload button).
- **Background (#0B0D0F):** Deepest black for the canvas.
- **Surface (#1A1D24):** Elevated dark gray for printer cards.

## Typography

Using a modern, clean geometric sans-serif (Inter) to ensure high legibility of technical telemetry (temperatures, progress).

## Layout & Spacing

Generous padding around cards to allow the dashboard to breathe, avoiding the cluttered look of typical technical dashboards.

## Shapes

Soft, large border radii on cards (16px) contrast with the sharp technical data inside, giving a premium consumer-app feel.

## Components

The UI is built around Printer Cards. Each card sits on the dark canvas and contains live telemetry. 
