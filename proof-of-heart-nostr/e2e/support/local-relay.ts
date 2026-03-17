import { WebSocketServer } from 'ws';

type NostrEvent = {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  sig: string;
};

const events: NostrEvent[] = [];

function tagValues(ev: NostrEvent, key: string): string[] {
  return (ev.tags || []).filter((t) => t[0] === key).map((t) => t[1]);
}

function matchesFilter(ev: NostrEvent, filter: any): boolean {
  if (Array.isArray(filter?.kinds) && !filter.kinds.includes(ev.kind)) return false;
  if (Array.isArray(filter?.authors) && !filter.authors.includes(ev.pubkey)) return false;
  if (typeof filter?.since === 'number' && ev.created_at < filter.since) return false;
  if (typeof filter?.until === 'number' && ev.created_at > filter.until) return false;

  for (const [k, v] of Object.entries(filter || {})) {
    if (!k.startsWith('#')) continue;
    const tag = k.slice(1);
    const wanted = Array.isArray(v) ? v.map(String) : [];
    if (!wanted.length) continue;
    const got = tagValues(ev, tag);
    if (!got.some((x) => wanted.includes(String(x)))) return false;
  }

  return true;
}

export async function startLocalRelay(port = 7777): Promise<{ stop: () => Promise<void> }> {
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (!Array.isArray(msg) || msg.length < 2) return;
      const [type] = msg;

      if (type === 'EVENT') {
        const ev = msg[1] as NostrEvent;
        if (!ev?.id) return;
        const idx = events.findIndex((x) => x.kind === ev.kind && x.pubkey === ev.pubkey && JSON.stringify(x.tags) === JSON.stringify(ev.tags));
        if (idx >= 0) events[idx] = ev;
        else events.push(ev);
        ws.send(JSON.stringify(['OK', ev.id, true, '']))
      }

      if (type === 'REQ') {
        const subId = String(msg[1]);
        const filters = msg.slice(2);
        let out = events.slice();

        if (filters.length) {
          out = out.filter((ev) => filters.some((f: any) => matchesFilter(ev, f)));
        }

        out.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        const limit = Number(filters?.[0]?.limit || out.length);
        out.slice(0, Number.isFinite(limit) ? limit : out.length).forEach((ev) => {
          ws.send(JSON.stringify(['EVENT', subId, ev]));
        });

        ws.send(JSON.stringify(['EOSE', subId]));
      }
    });
  });

  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));

  return {
    stop: async () => {
      wss.clients.forEach((c) => {
        try { c.terminate(); } catch {}
      });
      await new Promise<void>((resolve, reject) => wss.close((err) => (err ? reject(err) : resolve())));
    }
  };
}
