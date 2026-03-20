# Proof of Heart
### Nostr-native charity discovery, direct Bitcoin giving.

> **No custody. No key collection. Don’t trust, verify.**

Proof of Heart helps people discover charities through open social proof and donate directly via Lightning.  
Charities own their identity (`npub`), control their donation endpoints, and publish profile data on Nostr.

---

## Why this exists

Most donation platforms are black boxes: closed data, opaque moderation, and platform-mediated trust.

Proof of Heart takes a different route:

- **Open identity** (Nostr public keys)
- **Open reputation** (followers, ratings, reports)
- **Direct payments** (Lightning/zaps to charity-controlled endpoints)
- **No custodial risk** (platform never holds funds)

---

## Core principles

1. **Identity is portable**
   - Charity identity is anchored to a Nostr pubkey.
2. **Data is auditable**
   - Profile and moderation signals come from public relay data.
3. **Giving is direct**
   - Donor pays the charity endpoint; platform does not intermediate funds.
4. **Trust is earned in public**
   - Social proof and moderation are visible and explainable.

---

## Event model

- **kind 0** → base profile metadata (`name`, `picture`, `about`, `website`, `lud16/lud06`)
- **kind 30078** → Proof of Heart charity extension (mission, country, category, donation fields)
- **kind 30079** → charity ratings
- **kind 1984 (NIP-56)** → reports/flags
- **kind 3** → follow graph (follower estimation)
- **kind 9735** → zap receipts (zapped sats)

---

## Product surfaces

- `/` — charity discovery
- `/charities/:npub` — charity detail page
- `/charity/onboard` — onboarding flow
- `/charity/profile` — charity profile editor
- `/admin` — owner insights dashboard
- `/paper` — protocol/vision page

---

## Tech stack

- Angular 20 (standalone)
- `nostr-tools`
- Angular Material
- Playwright (E2E)

---

## Development

App lives in:

```bash
cd proof-of-heart-nostr
```

Install and run:

```bash
npm ci
npm run start
```

Build:

```bash
npm run build
```

---

## Testing (local-relay first)

E2E policy is local/test relay mode for deterministic runs (not production relays).

```bash
npm run e2e
```

Covered flows include:
- home load
- search/filter
- charity detail open
- static page navigation
- onboarding entry (non-destructive)

---

## CI/CD guardrails

- PRs into `main` require passing **`e2e`** check.
- `main` is branch-protected (no direct force pushes/deletes).
- Azure production deploy workflow is configured to run on **push to `main` only**.

---

## Security + trust model

- Charity signs with Nostr signer (NIP-07); private keys never requested.
- Platform provides indexing/discovery/moderation signals.
- Payment path remains direct between donor and charity Lightning endpoint.

---

If you care about open charity reputation and Bitcoin-native, non-custodial donations, this is the stack.
