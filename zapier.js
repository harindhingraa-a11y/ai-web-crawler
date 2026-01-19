import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

// Store results by requestId
const results = {};

/**
 * GET /zapier
 */
router.get('/', (req, res) => {
  const requestId = req.query.requestId || '';

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Scrape URLs to Google Docs</title>
      </head>
      <body style="font-family: Arial; padding: 40px;">
        <h2>Scrape URLs to Google Docs</h2>

        <form method="POST" action="/zapier">
          <input
            type="url"
            name="url"
            required
            placeholder="https://example.com"
            style="width: 400px; padding: 8px;"
          />
          <br /><br />
          <button type="submit">Generate Google Docs</button>
        </form>

        <p id="status">${requestId ? '⏳ Waiting for document...' : ''}</p>

        <script>
          const requestId = "${requestId}";

          if (requestId) {
            setInterval(async () => {
              const res = await fetch("/zapier/result?requestId=" + requestId);
              const data = await res.json();

              if (data.url) {
                document.getElementById("status").innerHTML =
                  '<a href="' + data.url + '" target="_blank">📄 Open Google Doc</a>';
              }
            }, 3000);
          }
        </script>
      </body>
    </html>
  `);
});

/**
 * POST /zapier
 * Send URL to Zapier with requestId
 */
router.post('/', async (req, res) => {
  const url = req.body?.url;

  if (!url) {
    return res.status(400).send('URL is required');
  }

  const requestId = Date.now().toString();

  results[requestId] = null;

  const zapierWebhook =
    `https://hooks.zapier.com/hooks/catch/26055726/uga3dov/?url=${encodeURIComponent(url)}&requestId=${requestId}`;

  await fetch(zapierWebhook);

  res.redirect(`/zapier?requestId=${requestId}`);
});

/**
 * POST /zapier/callback
 * Zapier sends doc URL back
 */
router.post('/callback', (req, res) => {
  const { google_doc_url, requestId } = req.body;

  if (!google_doc_url || !requestId) {
    return res.status(400).json({ error: 'Missing google_doc_url or requestId' });
  }

  results[requestId] = google_doc_url;

  res.json({ success: true });
});

/**
 * GET /zapier/result
 * Frontend polls for its own result
 */
router.get('/result', (req, res) => {
  const { requestId } = req.query;

  res.json({
    url: results[requestId] || null
  });
});

export default router;
