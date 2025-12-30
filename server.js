import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 4000;
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://pastebin-frontend-alpha.vercel.app/'; // for returned shareable URL

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// In-memory store: { id: { content, expiresAtMs|null, maxViews|null, views } }
const pastes = new Map();

// Health check
app.get('/api/healthz', (req, res) => {
  // For in-memory, we assume OK; if using DB, check connection here.
  res.status(200).json({ ok: true });
});

// Create a paste
app.post('/api/pastes', (req, res) => {
  const { content, ttl_seconds, max_views } = req.body || {};

  // Validate content
  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: 'content is required and must be a non-empty string' });
  }

  // Validate ttl_seconds (optional, integer >= 1)
  if (ttl_seconds !== undefined) {
    if (!Number.isInteger(ttl_seconds) || ttl_seconds < 1) {
      return res.status(400).json({ error: 'ttl_seconds must be an integer ≥ 1' });
    }
  }

  // Validate max_views (optional, integer >= 1)
  if (max_views !== undefined) {
    if (!Number.isInteger(max_views) || max_views < 1) {
      return res.status(400).json({ error: 'max_views must be an integer ≥ 1' });
    }
  }

  const id = uuidv4();
  const nowMs = Date.now();
  const expiresAtMs = ttl_seconds ? nowMs + ttl_seconds * 1000 : null;
  const maxViews = max_views ?? null;

  pastes.set(id, {
    content,
    expiresAtMs,
    maxViews,
    views: 0
  });

  return res.status(201).json({
    id,
    url: `${APP_BASE_URL}/p/${id}`
  });
});

// Fetch a paste (API)
app.get('/api/pastes/:id', (req, res) => {
  const { id } = req.params;

  // x-test-now-ms overrides current time for expiry logic only
  const headerNow = req.header('x-test-now-ms');
  const nowMs = headerNow !== undefined ? parseInt(headerNow, 10) : Date.now();
  if (Number.isNaN(nowMs)) {
    // If header is invalid, treat as bad request for clarity
    return res.status(400).json({ error: 'x-test-now-ms must be milliseconds since epoch' });
  }

  const paste = pastes.get(id);
  if (!paste) {
    return res.status(404).json({ error: 'Paste unavailable' });
  }

  // Check TTL expiry first
  if (paste.expiresAtMs !== null && nowMs > paste.expiresAtMs) {
    pastes.delete(id);
    return res.status(404).json({ error: 'Paste unavailable' });
  }

  // Check view limit before counting this view
  if (paste.maxViews !== null && paste.views >= paste.maxViews) {
    pastes.delete(id);
    return res.status(404).json({ error: 'Paste unavailable' });
  }

  // Count this successful fetch as a view
  paste.views += 1;

  const remainingViews =
    paste.maxViews === null ? null : Math.max(paste.maxViews - paste.views, 0);

  const expiresAt =
    paste.expiresAtMs === null ? null : new Date(paste.expiresAtMs).toISOString();

  return res.status(200).json({
    content: paste.content,
    remaining_views: remainingViews,
    expires_at: expiresAt
  });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
