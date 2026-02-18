# Proof of Heart (Nostr)

Proof of Heart is a Nostr-native charity discovery and donation platform.

It helps donors discover charities through open social proof (followers, ratings, reports, zap totals) and donate directly via Lightning/zaps — without custodial flow or platform-held funds.

## What this app does

- Charity onboarding with Nostr signer (NIP-07)
- Public charity profiles from Nostr data
- Charity extension data via app-specific events
- Community moderation signals (ratings + flags)
- Social proof signals (followers + zapped sats)
- Direct donation/zap flow from Lightning addresses
- Desktop QR fallback for wallet payments
- SEO pages and metadata for discovery

## Nostr event model

- `kind 0`: base profile metadata (name, picture, about, website, lud16/lud06)
- `kind 30078`: charity profile extension (mission, category, country, visibility, donation message)
- `kind 30079`: charity rating events
- `kind 1984`: report/flag events
- `kind 3`: follow graph (follower estimation)
- `kind 9735`: zap receipts (zapped sats aggregation)

## Tech stack

- Angular 20 (standalone components)
- `nostr-tools`
- Angular Material
- Font Awesome

## Routes (main)

- `/` — charity discovery
- `/charities/:npub` — public charity profile
- `/charity/onboard` — charity onboarding confirmation + connect
- `/charity/profile` — charity profile editor
- `/admin` — owner-gated insights dashboard

## Local development

Install dependencies:

```bash
npm install
```

Run dev server:

```bash
npm run start
```

Open: `http://localhost:4200`

## Local relay (dev)

A local relay workflow is included via PowerShell scripts:

- `scripts/start-local-relay.ps1`
- `scripts/stop-local-relay.ps1`

When running on localhost, relay mode can use local test relay (`ws://127.0.0.1:7777`) depending on app relay mode.

## Build

```bash
npm run build
```

## Notes

- This repository describes the current Nostr-based Proof of Heart app.
- Donations are direct and non-custodial: the app does not custody user funds.
