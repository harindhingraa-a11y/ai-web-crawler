import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import open from 'open';
import { google } from 'googleapis';

/* ================= BASIC SETUP ================= */

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
];

const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';

/* ================= GOOGLE AUTH ================= */

async function authorize() {
  const credentials = JSON.parse(
    fs.readFileSync(CREDENTIALS_PATH, 'utf8')
  );

  const oauthConfig = credentials.installed || credentials.web;

  if (!oauthConfig) {
    throw new Error(
      'Invalid credentials.json format'
    );
  }

  const { client_id, client_secret, redirect_uris } = oauthConfig;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // ✅ PRODUCTION MODE (Render)
  // token.json MUST already exist
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      'token.json not found. Please authorize locally first.'
    );
  }

  oAuth2Client.setCredentials(
    JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'))
  );

  return oAuth2Client;
}


/* ================= SCRAPER ================= */

function extractStructuredContent(html) {
  const $ = cheerio.load(html);
  const elements = [];

  $('body')
    .find('h1, h2, h3, h4, p, ul')
    .each((_, el) => {
      const tag = el.tagName.toLowerCase();

      if (['h1', 'h2', 'h3', 'h4', 'p'].includes(tag)) {
        const text = $(el).text().trim();
        if (text) elements.push({ type: tag, text });
      }

      if (tag === 'ul') {
        $(el)
          .find('li')
          .each((_, li) => {
            const text = $(li).text().trim();
            if (text) elements.push({ type: 'li', text });
          });
      }
    });

  return elements;
}

/* ================= GOOGLE DOCS ================= */

async function createGoogleDoc(docs, title) {
  const doc = await docs.documents.create({
    requestBody: { title },
  });
  return doc.data.documentId;
}

function buildRequests(content) {
  const requests = [];

  for (const item of content) {
    requests.push({
      insertText: {
        location: { index: 1 },
        text: item.text + '\n',
      },
    });

    if (item.type.startsWith('h')) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: 1, endIndex: item.text.length + 1 },
          paragraphStyle: {
            namedStyleType: `HEADING_${item.type[1]}`,
          },
          fields: 'namedStyleType',
        },
      });
    }

    if (item.type === 'li') {
      requests.push({
        createParagraphBullets: {
          range: { startIndex: 1, endIndex: item.text.length + 1 },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
        },
      });
    }
  }

  return requests;
}

/* ================= CORE LOGIC ================= */

async function processUrls(urls) {
  const auth = await authorize();
  const docs = google.docs({ version: 'v1', auth });

  const results = [];

  for (const url of urls) {
    console.log(`Processing: ${url}`);

    const html = (await axios.get(url)).data;
    const content = extractStructuredContent(html);

    const title = url.replace(/https?:\/\//, '');
    const docId = await createGoogleDoc(docs, title);

    const requests = buildRequests(content);

    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests },
    });

    results.push({
      sourceUrl: url,
      docUrl: `https://docs.google.com/document/d/${docId}`,
    });
  }

  return results;
}

/* ================= UI ================= */

app.get('/', (req, res) => {
  res.send(`
    <h2>Scrape URLs to Google Docsss</h2>
    <form method="POST">
      <textarea name="urls" rows="6" cols="70"
        placeholder="Enter one URL per line"></textarea><br/><br/>
      <button type="submit">Generate Google Docs</button>
    </form>
  `);
});

app.post('/', async (req, res) => {
  try {
    const urls = req.body.urls
      .split('\n')
      .map(u => u.trim())
      .filter(Boolean);

    const results = await processUrls(urls);

    let html = `
      <h2>✅ Google Docs Created</h2>
      <ul>
    `;

    for (const item of results) {
      html += `
        <li>
          <strong>${item.sourceUrl}</strong><br/>
          <a href="${item.docUrl}" target="_blank">
            Open Google Doc
          </a>
        </li><br/>
      `;
    }

    html += `
      </ul>
      <a href="/">⬅ Create more</a>
    `;

    res.send(html);
  } catch (err) {
    console.error(err);
    res.send('<h3>❌ Error occurred. Check server logs.</h3>');
  }
});

/* ================= START SERVER ================= */

app.listen(3000, () => {
  console.log('UI running at http://localhost:3000');
});
