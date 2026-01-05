require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const HOST = process.env.OPENPROJECT_HOST;
const API_KEY = process.env.OPENPROJECT_API_KEY;
const authHash = Buffer.from(`apikey:${API_KEY}`).toString('base64');

async function checkActivities() {
    console.log(`Checking Time Entry Activities at: ${HOST}/api/v3/time_entry_activities`);

    // We pass HEADLESS: true to be faster/silent
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        // Go to home to init session
        await page.goto(`${HOST}`, { waitUntil: 'load', timeout: 60000 });

        const url = `${HOST}/api/v3/time_entry_activities`;

        const result = await page.evaluate(async (endpoint, auth) => {
            try {
                const response = await fetch(endpoint, {
                    headers: { 'Authorization': `Basic ${auth}` }
                });
                return await response.json();
            } catch (err) {
                return { error: err.toString() };
            }
        }, url, authHash);

        if (result._embedded && result._embedded.elements) {
            console.log('\n--- AVAILABLE ACTIVITIES ---');
            result._embedded.elements.forEach(el => {
                console.log(`ID: ${el.id} | Name: ${el.name}`);
            });
            console.log('----------------------------');
        } else {
            console.log('Error or No activities found:', result);
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await browser.close();
    }
}

checkActivities();
