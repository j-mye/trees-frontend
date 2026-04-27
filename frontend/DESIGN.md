# Design System Document: The Authoritative Canvas

## 1. Overview & Creative North Star
**Creative North Star: The Architectural Monograph**

Municipal risk management is often cluttered, reactionary, and overwhelming. This design system rejects the "dashboard-as-a-cockpit" cliché in favor of "The Architectural Monograph." We treat data with the reverence of high-end editorial design—clean, structured, and profoundly calm. 

By utilizing intentional white space, tonal layering, and an aggressive "no-border" philosophy, we move away from "software" and toward an "expert interface." We break the standard grid with purposeful asymmetry—heavy-weighted typography on the left balanced by expansive, airy data visualizations on the right. The result is an environment that feels stable, trustworthy, and intellectually organized.

---

## 2. Colors & Surface Philosophy

### The Foundation
The palette is built on deep Navys (`primary: #4c56af`) and Slates (`secondary: #4d626c`), providing a foundation of municipal authority. 

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders for sectioning or containment. Boundaries must be defined solely through background color shifts or tonal nesting. 
- Use `surface` (#f8f9fa) as your global canvas.
- Define a workspace using `surface-container-low` (#f1f4f6).
- Isolate a primary data module using `surface-container-lowest` (#ffffff).
The eye should perceive a change in depth, not a line on a page.

### Surface Hierarchy & Nesting
Treat the UI as a series of stacked physical layers.
1.  **Level 0 (Canvas):** `surface`
2.  **Level 1 (Sections):** `surface-container-low`
3.  **Level 2 (Active Modules):** `surface-container-highest` or `surface-container-lowest` for high-contrast focus.

### The "Glass & Gradient" Rule
To prevent the UI from feeling "flat" or "cheap," floating modals and navigation overlays must utilize Glassmorphism. Use a semi-transparent `surface` with a 20px-30px backdrop-blur. 
*Signature Polish:* Main CTAs should not be flat. Apply a subtle linear gradient from `primary` (#4c56af) to `primary_dim` (#4049a2) to give the element a tactile, weighted presence.

---

## 3. Typography: The Editorial Voice

We utilize **Inter** for its mathematical precision and neutral tone. The hierarchy is designed to guide the eye through complex risk assessments without fatigue.

*   **Display (lg/md/sm):** Used for high-level municipal overviews. These should be set with tight tracking (-0.02em) to feel authoritative and "inked."
*   **Headline (lg/md/sm):** Reserved for section headers. Always paired with generous top-padding to allow the data below to breathe.
*   **Title (lg/md):** Used for card headings. These are the "anchors" of the interface.
*   **Body (lg/md):** The workhorse. `body-md` (0.875rem) is the standard for data entry and descriptions, ensuring high information density without sacrificing legibility.
*   **Label (md/sm):** Use `label-md` for metadata and micro-copy. Always set in `on_surface_variant` (#586064) to maintain hierarchy.

---

## 4. Elevation & Depth: Tonal Layering

### The Layering Principle
Forget shadows for standard cards. Achieve elevation by placing a `surface-container-lowest` (#ffffff) element atop a `surface-container-low` (#f1f4f6) background. The subtle 2% shift in brightness is sufficient for the human eye to perceive a "lift."

### Ambient Shadows
When an element must "float" (e.g., a critical risk modal), use an ambient shadow:
- **X: 0, Y: 12, Blur: 32**
- **Color:** `on_surface` (#2b3437) at **4% opacity**.
This mimics natural light rather than a digital drop shadow.

### The "Ghost Border" Fallback
If a container requires a boundary (e.g., in a high-density data table), use a **Ghost Border**: `outline-variant` (#abb3b7) at **15% opacity**. Never use 100% opaque lines.

---

## 5. Components

### Buttons
- **Primary:** Gradient fill (`primary` to `primary_dim`), `on_primary` text, `md` (0.375rem) corner radius.
- **Secondary:** Tonal fill using `secondary_container`, no border.
- **Tertiary:** Text-only with `primary` color, used for low-priority actions to reduce visual noise.

### Risk Chips
Semantic colors are used sparingly to prevent "color fatigue":
- **Critical:** `error` (#9e3f4e) text on `error_container` (#ff8b9a) background.
- **High/Med/Low:** Use the specific hex codes provided in the prompt, but always at 10% opacity for the background to keep the text the focal point.

### Cards & Lists
**Forbid divider lines.** Use `1.5rem` of vertical white space to separate list items. For complex data tables, use alternating row backgrounds (Zebra striping) with `surface-container-low` instead of horizontal rules.

### Input Fields
- **Background:** `surface_container_high`.
- **Active State:** A 2px bottom-bar of `primary`, rather than a full-box focus ring. This maintains the "Architectural" feel.

### Specialized Component: The Risk Heat Map
A bespoke component for this system. Use a grid of `surface-container-highest` cells. Importance is signaled by "filling" the cell with a semantic color gradient rather than a solid block, maintaining the glass-like aesthetic of the system.

---

## 6. Do’s and Don’ts

### Do
- **Do** use `surface-dim` to create areas of "recession" for secondary navigation.
- **Do** lean into the `xl` (0.75rem) corner radius for large layout containers to soften the "municipal" feel.
- **Do** use `display-lg` typography for single, impactful data points (e.g., a total risk score).

### Don't
- **Don't** use black (#000000). Use `on_surface` (#2b3437) for all primary text to keep the contrast "expensive" rather than harsh.
- **Don't** use standard 8px padding. Use a 12px/24px/48px scale to create more sophisticated, asymmetrical breathing room.
- **Don't** use icons as purely decorative elements. If an icon is present, it must communicate a status or action.

---

## 7. Implementation scope (repo)

- **React app** (`frontend/src/`): tokens live in [`stitch-theme.css`](src/stitch-theme.css); primary surfaces and components follow this document.
- **Static Tailwind shell** [`public/dashboard.html`](public/dashboard.html): legacy marketing/skeleton layout; full token parity is optional until it is merged into the Vite app.