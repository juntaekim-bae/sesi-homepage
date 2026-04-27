import http from 'http';
import pkg from 'pg';
const { Pool } = pkg;

const DATABASE_URL   = process.env.DATABASE_URL   || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sesisoft2026';
const PORT           = parseInt(process.env.API_PORT || '3000');
const MAX_UPLOAD_MB  = 10;

const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL })
  : null;

async function init() {
  if (!pool) { console.warn('DATABASE_URL not set — running without DB'); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_config (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      data        JSONB   NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS images (
      id          SERIAL PRIMARY KEY,
      name        TEXT,
      mime        TEXT    NOT NULL DEFAULT 'image/png',
      data        BYTEA   NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_config (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      password    TEXT,
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('DB ready');
}

async function getAdminPassword() {
  if (!pool) return ADMIN_PASSWORD;
  const r = await pool.query('SELECT password FROM admin_config WHERE id = 1');
  return r.rows[0]?.password || ADMIN_PASSWORD;
}

function readBody(req, maxBytes = 1024 * 1024 * MAX_UPLOAD_MB) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > maxBytes) { reject(new Error('Payload too large')); return; }
      chunks.push(c);
    });
    req.on('end',   () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function checkAuth(req) {
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const dbPw   = await getAdminPassword();
  return bearer === dbPw || bearer === ADMIN_PASSWORD;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const path = new URL(req.url, 'http://localhost').pathname;

  try {
    /* ── GET /api/config ── */
    if (path === '/api/config' && req.method === 'GET') {
      if (!pool) { json(res, 200, {}); return; }
      const r = await pool.query('SELECT data FROM site_config WHERE id = 1');
      json(res, 200, r.rows[0]?.data ?? {});
      return;
    }

    /* ── PUT /api/config ── */
    if (path === '/api/config' && req.method === 'PUT') {
      if (!await checkAuth(req)) { json(res, 401, { error: 'Unauthorized' }); return; }
      if (!pool)           { json(res, 503, { error: 'Database not configured' }); return; }
      const body = await readBody(req);
      const cfg  = JSON.parse(body.toString());
      await pool.query(`
        INSERT INTO site_config (id, data, updated_at)
        VALUES (1, $1, NOW())
        ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()
      `, [cfg]);
      json(res, 200, { ok: true, updated: new Date().toISOString() });
      return;
    }

    /* ── POST /api/upload  { name, mime, data: base64 } ── */
    if (path === '/api/upload' && req.method === 'POST') {
      if (!await checkAuth(req)) { json(res, 401, { error: 'Unauthorized' }); return; }
      if (!pool)           { json(res, 503, { error: 'Database not configured' }); return; }
      const body   = await readBody(req);
      const { name, mime, data } = JSON.parse(body.toString());
      const buf    = Buffer.from(data, 'base64');
      const r      = await pool.query(
        'INSERT INTO images (name, mime, data) VALUES ($1, $2, $3) RETURNING id',
        [name || 'upload', mime || 'image/png', buf]
      );
      json(res, 200, { id: r.rows[0].id, url: `/api/images/${r.rows[0].id}` });
      return;
    }

    /* ── GET /api/images/:id ── */
    const imgMatch = path.match(/^\/api\/images\/(\d+)$/);
    if (imgMatch && req.method === 'GET') {
      if (!pool) { res.writeHead(404); res.end(); return; }
      const r = await pool.query('SELECT mime, data FROM images WHERE id = $1', [imgMatch[1]]);
      if (!r.rows[0]) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type':  r.rows[0].mime,
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
      res.end(r.rows[0].data);
      return;
    }

    /* ── DELETE /api/images/:id ── */
    const delMatch = path.match(/^\/api\/images\/(\d+)$/);
    if (delMatch && req.method === 'DELETE') {
      if (!await checkAuth(req)) { json(res, 401, { error: 'Unauthorized' }); return; }
      if (!pool)           { json(res, 503, { error: 'Database not configured' }); return; }
      await pool.query('DELETE FROM images WHERE id = $1', [delMatch[1]]);
      json(res, 200, { ok: true });
      return;
    }

    /* ── POST /api/login { password } ── */
    if (path === '/api/login' && req.method === 'POST') {
      const body    = await readBody(req);
      const { password } = JSON.parse(body.toString());
      const dbPw    = await getAdminPassword();
      const ok      = password === dbPw || password === ADMIN_PASSWORD;
      json(res, ok ? 200 : 401, { ok });
      return;
    }

    /* ── PUT /api/password { newPassword } ── */
    if (path === '/api/password' && req.method === 'PUT') {
      if (!await checkAuth(req)) { json(res, 401, { error: 'Unauthorized' }); return; }
      if (!pool)                  { json(res, 503, { error: 'Database not configured' }); return; }
      const body          = await readBody(req);
      const { newPassword } = JSON.parse(body.toString());
      if (!newPassword || newPassword.length < 4) { json(res, 400, { error: 'Too short' }); return; }
      await pool.query(`
        INSERT INTO admin_config (id, password, updated_at)
        VALUES (1, $1, NOW())
        ON CONFLICT (id) DO UPDATE SET password = $1, updated_at = NOW()
      `, [newPassword]);
      json(res, 200, { ok: true });
      return;
    }

    /* ── Health check ── */
    if (path === '/api/health' && req.method === 'GET') {
      json(res, 200, { ok: true, db: !!pool });
      return;
    }

    res.writeHead(404); res.end('Not found');
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
});

await init();
server.listen(PORT, () => console.log(`API server on :${PORT}`));
