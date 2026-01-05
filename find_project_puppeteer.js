require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const HOST = process.env.HOST || 'https://openproject.softdebut.com';

(async () => {
    const browser = await puppeteer.launch({
        headless: 'new', // Use new headless mode
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    console.log('Navigating to projects page...');
    // We assume public visibility or we might need login? 
    // Trying without login first to see if publicly listed or if we hit login page.
    // Actually, let's login using existing logic if needed? 
    // Simpler: Just try to fetch the project API via Puppeteer Page context (which bypasses cloudflare often if headers match)

    // Actually, I'll just login manually in script to be safe.
    // Wait, I don't have user/pass here easily accessible (it is interactive).
    // I will try to use the API endpoint with Puppeteer context.

    await page.goto(`${HOST}/login`, { waitUntil: 'domcontentloaded' });

    try {
        const filters = JSON.stringify([{ "name": { "operator": "~", "values": ["eng-sdb"] } }]);
        const url = `${HOST}/api/v3/projects?filters=${encodeURIComponent(filters)}`;
        console.log("Fetching: " + url);

        // Improve reliability: wait a bit
        await new Promise(r => setTimeout(r, 2000));

        const result = await page.evaluate(async (u) => {
            const res = await fetch(u);
            return res.json();
        }, url);

        console.log("Result:", JSON.stringify(result, null, 2));

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
