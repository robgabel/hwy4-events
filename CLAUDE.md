# Hwy 4 Events

Community event listing for the Highway 4 corridor in Calaveras County, California — Angels Camp to Bear Valley.

## Stack

- **Framework**: Next.js (App Router, TypeScript)
- **Styling**: Tailwind CSS with custom design tokens (forest, pine, stone, earth, cream, warm-white)
- **Database**: Supabase (PostgreSQL) — tables: `hwy4_events`, `hwy4_orgs`, `site_config`
- **Email**: Resend (newsletter@hwy4events.com)
- **Hosting**: Vercel
- **DNS**: Vercel (hwy4events.com)
- **Domain**: hwy4events.com
- **Fonts**: Bitter (display), DM Sans (body) via Google Fonts

## Key directories

- `app/` — Next.js App Router pages and API routes
- `components/` — React components (EventCard, EventList, FilterBar, etc.)
- `lib/` — Shared utilities, types, constants, Supabase client
- `lib/towns.ts` — Geographic data for all 9 corridor towns (west to east by elevation)
- `lib/types.ts` — TypeScript types, TOWNS constant, event categories
- `supabase/migrations/` — Database migrations

## Infrastructure

- **Email sending**: Resend API (`RESEND_API_KEY` env var), sends from `newsletter@hwy4events.com`
- **Admin email**: robgabel@gmail.com (receives feedback, notifications)
- **Newsletter**: Weekly Thursday roundup via Resend
- **Feedback**: Anonymous form on /about, sends to admin via Resend

## Towns covered (west to east)

Copperopolis, Angels Camp, Murphys, Avery, White Pines, Arnold, Dorrington, Camp Connell, Bear Valley

## Mascot

Millie the sheepadoodle. SVGs in `/public/millie-*.svg`.

## Conventions

- Commit messages: imperative mood, concise, explain "why" not "what"
- Components are in `components/` (flat, no nesting)
- API routes follow Next.js App Router convention (`app/api/*/route.ts`)
- Private/member events use the "Clubs" filter (lock icon) — not shown by default
- URL filtering supported: `?town=Avery` pre-filters to a specific town
