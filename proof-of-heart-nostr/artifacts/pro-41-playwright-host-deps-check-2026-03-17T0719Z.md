# PRO-41 host dependency unblock attempt (2026-03-17 07:19 UTC)

Issue context: Playwright Chromium fails on host with missing `libatk-1.0.so.0`.

## Commands run

```bash
cd /home/agent/.openclaw/workspace/proof-of-heart-nostr/proof-of-heart-nostr
npx playwright install-deps chromium
```

## Output

```text
Installing dependencies...
Switching to root user to install dependencies...
sudo: a terminal is required to read the password; either use the -S option to read from standard input or configure an askpass helper
sudo: a password is required
Failed to install browser dependencies
Error: Installation process exited with code: 1
```

## Playwright launch verification

```bash
node - <<'NODE'
const { chromium } = require('playwright');
(async()=>{
  const browser = await chromium.launch({headless:true});
  await browser.close();
})();
NODE
```

## Output excerpt

```text
error while loading shared libraries: libatk-1.0.so.0: cannot open shared object file: No such file or directory
```

## Result

Host dependency install is currently blocked by sudo password requirement in this runtime. Chromium cannot launch; PRO-41 end-to-end benchmark cannot be executed yet on this host.
