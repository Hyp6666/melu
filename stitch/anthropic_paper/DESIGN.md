# Design System Documentation: The Editorial Dashboard

## 1. Overview & Creative North Star
### Creative North Star: "The Digital Manuscript"
This design system rejects the sterile, "software-as-a-service" aesthetic in favor of a high-end editorial experience. We are not just building an observability dashboard; we are crafting a sophisticated technical journal. The goal is to balance the high-density requirements of system monitoring with the breathability and prestige of a boutique print publication.

By leveraging intentional asymmetry, high-contrast typography scales, and a "digital paper" tactile feel, we move away from the generic "dashboard-in-a-box" look. This system treats data as narrative, using warmth and texture to reduce cognitive load in high-stress monitoring environments.

---

## 2. Colors & Surface Philosophy
The palette is grounded in warmth (`surface: #fbf9f6`) to avoid eye strain, accented by the intellectual authority of `primary: #532aa8` (Purple) and the prestigious utility of `secondary: #735c00` (Muted Gold).

### The "No-Line" Rule
To achieve a premium feel, **1px solid borders are strictly prohibited for sectioning.** We do not "box" content. Instead, boundaries must be defined through background color shifts or whitespace. 
- Use `surface-container-low` to define a sidebar against a `surface` background.
- Use `surface-container-lowest` for cards to make them appear "lifted" through color rather than strokes.

### Surface Hierarchy & Nesting
Think of the UI as a series of stacked, physical sheets of fine paper.
1.  **Base Layer:** `surface` (#fbf9f6)
2.  **Sectioning Layer:** `surface-container-low` (#f5f3f0) — Use this for large layout regions.
3.  **Component Layer:** `surface-container-lowest` (#ffffff) — Use this for high-density data cards.
4.  **Interaction Layer:** `surface-container-high` (#eae8e5) — Use for hover states or active regions.

### Glass & Gradient Rule
For floating elements (modals, tooltips, or "live" status popovers), use Glassmorphism. Apply `surface-container` with 80% opacity and a `backdrop-blur-md`. 
*Signature Polish:* Main Action Buttons or critical "Hero" charts should use a subtle linear gradient from `primary` (#532aa8) to `primary_container` (#6b46c1) at a 135-degree angle to add depth that flat colors cannot achieve.

---

## 3. Typography: The Editorial Mix
We utilize a "High-Low" typographic strategy: **Newsreader** (Serif) for narrative and authority, and **Inter** (Sans-serif) for technical precision.

- **Editorial Authority (Headlines):** Use `headline-lg` and `headline-md` (Newsreader) for page titles and section headers. This signals that the data below is curated and significant.
- **Data Utility (Body & Labels):** Use `body-md` and `label-sm` (Inter) for all observability metrics, logs, and technical data. The clean sans-serif ensures maximum legibility at high density.
- **Asymmetric Hierarchy:** Don't center-align. Use left-aligned `display-sm` titles with generous `spacing-10` padding to create an "Editorial Margin" on the left side of the dashboard, allowing the data to breathe.

---

## 4. Elevation & Depth
In this system, depth is a whisper, not a shout. We convey hierarchy through **Tonal Layering** rather than shadows.

- **The Layering Principle:** Place a `surface-container-lowest` card on a `surface-container-low` background. The slight shift in hex value creates a natural, soft lift.
- **Ambient Shadows:** If an element must float (e.g., a dropdown), use an "Ambient Shadow." 
    - *Shadow Color:* Use a 6% opacity version of `on-surface` (#1b1c1a). 
    - *Blur:* Use a large 16px to 24px blur with 0px offset to mimic soft, overhead gallery lighting.
- **The "Ghost Border" Fallback:** If accessibility requires a container boundary, use a **Ghost Border**. Apply `outline-variant` (#cbc3d5) at 15% opacity. It should be felt, not seen.

---

## 5. Components

### Buttons
- **Primary:** Gradient fill (`primary` to `primary_container`). `rounded-md` (0.375rem). Text: `label-md` (Inter), Uppercase with 0.05em tracking.
- **Secondary:** `surface-container-high` background with `on-surface` text. No border.
- **Tertiary:** Text-only using `primary` color. Use for low-emphasis actions in high-density lists.

### High-Density Cards
- **Construction:** Background `surface-container-lowest`. Padding: `spacing-4`.
- **Constraint:** Forbid divider lines. Separate the card header from the data using `spacing-3` of vertical white space and a weight change in typography (Newsreader `title-sm` for the title, Inter `label-sm` for the metadata).

### Inputs & Search
- **Field:** Use `surface-container-highest` for the input track. `rounded-sm` (0.125rem) to maintain a "sharp" professional look.
- **State:** On focus, use a 1px "Ghost Border" of `primary` at 40% opacity.

### Observability Accents (Charts & Chips)
- **Status Chips:** Use `secondary_container` (Muted Gold) for "Warning" and `primary_fixed` (Soft Purple) for "Info." 
- **Data Visualization:** For high-density line charts, use `primary` for the main trend line. Use `secondary` for secondary comparisons. Ensure the "paper" texture is maintained by using a very subtle `surface_variant` grid for the chart axes—never solid black.

---

## 6. Do's and Don'ts

### Do
- **Do** use `spacing-8` or `spacing-12` between major modules to create an "Editorial" layout.
- **Do** use Newsreader for any text that describes *what* the user is looking at (The "Story").
- **Do** use Inter for any text that describes *the value* of the data (The "Fact").
- **Do** rely on `surface-container` tiers for nesting instead of adding borders.

### Don't
- **Don't** use pure black (#000000) for text. Always use `on-surface` (#1b1c1a) to maintain the "ink on paper" softness.
- **Don't** use standard 4px or 8px "Drop Shadows" from generic UI kits.
- **Don't** crowd the edges. High density requires *more* margin at the edges of the screen (use `spacing-16` for page gutters) to frame the information properly.
- **Don't** use bright, saturated "Safety Green" or "Alert Red" unless absolutely necessary. Use `error` (#ba1a1a) sparingly, and favor the muted gold `secondary` for non-critical alerts.