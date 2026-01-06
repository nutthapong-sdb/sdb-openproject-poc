const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const DB_FILE = './projects.db';
const HOST = 'https://openproject.softdebut.com';
const API_KEY = process.env.Server_API || process.env.API_KEY || process.env.SERVER_API_KEY;
const PROJECT_ID = '614';

async function run() {
    console.log('Starting standalone sync...');
    const db = new sqlite3.Database(DB_FILE);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();

        console.log('Navigating to home...');
        await page.goto(HOST + '/login', { waitUntil: 'domcontentloaded' });

        const urlv3 = `${HOST}/api/v3/projects/${PROJECT_ID}/memberships`;
        console.log(`Fetching Members from ${urlv3}...`);

        const headerKey = API_KEY;
        if (!headerKey) console.warn("Warning: API Key not found. Fetch might fail.");

        const auth = Buffer.from(`apikey:${headerKey}`).toString('base64');

        const data = await page.evaluate(async (url, auth) => {
            const res = await fetch(url, { headers: { 'Authorization': `Basic ${auth}` } });
            if (!res.ok) return { error: res.status, text: await res.text() };
            return await res.json();
        }, urlv3, auth);

        if (data.error) {
            console.error('API Error:', data);
        } else if (data._embedded && data._embedded.elements) {
            console.log(`Found ${data._embedded.elements.length} memberships. Processing...`);

            const users = [];
            data._embedded.elements.forEach(el => {
                if (el._links && el._links.principal && el._links.principal.href) {
                    const href = el._links.principal.href;
                    if (href.startsWith('/api/v3/users/')) {
                        const id = href.split('/').pop();
                        const name = el._links.principal.title;
                        if (id && name) {
                            users.push({ id: id, name: name });
                        }
                    }
                }
            });

            console.log(`Found ${users.length} unique Users (from memberships).`);

            // Load existing IDs first
            const existingIds = new Set();
            await new Promise((resolve, reject) => {
                db.all("SELECT openproject_id FROM local_assignees", (err, rows) => {
                    if (err) reject(err);
                    else {
                        rows.forEach(r => existingIds.add(String(r.openproject_id)));
                        resolve();
                    }
                });
            });

            console.log(`Current DB has ${existingIds.size} users.`);

            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                const stmt = db.prepare("INSERT INTO local_assignees (name, openproject_id) VALUES (?, ?)");

                let newCount = 0;
                for (const user of users) {
                    if (!existingIds.has(String(user.id))) {
                        stmt.run(user.name, user.id);
                        newCount++;
                        existingIds.add(String(user.id));
                    }
                }

                stmt.finalize();
                db.run("COMMIT", () => {
                    console.log(`Added ${newCount} new users.`);
                });
            });

            await new Promise(r => setTimeout(r, 2000));
        } else {
            console.log('No embedded elements found.', data);
        }

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await browser.close();
        db.close();
    }
}

run();
