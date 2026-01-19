import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

// Configuration
const TARGET_URL = 'https://www.wifh.com/laser-tattoo-removal/'; // Replace with your target URL
const OUTPUT_FILE = 'scraped_data.json';

// Main scraping function
async function scrapeWebsite(url) {
  try {
    console.log(`Scraping: ${url}`);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);

    const data = {
      title: $('title').text(),
      metaDescription: $('meta[name="description"]').attr('content'),
      headings: [],
      links: [],
      images: [],
      paragraphs: [],
      allText: $('body').text().trim()
    };

    $('h1, h2, h3, h4, h5, h6').each((i, el) => {
      data.headings.push({
        tag: el.name,
        text: $(el).text().trim()
      });
    });

    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href) {
        data.links.push({ href, text });
      }
    });

    $('img').each((i, el) => {
      data.images.push({
        src: $(el).attr('src'),
        alt: $(el).attr('alt') || ''
      });
    });

    $('p').each((i, el) => {
      const text = $(el).text().trim();
      if (text) {
        data.paragraphs.push(text);
      }
    });

    return data;

  } catch (error) {
    console.error('Error scraping:', error.message);
    throw error;
  }
}

// Save data to file
function saveToFile(data, filename) {
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));
  console.log(`Data saved to ${filename}`);
}

// Run the scraper
async function main() {
  try {
    const data = await scrapeWebsite(TARGET_URL);
    saveToFile(data, OUTPUT_FILE);
  } catch (error) {
    console.error('Scraping failed:', error);
  }
}

main();
