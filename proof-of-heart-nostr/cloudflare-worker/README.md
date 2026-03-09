# Cloudflare Worker: LNURL Proxy (CORS workaround)

Use this worker when some Lightning providers block browser CORS on LNURL callback endpoints.

## Files
- `worker.mjs` — Worker source

## Deploy (quick)

1. Install Wrangler:
   ```bash
   npm i -g wrangler
   ```
2. Login:
   ```bash
   wrangler login
   ```
3. From this folder, create `wrangler.toml`:
   ```toml
   name = "poh-lnurl-proxy"
   main = "worker.mjs"
   compatibility_date = "2026-03-09"
   ```
4. Deploy:
   ```bash
   wrangler deploy
   ```

## Endpoints

### 1) Get LNURL pay params
`GET /lnurlp?address=donate@example.org`

### 2) Get invoice via callback
`GET /callback?callback=<encoded-callback-url>&amount=1000000&nostr=<optional-zap-json>`

## Frontend integration idea

Try direct first. On `Failed to fetch` / CORS-like failure, fallback to worker:

- `GET https://<worker-domain>/lnurlp?address=${encodeURIComponent(lightningAddress)}`
- then `GET https://<worker-domain>/callback?...`

## Security notes

- Worker only allows HTTPS callback URLs.
- Input is validated.
- CORS is allowed for configured hosts (`ALLOWED_HOSTS` in code).
- Tighten `ALLOWED_HOSTS` for production.
