# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Start dev server (proxies /api to http://127.0.0.1:8000)
npm run dev

# Production build (runs tsc type-check first)
npm run build

# Lint
npm run lint

# Preview production build
npm run preview
```

## Architecture

React 19 + TypeScript + Vite 7 SPA. Tailwind CSS 4 (via `@tailwindcss/vite` plugin, imported in `index.css`). No component library — all UI is custom-built.

### Key Files

- `src/App.tsx` — Routes, QueryClient, ErrorBoundary, Toaster config. All authenticated routes nest under `<ProtectedRoute><Layout /></ProtectedRoute>` using `<Outlet />`.
- `src/components/Layout.tsx` — Sidebar nav + top bar + global search (Ctrl+K) + task progress polling. Sidebar config lives in `NAV_ITEMS` array.
- `src/lib/api.ts` — Axios instance at `/api` with JWT interceptor, admin mode header (`X-Admin-Mode`), 401 auto-redirect, and FastAPI-compatible array param serialization (`key=1&key=2`). Also exports extraction/cleaning rule API functions.
- `src/lib/auth.ts` — Auth helpers (`getUser`, `setAuth`, `clearAuth`, `getAdminMode`, `toggleAdminMode`). Uses localStorage for token/user/admin_mode.
- `src/lib/feishu.ts` — Feishu JS SDK initialization.
- `src/index.css` — Apple-style design system with CSS custom properties (colors, glass effects, shadows, typography, transitions, radii).

### Directory Structure

```
src/
  pages/           — Route-level page components (DataInsights, DataImport, Chat, Documents, etc.)
  components/      — Shared UI (Layout, GlobalSearch, TagManager, ChatMessages, DataTable/, etc.)
    insights/      — Dashboard widget components (TrendWidget, KGMiniWidget, DataGraphWidget, etc.)
    import/        — Data import components (SmartDropZone, ExtractionRuleEditor, CleaningRuleEditor, etc.)
  hooks/           — useAuth, useTaskProgress (context provider), useWidgetConfig, useAutoSync, useQuickStart
  lib/             — api.ts (axios), auth.ts, feishu.ts
```

### State Management

- **Server state**: TanStack React Query (retry: 1, refetchOnWindowFocus: false)
- **Auth state**: localStorage + `useAuth` hook (not context — reads directly from localStorage)
- **Task progress**: React Context (`TaskProgressProvider` wraps the app, `useTaskProgress` hook)
- **No global client state library** — local component state via useState

### Design System (CSS Custom Properties in index.css)

The UI follows an Apple-inspired glassmorphism design. Key tokens:
- Colors: `--color-accent: #4f46e5` (indigo), `--color-bg-primary: #f5f5f7`, `--color-text-primary: #1d1d1f`
- Glass effects: `apple-glass`, `apple-glass-heavy` CSS classes (backdrop-filter blur)
- Shadows: multi-layer Apple-style (`--shadow-card`, `--shadow-float`, etc.)
- Typography: SF Pro / PingFang SC font stack, `--tracking-tight: -0.022em`
- Use CSS variables (`var(--color-*)`) rather than raw Tailwind color classes for themed elements

### Routing

Routes defined in `App.tsx`. Active pages: `/data-insights`, `/data-import`, `/documents`, `/communications`, `/structured-tables`, `/chat`, `/search`, `/settings`, `/reports/:id`. Many legacy routes (`/todos`, `/knowledge-graph`, `/calendar`, `/meetings`, `/messages`) redirect to consolidated pages via `<Navigate>`.

### Cross-Page Navigation Patterns

- `?highlight={id}` — auto-scroll and highlight a specific row
- `?tab=` — tab selection (`chat`, `todos`, `graph`, `calendar`, `report`)
- `?entity={type}:{name}` — KG entity focus
- `?q=&content_types=&tag_ids=` — search context
- Tags, person names, and document titles should always be clickable links to their respective pages

### API Communication

- Base: `/api` (Vite proxy to `http://127.0.0.1:8000`)
- Auth: Axios interceptor auto-adds `Authorization: Bearer {token}`
- Admin mode: `X-Admin-Mode: true` header when enabled
- Streaming: SSE for chat responses, insights generation, calendar briefing
- 401: auto-clears auth + redirects to `/login`

### Key Libraries

- `lucide-react` for icons
- `recharts` + `d3` for charts/graphs
- `react-markdown` + `remark-gfm` for markdown rendering
- `framer-motion` for animations (page transitions, expand/collapse)
- `react-hot-toast` for notifications (top-center, 3s, glassmorphism style)
