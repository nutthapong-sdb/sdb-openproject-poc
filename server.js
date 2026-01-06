require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cookieParser());

// Intercept Login Page: Redirect if already logged in
app.get(['/login.html', '/login'], (req, res, next) => {
    // This relies on getSession being hoisted
    const session = getSession(req);
    if (session && session.isValid) {
        return res.redirect('/');
    }
    next();
});

// Protect Home Page: Redirect to Login if NOT logged in
app.get(['/', '/index.html'], (req, res, next) => {
    const session = getSession(req);
    if (!session || !session.isValid) {
        return res.redirect('/login.html');
    }
    next();
});

app.use(express.static('public'));

const HOST = 'https://openproject.softdebut.com';
const SERVER_API_KEY = process.env.OPENPROJECT_API_KEY; // Optional server-side fallback

// Global Auth Hash (Legacy/Server Fallback)
const authHash = SERVER_API_KEY ? Buffer.from(`apikey:${SERVER_API_KEY}`).toString('base64') : null;

// Helper to execute fetch inside Puppeteer
async function puppeteerFetch(url, options = {}, specificApiKey = null) {
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

    // Determine correctness of key (Priority: Specific > Global)
    const keyToUse = specificApiKey || SERVER_API_KEY;
    const authString = keyToUse ? Buffer.from(`apikey:${keyToUse}`).toString('base64') : null;

    try {
        const page = await browser.newPage();

        // Optimize viewport
        await page.setViewport({ width: 1920, height: 1080 });

        // We visit the actual page to set cookies
        try {
            // Using networkidle0 to ensure most things are loaded
            await page.goto(`${HOST}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        } catch (e) {
            console.log('Main page load warning:', e.message);
        }

        const result = await page.evaluate(async (endpoint, fetchOptions, auth) => {
            try {
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), 5000); // 5s timeout

                const headers = {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json',
                    ...fetchOptions.headers
                };

                const response = await fetch(endpoint, {
                    ...fetchOptions,
                    headers: headers,
                    signal: controller.signal
                });
                clearTimeout(id);

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
        }, url, options, authString);

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
    db.run("CREATE TABLE IF NOT EXISTS local_assignees (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, openproject_id TEXT)");
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

// Initial check
db.get("SELECT value FROM meta WHERE key = 'last_sync'", (err, row) => {
    if (err || !row) {
        console.log('No local cache found. Fetching initial data...');
        updateProjectsCache();
    } else {
        console.log(`Database loaded. Last sync: ${new Date(row.value).toLocaleString()}`);
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

// --- Auth Endpoints ---
app.post('/api/login', async (req, res) => {
    let { apikey } = req.body;

    if (!apikey) {
        return res.status(400).json({ error: 'API Key is required' });
    }

    apikey = apikey.trim();

    console.log(`Verifying API Key against ${HOST} (handling Cloudflare)...`);

    try {
        // Use puppeteerFetch to verify (Bypasses Cloudflare)
        const result = await puppeteerFetch(`${HOST}/api/v3/users/me`, {
            method: 'GET'
        }, apikey);

        if (result.status >= 200 && result.status < 300) {
            let user = result.data;
            if (typeof user === 'string') {
                try { user = JSON.parse(user); } catch (e) { }
            }

            console.log(`Login successful for: ${user.name}`);

            // Set HTTP-Only Cookie
            res.cookie('user_apikey', apikey, {
                httpOnly: true,
                secure: false, // Set to true if HTTPS is served
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });
            res.cookie('user_name', encodeURIComponent(user.name || user.firstName + ' ' + user.lastName || 'User'), {
                httpOnly: true,
                secure: false,
                maxAge: 30 * 24 * 60 * 60 * 1000
            });

            res.json({
                message: 'Login successful',
                user: { id: user.id || 0, name: user.name || 'User' }
            });
        } else {
            console.warn(`Login failed. Status: ${result.status}`);
            res.status(401).json({
                error: 'Login failed. Cloudflare or Invalid Key.',
                details: typeof result.data === 'string' ? result.data.substring(0, 150) : JSON.stringify(result.data)
            });
        }

    } catch (error) {
        console.error('Login System Error:', error);
        res.status(500).json({ error: 'Internal Server Error during login.' });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('sdb_session');
    res.clearCookie('user_apikey');
    res.clearCookie('user_name');
    res.json({ message: 'Logged out' });
});

app.get('/api/user', (req, res) => {
    const session = getSession(req);
    if (session && session.isValid) {
        return res.json(session.user || { name: 'User' });
    }
    res.status(401).json({ error: 'Not logged in' });
});

function getSession(req) {
    if (req.cookies.user_apikey) {
        const userName = req.cookies.user_name ? decodeURIComponent(req.cookies.user_name) : 'API User';
        return {
            isValid: true,
            type: 'apikey',
            cookies: { apikey: req.cookies.user_apikey },
            user: { name: userName }
        };
    }
    return null;
}

// --- Local Assignees API ---

// GET All Local Assignees
app.get('/api/assignees', (req, res) => {
    db.all("SELECT * FROM local_assignees ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Helper to search user in a specific project
async function findUserInProject(name, projectId) {
    try {
        console.log(`Searching for '${name}' in Project ${projectId}...`);
        const url = `${HOST}/api/v3/projects/${projectId}/available_assignees`;
        const result = await puppeteerFetch(url, { method: 'GET' });

        if (result.status >= 200 && result.status < 300 && result.data._embedded && result.data._embedded.elements) {
            const user = result.data._embedded.elements.find(el => el._type === 'User' && el.name.toLowerCase().includes(name.toLowerCase()));
            if (user) {
                return user.id.toString();
            }
        }
    } catch (e) {
        console.error(`Search failed for project ${projectId}:`, e.message);
    }
    return null;
}

// ADD Local Assignee
app.post('/api/assignees', async (req, res) => {
    const { name, projectId } = req.body;

    if (!name) return res.status(400).json({ error: 'Name is required' });

    let finalOpId = null;

    // Search Strategy:
    // 1. If project context provided, search there first.
    // 2. If not found or no context, search in default projects (Production: 614, MA: 615)
    // 3. This covers the "Global" search requirement without global permissions.

    const searchQueue = [];
    if (projectId) searchQueue.push(projectId);
    searchQueue.push('614'); // Default Production
    searchQueue.push('615'); // Default MA

    // Remove duplicates
    const uniqueQueue = [...new Set(searchQueue)];

    for (const pid of uniqueQueue) {
        finalOpId = await findUserInProject(name, pid);
        if (finalOpId) {
            console.log(`Found User '${name}' (ID: ${finalOpId}) in Project ${pid}`);
            break;
        }
    }

    if (!finalOpId) {
        return res.status(404).json({ error: `Could not find OpenProject user matching '${name}'. Please check the spelling.` });
    }

    db.get("SELECT * FROM local_assignees WHERE openproject_id = ?", [finalOpId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            return res.status(409).json({ error: `Duplicate: '${row.name}' already uses ID ${finalOpId}.` });
        }

        db.run("INSERT INTO local_assignees (name, openproject_id) VALUES (?, ?)", [name, finalOpId], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name: name, openproject_id: finalOpId });
        });
    });
});

// UPDATE Local Assignee
app.put('/api/assignees/:id', async (req, res) => {
    const { name, projectId } = req.body;
    const { id } = req.params;

    if (!name) return res.status(400).json({ error: 'Name is required' });

    let finalOpId = null;

    const searchQueue = [];
    if (projectId) searchQueue.push(projectId);
    searchQueue.push('614');
    searchQueue.push('615');

    const uniqueQueue = [...new Set(searchQueue)];

    for (const pid of uniqueQueue) {
        finalOpId = await findUserInProject(name, pid);
        if (finalOpId) {
            console.log(`Found User '${name}' (ID: ${finalOpId}) in Project ${pid}`);
            break;
        }
    }

    if (!finalOpId) {
        return res.status(404).json({ error: `Could not find OpenProject user matching '${name}'. Please check the spelling.` });
    }

    // Check for duplicate OpenProject ID (excluding current record)
    db.get("SELECT * FROM local_assignees WHERE openproject_id = ? AND id != ?", [finalOpId, id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            return res.status(409).json({ error: `Duplicate: '${row.name}' already uses ID ${finalOpId}.` });
        }

        db.run("UPDATE local_assignees SET name = ?, openproject_id = ? WHERE id = ?", [name, finalOpId, id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Updated successfully' });
        });
    });
});

// DELETE Local Assignee
app.delete('/api/assignees/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM local_assignees WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Deleted successfully' });
    });
});

// Return empty list for old dynamic endpoint (Frontend will be updated to use /api/assignees)
app.get('/api/projects/:id/assignees', (req, res) => {
    res.json([]);
});

// API to create Work Package
app.post('/api/work_packages', async (req, res) => {
    const { projectId, subject, assigneeId, startDate, dueDate, percentageDone, spentHours } = req.body;
    // Note: assigneeId here is the LOCAL database ID now, not the OpenProject ID directly.

    if (!projectId || !subject) {
        return res.status(400).json({ error: 'Missing projectId or subject' });
    }

    try {
        let openProjectAssigneeId = null;

        // Lookup OpenProject ID from Local DB if assigneeId is provided
        if (assigneeId) {
            const assignee = await new Promise((resolve, reject) => {
                db.get("SELECT openproject_id FROM local_assignees WHERE id = ?", [assigneeId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            if (assignee && assignee.openproject_id) {
                openProjectAssigneeId = assignee.openproject_id;
            }
        }

        console.log(`Creating Task '${subject}' in Project ${projectId} with Assignee OP-ID: ${openProjectAssigneeId}...`);
        const url = `${HOST}/api/v3/projects/${projectId}/work_packages`;

        const payload = {
            subject: subject,
            percentageDone: parseInt(percentageDone) || 0,
            startDate: startDate || null,
            dueDate: dueDate || null,
            "_links": {
                "type": {
                    "href": "/api/v3/types/1" // ID 1 is 'Task'
                }
            }
        };

        if (openProjectAssigneeId) {
            payload._links.assignee = {
                href: `/api/v3/users/${openProjectAssigneeId}`
            };
        }

        // Clean up nulls
        if (!payload.startDate) delete payload.startDate;
        if (!payload.dueDate) delete payload.dueDate;

        const result = await puppeteerFetch(url, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (result.status >= 200 && result.status < 300) {
            const newWorkPackageId = result.data.id;
            const webUrl = `${HOST}/work_packages/${newWorkPackageId}`;

            // --- Log Time Logic ---
            let timeLogged = false;
            let timeError = null;

            if (spentHours && parseFloat(spentHours) > 0) {
                console.log(`Logging ${spentHours} hours for WP #${newWorkPackageId}...`);
                const timeUrl = `${HOST}/api/v3/time_entries`;

                // Construct ISO duration (PT<N>H)
                // If float (e.g. 1.5), ISO duration supports PT1.5H or PT1H30M.
                // OpenProject usually supports PT1.5H.
                const isoDuration = `PT${spentHours}H`;
                const dateToLog = startDate || new Date().toISOString().split('T')[0];

                const timePayload = {
                    "_links": {
                        "workPackage": { "href": `/api/v3/work_packages/${newWorkPackageId}` },
                        "activity": { "href": "/api/v3/time_entries/activities/1" } // Corrected URI as per API error
                    },
                    "hours": isoDuration,
                    "spentOn": dateToLog,
                    "comment": { "raw": "Logged via Task Creator" }
                };

                const timeResult = await puppeteerFetch(timeUrl, {
                    method: 'POST',
                    body: JSON.stringify(timePayload)
                });

                if (timeResult.status >= 200 && timeResult.status < 300) {
                    timeLogged = true;
                    console.log('Time entry created successfully.');
                } else {
                    timeError = timeResult.data.message || 'Failed to create time entry'; // Try to extract error
                    // If activity ID 1 is invalid, it might fail.
                    console.error('Failed to log time:', timeResult.status, JSON.stringify(timeResult.data));
                }
            }
            // ---------------------

            res.json({
                ...result.data,
                webUrl,
                timeLogged,
                timeError: timeError ? `Note: Task created, but failed to log time (${timeError})` : null
            });
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
