require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

const HOST = process.env.OPENPROJECT_HOST;
const API_KEY = process.env.OPENPROJECT_API_KEY;
// PROJECT_ID is now dynamic, but we can keep a default if needed

if (!HOST || !API_KEY) {
    console.error('Error: Please set OPENPROJECT_HOST and OPENPROJECT_API_KEY in .env file');
    process.exit(1);
}

const authHash = Buffer.from(`apikey:${API_KEY}`).toString('base64');

// Helper to execute fetch inside Puppeteer
async function puppeteerFetch(url, options = {}) {
    const browser = await puppeteer.launch({
        headless: 'new',
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

        // Optimize viewport
        await page.setViewport({ width: 1920, height: 1080 });

        // We visit the actual page to set cookies
        try {
            // Using networkidle0 to ensure most things are loaded
            await page.goto(`${HOST}`, { waitUntil: 'load', timeout: 60000 });
        } catch (e) {
            console.log('Main page load warning:', e.message);
        }

        const result = await page.evaluate(async (endpoint, fetchOptions, auth) => {
            try {
                const headers = {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json',
                    ...fetchOptions.headers
                };

                const response = await fetch(endpoint, {
                    ...fetchOptions,
                    headers: headers
                });

                const text = await response.text();
                try {
                    return {
                        status: response.status,
                        data: JSON.parse(text)
                    };
                } catch {
                    return {
                        status: response.status,
                        data: text,
                        error: 'Failed to parse JSON response form API'
                    };
                }
            } catch (err) {
                return { status: 500, error: err.toString() };
            }
        }, url, options, authHash);

        return result;

    } catch (error) {
        console.error('Puppeteer Error:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Initialize SQLite Database
const dbFile = './projects.db';
const db = new sqlite3.Database(dbFile);

// Create table if not exists
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, project_id TEXT UNIQUE, name TEXT, updated_at DATETIME)");
    db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
});

// Helper to save projects to DB (Upsert Logic)
function saveProjectsToDB(projects) {
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        const stmt = db.prepare(`
            INSERT INTO projects (project_id, name, updated_at) 
            VALUES (?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
            name = excluded.name,
            updated_at = excluded.updated_at
        `);

        const now = new Date().toISOString();
        let newCount = 0;

        projects.forEach(p => {
            stmt.run(p.id, p.name, now);
        });

        stmt.finalize();

        // Update last sync time
        db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync', ?)", now);
        db.run("COMMIT");
    });
    console.log(`Synced ${projects.length} projects with database at ${new Date().toISOString()}`);
}

// Function to fetch from Puppeteer and Update DB
async function updateProjectsCache() {
    console.log('Starting scheduled project update...');
    try {
        const url = `${HOST}/api/v3/projects`;
        const result = await puppeteerFetch(url, { method: 'GET' });

        if (result.status >= 200 && result.status < 300) {
            let projects = [];
            if (Array.isArray(result.data)) {
                projects = result.data;
            } else if (result.data._embedded && result.data._embedded.elements) {
                projects = result.data._embedded.elements;
            }

            if (projects.length > 0) {
                saveProjectsToDB(projects);
            }
        } else {
            console.error('Failed to fetch projects for cache update:', result.status);
        }
    } catch (error) {
        console.error('Error during cache update:', error.message);
    }
}

// Schedule Update: Every 6 hours (6 * 60 * 60 * 1000 ms)
const UPDATE_INTERVAL = 6 * 60 * 60 * 1000;
setInterval(updateProjectsCache, UPDATE_INTERVAL);

// Initial check: Always try to sync on startup for freshness, regardless of expiry, 
// OR just rely on the interval. User wanted "check new projects", which implies fetching.
// Let's keep the initial fetch to ensure we have data if DB is missing.
db.get("SELECT value FROM meta WHERE key = 'last_sync'", (err, row) => {
    if (err || !row) {
        console.log('No local cache found. Fetching initial data...');
        updateProjectsCache();
    } else {
        console.log(`Database loaded. Last sync: ${new Date(row.value).toLocaleString()}`);
        // We can run an update in background if we want strictly "every 6 hours" from now
        // or immediately if we want to ensure up-to-date on restart.
        // Given user request "check for new data", running it now is safer.
        updateProjectsCache();
    }
});

// GET Projects: Read from DB
app.get('/api/projects', (req, res) => {
    const search = req.query.q || '';
    let query = "SELECT project_id as id, name FROM projects";
    let params = [];

    if (search) {
        query += " WHERE name LIKE ?";
        params.push(`%${search}%`);
    }

    query += " ORDER BY name ASC";

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// API to create Work Package (Direct Puppeteer - No Caching needed for write)
app.post('/api/work_packages', async (req, res) => {
    const { projectId, subject } = req.body;

    if (!projectId || !subject) {
        return res.status(400).json({ error: 'Missing projectId or subject' });
    }

    try {
        console.log(`Creating Task '${subject}' in Project ${projectId}...`);
        const url = `${HOST}/api/v3/projects/${projectId}/work_packages`;

        const payload = {
            subject: subject
        };

        const result = await puppeteerFetch(url, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (result.status >= 200 && result.status < 300) {
            // Construct the web URL for the user to click
            // OpenProject Web URL is usually HOST/work_packages/ID
            const webUrl = `${HOST}/work_packages/${result.data.id}`;
            res.json({ ...result.data, webUrl });
        } else {
            res.status(result.status).json(result.data);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Database file should be at: ${require('path').resolve(dbFile)}`);
});
