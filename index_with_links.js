import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import open from 'open';
import { google } from 'googleapis';
import zapierRoute from './zapier.js';

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
      'Invalid credentials.json: expected "installed" or "web"'
    );
  }

  const { client_id, client_secret, redirect_uris } = oauthConfig;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  if (fs.existsSync(TOKEN_PATH)) {
    oAuth2Client.setCredentials(
      JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'))
    );
    return oAuth2Client;
  }

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('Authorize this app:\n', authUrl);
  await open(authUrl);

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const code = await new Promise(resolve =>
    rl.question('Enter the code from that page here: ', resolve)
  );

  rl.close();

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

  return oAuth2Client;
}


/* ================= SCRAPER ================= */

function extractStructuredContent(html) {
  const $ = cheerio.load(html);

  // Remove junk
  $('nav, header, footer, aside, script, style, iframe , .menu_mobile, .mobile-footer-icons-section, .modal-body, #breadcrumbs, .elementor-icon-list-items, .footer_top_form_div, .xoo-cp-container').remove();

  const elements = [];
  let lastText = '';

  $('body').find('h1, h2, h3, h4, p, ul, ol, div').each((_, el) => {
    const tag = el.tagName.toLowerCase();

    /* ---------------- HEADINGS ---------------- */
    if (['h1', 'h2', 'h3', 'h4'].includes(tag)) {
      const text = $(el).text().trim();
      if (text && text !== lastText) {
        elements.push({ type: tag, text });
        lastText = text;
      }
    }

    /* ---------------- PARAGRAPHS WITH INLINE LINKS ---------------- */
    if (tag === 'p') {
      const segments = [];
      
      // Process all child nodes in order
      $(el).contents().each((_, node) => {
        if (node.type === 'text') {
          const text = $(node).text().trim();
          if (text) {
            segments.push({ type: 'text', text });
          }
        } else if (node.name === 'a') {
          const text = $(node).text().trim();
          const href = $(node).attr('href');
          if (text && href && !href.startsWith('javascript:')) {
            segments.push({ type: 'link', text, href });
          }
        } else if (['strong', 'em', 'span', 'sup'].includes(node.name)) {
          // Handle nested content recursively
          $(node).contents().each((_, child) => {
            if (child.type === 'text') {
              const text = $(child).text().trim();
              if (text) {
                segments.push({ type: 'text', text });
              }
            } else if (child.name === 'a') {
              const text = $(child).text().trim();
              const href = $(child).attr('href');
              if (text && href && !href.startsWith('javascript:')) {
                segments.push({ type: 'link', text, href });
              }
            }
          });
        }
      });

      // Get full text to check for iframe junk
      const fullText = $(el).text().trim();
      
      // Block encoded iframe junk
      if (
        !fullText ||
        fullText.includes('<iframe') ||
        fullText.includes('&lt;iframe') ||
        fullText.includes('</iframe') ||
        fullText.includes('&lt;/iframe')
      ) {
        return;
      }

      if (fullText.length > 5 && fullText !== lastText && segments.length > 0) {
        elements.push({ type: 'p', segments });
        lastText = fullText;
      }
    }

    /* ---------------- TEXT NODES INSIDE DIV ---------------- */
    if (tag === 'div') {

      /* ---------------- ACCORDION / TITLE DIV (SPAN ONLY) ---------------- */
      if (
        $(el).children('span').length &&
        !$(el).children('p, ul, ol, div').length
      ) {
        const text = $(el)
          .children('span')
          .first()
          .text()
          .replace(/\s+/g, ' ')
          .trim();

        if (text.length > 5 && text !== lastText) {
          elements.push({ type: 'p', segments: [{ type: 'text', text }] });
          lastText = text;
        }

        return;
      }

      /* ---------------- CONTENT DIV (TEXT + INLINE TAGS) ---------------- */
      const text = $(el)
        .contents()
        .filter((_, node) =>
          node.type === 'text' ||
          (node.type === 'tag' && ['a', 'sup', 'strong'].includes(node.name))
        )
        .text()
        .replace(/\s+/g, ' ')
        .trim();

      if (text.length > 20 && text !== lastText) {
        elements.push({ type: 'p', segments: [{ type: 'text', text }] });
        lastText = text;
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
    // Handle paragraphs with segments (text + inline links)
    if (item.type === 'p' && item.segments) {
      const segmentPositions = [];
      
      // First pass: insert all text
      for (const segment of item.segments) {
        const text = segment.text + (segment.type === 'link' ? '' : ' ');
        
        requests.push({
          insertText: {
            location: { index },
            text,
          },
        });

        const start = index;
        const end = index + text.length;
        
        segmentPositions.push({
          start,
          end,
          segment
        });

        index = end;
      }

      // Add newline after all segments
      requests.push({
        insertText: {
          location: { index },
          text: '\n',
        },
      });

      const paraEnd = index + 1;

      // Second pass: apply styling to all segments
      for (const pos of segmentPositions) {
        // Base font for all text
        requests.push({
          updateTextStyle: {
            range: { startIndex: pos.start, endIndex: pos.end },
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

        // Apply link styling only to link segments
        if (pos.segment.type === 'link') {
          requests.push({
            updateTextStyle: {
              range: { startIndex: pos.start, endIndex: pos.end },
              textStyle: {
                link: {
                  url: pos.segment.href,
                },
                foregroundColor: {
                  color: {
                    rgbColor: { blue: 1 },
                  },
                },
                underline: true,
              },
              fields: 'link,foregroundColor,underline',
            },
          });
        }
      }

      // Paragraph spacing
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: index, endIndex: paraEnd },
          paragraphStyle: {
            spaceBelow: {
              magnitude: 10,
              unit: 'PT',
            },
          },
          fields: 'spaceBelow',
        },
      });

      index = paraEnd;
      continue;
    }

    // Handle other elements (headings, lists, plain text)
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
    const headingMap = {
      h1: 'HEADING_1',
      h2: 'HEADING_2',
      h3: 'HEADING_3',
      h4: 'HEADING_4',
    };

    if (headingMap[item.type]) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: start, endIndex: end },
          paragraphStyle: {
            namedStyleType: headingMap[item.type],
          },
          fields: 'namedStyleType',
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
    <h2>Scrape URLs to Google Docs</h2>
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

app.use('/zapier', zapierRoute);

/* ================= START SERVER ================= */

app.listen(3000, () => {
  console.log('UI running at http://localhost:3000');
});