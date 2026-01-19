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

  // Remove junk
  $('nav, header, footer, aside, script, style, iframe , .menu_mobile, .mobile-footer-icons-section, .modal-body, #breadcrumbs, .elementor-icon-list-items').remove();

  const elements = [];
  let lastText = '';

  $('body').find('h1, h2, h3, p, ul, ol, div').each((_, el) => {
    const tag = el.tagName.toLowerCase();

    /* ---------------- HEADINGS ---------------- */
    if (['h1', 'h2', 'h3'].includes(tag)) {
      const text = $(el).text().trim();
      if (text && text !== lastText) {
        elements.push({ type: tag, text });
        lastText = text;
      }
    }

    /* ---------------- PARAGRAPHS ---------------- */
 if (tag === 'p') {
  const text = $(el).text().trim();

  // ❌ Skip encoded iframes
  if (
    text.includes('<iframe') ||
    text.includes('&lt;iframe') ||
    text.includes('</iframe') ||
    text.includes('&lt;/iframe')
  ) {
    return;
  }

  if (text.length > 5 && text !== lastText) {
    elements.push({ type: 'p', text });
    lastText = text;
  }
}


    /* ---------------- TEXT NODES INSIDE DIV ---------------- */
    if (tag === 'div') {
      const directText = $(el)
        .contents()
        .filter((_, node) => node.type === 'text')
        .text()
        .replace(/\s+/g, ' ')
        .trim();

      if (directText.length > 10 && directText !== lastText) {
        elements.push({ type: 'p', text: directText });
        lastText = directText;
      }
    }

    /* ---------------- UNORDERED LIST ---------------- */
    if (tag === 'ul') {
      $(el)
        .find('li')
        .each((_, li) => {
          const text = $(li).text().trim();
          if (text && text !== lastText) {
            elements.push({ type: 'li', text });
            lastText = text;
          }
        });
    }

    /* ---------------- ORDERED LIST ---------------- */
    if (tag === 'ol') {
      $(el)
        .find('li')
        .each((_, li) => {
          const text = $(li).text().trim();
          if (text && text !== lastText) {
            elements.push({ type: 'oli', text });
            lastText = text;
          }
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
  let index = 1;

  for (const item of content) {
    const text = item.text + '\n';

    // Insert text
    requests.push({
      insertText: {
        location: { index },
        text,
      },
    });

    const start = index;
    const end = index + text.length;

    // Base font for all text
    requests.push({
      updateTextStyle: {
        range: { startIndex: start, endIndex: end },
        textStyle: {
          weightedFontFamily: {
            fontFamily: 'Arial',
          },
          fontSize: {
            magnitude: 11,
            unit: 'PT',
          },
        },
        fields: 'weightedFontFamily,fontSize',
      },
    });

    // Headings
    if (item.type === 'h1' || item.type === 'h2' || item.type === 'h3') {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: start, endIndex: end },
          paragraphStyle: {
            namedStyleType:
              item.type === 'h1'
                ? 'HEADING_1'
                : item.type === 'h2'
                ? 'HEADING_2'
                : 'HEADING_3',
          },
          fields: 'namedStyleType',
        },
      });
    }

    // Paragraph spacing
    if (item.type === 'p') {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: start, endIndex: end },
          paragraphStyle: {
            spaceBelow: {
              magnitude: 10,
              unit: 'PT',
            },
          },
          fields: 'spaceBelow',
        },
      });
    }

    // Bullet list
    if (item.type === 'li') {
      requests.push({
        createParagraphBullets: {
          range: { startIndex: start, endIndex: end },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
        },
      });
    }

    // Numbered list
    if (item.type === 'oli') {
      requests.push({
        createParagraphBullets: {
          range: { startIndex: start, endIndex: end },
          bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN',
        },
      });
    }

    index = end;
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