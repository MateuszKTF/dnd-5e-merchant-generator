---
starter_id: 10x-astro-starter
package_manager: npm
project_name: dnd-5e-merchant-generator
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: false
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

The PRD describes a single-user web app with no accounts, no server-side data and a
one-week budget against a hard deadline, so the pick was optimised for time-to-first-screen
rather than platform reach. The 10x Astro Starter was taken as the recommended default for
web-app + TypeScript: it clears all four agent-friendly gates (explicit types, strong layout
and routing conventions, heavily represented in training data, current version-pinned docs),
which matters more than raw feature count when most of the code will be agent-written under
deadline. Astro plus React islands suits a page that is mostly static chrome around one
interactive table, and Tailwind covers the phone-readability requirement without a custom
responsive layer. Cloudflare Pages is the starter's own adapter target, so deployment is the
cheapest step in the chain; GitHub Actions auto-deploys on merge to main. The one mismatch is
deliberate and known: the starter bundles Supabase auth and Postgres, which Access Control
rules out. Merchants persist in browser storage instead; the Supabase layer stays unwired in
v1 and becomes the ready-made path to the deferred cloud-sync feature in v2.
