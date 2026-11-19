## 1. Technology Stack

| Technology             | Version | Purpose                                                        |
| :--------------------- | :------ | :------------------------------------------------------------- |
| **Angular**            | 21.2.x  | Core framework (Zoneless, Signals-driven state)                |
| **Nx**                 | 22.6.x  | Monorepo orchestration, module boundaries, build caching       |
| **pnpm**               | 10.33.0 | Ultra-fast package manager (symlinked `node_modules`)          |
| **PrimeNG**            | 21.1.3  | Enterprise UI library (Styled Mode with Aura preset)           |
| **AG Grid Enterprise** | 35.2.0  | High-performance data grid with inline editing                 |
| **Native Federation**  | 21.2.x  | Micro-frontend foundation (Angular 15 + React support planned) |
| **Tailwind CSS**       | 4.2.2   | Utility-first CSS (integrated via `@apply` in SCSS)            |
| **TypeScript**         | 5.9.3   | Strict mode enabled (`noImplicitAny`, `strictNullChecks`)      |

---

## 2. Design System & Theming

### Three-Layer UI Architecture

```
┌────────────────────────────────┐
│   1. PrimeNG Design Tokens     │  ← Core look & feel (colors, spacing, typography)
└────────────────────────────────┘
               ↓
┌────────────────────────────────┐
│   2. Tailwind 4 Utilities      │  ← Layout & responsive utilities
└────────────────────────────────┘
               ↓
┌────────────────────────────────┐
│   3. SCSS Organization (BEM)   │  ← Component-specific styles
└────────────────────────────────┘
```

### Layer 1: PrimeNG Styled Mode

We use a **custom Aura-based preset** (`wfx-preset.ts`):

- Defines color palettes, spacing scale, border radii, shadows.
- Applied globally via `providePrimeNG({ theme: { preset: WFX_PRESET } })`.

### Layer 2: Tailwind CSS

Tailwind is used **only** for layout and responsive design:

- We use `@apply` in SCSS (not inline classes in HTML).
- Example:
  ```scss
  .wfx-form-grid {
    @apply grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3;
  }
  ```

### Layer 3: SCSS + BEM

All component styles follow **BEM** (Block Element Modifier):

```scss
.wfx-sales-order {
  // Block
  &__header {
    // Element
    font-size: 1.5rem;
  }

  &__input--error {
    // Element + Modifier
    border-color: red;
  }
}
```

### Dark Mode

Controlled globally via a CSS class:

- **Light Mode**: No class on `<html>`.
- **Dark Mode**: `.wfx-dark` class on `<html>`.
- Service: `WfxThemeService` toggles the class.

### CSS Layer Ordering

We use `@layer` to control specificity:

```scss
@import 'tailwindcss/base' layer(tailwind-base);
@import 'primeng/resources/primeng.css' layer(primeng);
@import 'tailwindcss/utilities' layer(tailwind-utilities);
@import './wfx-overrides.scss' layer(wfx-overrides);
```

---

## 3. AG Grid Integration

### Custom Theme: `ag-theme-wfx`

We created a custom AG Grid theme that inherits from **Quartz** and maps to our PrimeNG design tokens.

```scss
.ag-theme-wfx {
  --ag-background-color: var(--p-surface-0);
  --ag-foreground-color: var(--p-text-color);
  --ag-border-color: var(--p-surface-border);
}
````

### Grid Configuration Example

```typescript
columnDefs: ColDef[] = [
  {
    field: 'orderNumber',
    cellClass: 'wfx-cell-editable',
    editable: true
  }
];
```