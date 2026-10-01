# QuantsPulse

Research on rules you can read — watchlists, rule-based signals, portfolio tracking and price alerts for
NSE/BSE stocks. Multi-tenant, with holdings private to each user even inside an organisation.

**Agents and contributors: start with [AGENTS.md](AGENTS.md).**

## Quick start

```bash
# 1. Web app
cd web
cp .env.example .env.local     # fill Supabase URL/keys, generate QP_SECRETS_KEY_V1
npm install
npm run dev                    # http://localhost:3000

# 2. Database tests (no Docker needed)
cd ../supabase/tests/harness
npm install && npm test
```

Apply the database to a Supabase project and enable the auth hook: see [PLAYBOOK.md §H](PLAYBOOK.md).

## Docs

| | |
|---|---|
| [AGENTS.md](AGENTS.md) | Rules, repo map, definition of done |
| [PLAYBOOK.md](PLAYBOOK.md) | Step-by-step recipes |
| [CHANGELOG.md](CHANGELOG.md) | What changed |
| [docs/BRD.md](docs/BRD.md) | Business requirements and status |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it fits together |
| [docs/CODEMAP.md](docs/CODEMAP.md) | Inventory of functions, RPCs, routes, components |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why things are the way they are |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Stubs, gaps, next steps |
| [design-system/quantspulse/MASTER.md](design-system/quantspulse/MASTER.md) | Visual system (Zen Linen) |
| [quantspulse_supabase_schema.md](quantspulse_supabase_schema.md) | Original data & security spec |
