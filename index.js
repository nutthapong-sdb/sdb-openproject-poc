require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const HOST = process.env.OPENPROJECT_HOST;
const API_KEY = process.env.OPENPROJECT_API_KEY;
const PROJECT_ID = process.env.PROJECT_ID;

if (!HOST || !API_KEY || !PROJECT_ID) {
    console.error('Error: Please set OPENPROJECT_HOST, OPENPROJECT_API_KEY, and PROJECT_ID in .env file');
    process.exit(1);
}

const authHash = Buffer.from(`apikey:${API_KEY}`).toString('base64');

async function fetchRecentWorkPackages() {
    console.log(`Connecting to ${HOST} (Project ID: ${PROJECT_ID}) using Puppeteer Stealth...`);

    // Launch settings optimized for stealth
    const browser = await puppeteer.launch({
        headless: true, // Run in visible mode
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    });

    try {
        const page = await browser.newPage();

        // 1. Set a realistic Viewport
        await page.setViewport({ width: 1920, height: 1080 });

        // 2. Add extra headers
        // Important: Stealth plugin handles User-Agent, so we don't need to force it unless necessary.
        // We set Authorization here.
        await page.setExtraHTTPHeaders({
            'Authorization': `Basic ${authHash}`,
            // Accept JSON but also text/html to look more like a browser request
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
        });

        const url = `${HOST}/api/v3/projects/${PROJECT_ID}/work_packages?pageSize=5&sortBy=[["updated_at","desc"]]`;

        // 3. Navigate with a longer timeout and better wait condition
        const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Check if we got a valid JSON response text
        const responseBody = await response.text();

        try {
            // Check for HTML Challenge
            if (responseBody.trim().startsWith('<') && (responseBody.includes('Cloudflare') || responseBody.includes('Attention Required'))) {
                throw new Error('Cloudflare Challenge Detected');
            }

            const data = JSON.parse(responseBody);

            console.log('Successfully connected!');

            if (data._type === 'Error') {
                console.error('API Returned Error:', data.message || data.errorIdentifier);
            } else if (data._embedded && data._embedded.elements) {
                const workPackages = data._embedded.elements;
                if (workPackages.length === 0) {
                    console.log('No work packages found in this project.');
                } else {
                    console.log(`Found ${workPackages.length} recent work packages:`);
                    workPackages.forEach(wp => {
                        console.log(`- [ID: ${wp.id}] ${wp.subject} (Status: ${wp._links.status.title || 'Unknown'})`);
                    });
                }
            } else {
                console.log('Unexpected response structure:', JSON.stringify(data, null, 2));
            }

        } catch (e) {
            console.error('Failed to parse JSON response. Cloudflare might still be blocking or returning HTML.');
            if (e.message.includes('Cloudflare')) {
                console.error('Reason: Blocked by Cloudflare Challenge.');
            }
            // Print first 500 chars to debug
            console.log('Response preview:', responseBody.substring(0, 500));
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await browser.close();
    }
}

fetchRecentWorkPackages();
