import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
} from 'docx';

const TARGET_URL = 'https://www.wifh.com/laser-tattoo-removal/';
const OUTPUT_FILE = 'formatted_content.docx';

async function scrapeWebsite(url) {
  const response = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  const $ = cheerio.load(response.data);
  const content = [];

  $('body')
    .find('h1, h2, h3, p, ul, ol')
    .each((_, el) => {
      const tag = el.tagName.toLowerCase();
      const text = $(el).text().trim();
      if (!text) return;

      // ===== MAIN TITLE =====
      if (tag === 'h1') {
        content.push(
          new Paragraph({
            spacing: { after: 300 },
            children: [
              new TextRun({
                text,
                bold: true,
                font: 'Arial',
                size: 32,
              }),
            ],
          })
        );
      }

      // ===== SECTION HEADINGS =====
      if (tag === 'h2') {
        content.push(
          new Paragraph({
            spacing: { before: 300, after: 200 },
            children: [
              new TextRun({
                text,
                bold: true,
                font: 'Arial',
                size: 26,
              }),
            ],
          })
        );
      }

      // ===== SUB HEADINGS =====
      if (tag === 'h3') {
        content.push(
          new Paragraph({
            spacing: { before: 200, after: 150 },
            children: [
              new TextRun({
                text,
                bold: true,
                font: 'Arial',
                size: 22,
              }),
            ],
          })
        );
      }

      // ===== BODY TEXT =====
      if (tag === 'p' && text.length > 40) {
        content.push(
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text,
                font: 'Arial',
                size: 22,
              }),
            ],
          })
        );
      }

      // ===== BULLET LISTS =====
      if (tag === 'ul' || tag === 'ol') {
        $(el)
          .find('li')
          .each((_, li) => {
            const liText = $(li).text().trim();
            if (liText) {
              content.push(
                new Paragraph({
                  bullet: { level: 0 },
                  spacing: { after: 120 },
                  children: [
                    new TextRun({
                      text: liText,
                      font: 'Arial',
                      size: 22,
                    }),
                  ],
                })
              );
            }
          });
      }
    });

  return content;
}

async function main() {
  const content = await scrapeWebsite(TARGET_URL);

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        children: content,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(OUTPUT_FILE, buffer);

  console.log('Formatted DOCX created successfully');
}

main();
