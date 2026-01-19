import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

const TARGET_URL = 'https://www.wifh.com/laser-tattoo-removal/';
const OUTPUT_FILE = 'formatted_content.txt';

async function scrapeWebsite(url) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });

  const $ = cheerio.load(response.data);

  let output = '';

  // ---- Title ----
  const title = $('h1').first().text().trim();
  if (title) {
    output += `# ${title}\n\n`;
  }

  // ---- Walk through body in order ----
  $('body')
    .find('h1, h2, h3, p, ul, ol')
    .each((_, el) => {
      const tag = el.tagName.toLowerCase();

      // Headings
      if (tag === 'h1') {
        output += `# ${$(el).text().trim()}\n\n`;
      }
      if (tag === 'h2') {
        output += `## ${$(el).text().trim()}\n\n`;
      }
      if (tag === 'h3') {
        output += `### ${$(el).text().trim()}\n\n`;
      }

      // Paragraphs
      if (tag === 'p') {
        const text = $(el).text().trim();
        if (text.length > 50) {
          output += `${text}\n\n`;
        }
      }

      // Lists
      if (tag === 'ul' || tag === 'ol') {
        $(el)
          .find('li')
          .each((_, li) => {
            const text = $(li).text().trim();
            if (text) {
              output += `• ${text}\n`;
            }
          });
        output += `\n`;
      }
    });

  return output.trim();
}

async function main() {
  const formattedContent = await scrapeWebsite(TARGET_URL);

  fs.writeFileSync(OUTPUT_FILE, formattedContent, 'utf8');
  console.log('Formatted content saved to formatted_content.txt');
}

main();
