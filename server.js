require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const bcrypt = require('bcrypt');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3001;

app.use(bodyParser.json());
app.use(cookieParser());

// Helper to check session
function getSession(req) {
    const apiKey = req.cookies.user_apikey;
    // We can also check sdb_session or user_id
    if (apiKey) {
        return { isValid: true, apiKey };
    }
    return { isValid: false };
}

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
// Note: All API authentication now uses user's API key from login cookie

// Helper to execute fetch inside Puppeteer
async function puppeteerFetch(url, options = {}, specificApiKey = null, timeoutMs = 60000) {
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
    const keyToUse = specificApiKey; // Only use specific API key (from user's cookie)
    const authString = keyToUse ? Buffer.from(`apikey:${keyToUse}`).toString('base64') : null;
    let page;

    try {
        page = await browser.newPage();
        console.log('[puppeteerFetch] Browser launched, new page created');

        // Optimize viewport
        await page.setViewport({ width: 1920, height: 1080 });

        // Handle HTTP Basic Auth popup
        if (keyToUse) {
            await page.authenticate({
                username: 'apikey',
                password: keyToUse
            });
            console.log('[puppeteerFetch] Authentication set');
        }

        // We visit the actual page to set cookies
        try {
            console.log('[puppeteerFetch] Navigating to HOST...');
            // Reduced navigation timeout to 5s to speed up
            await page.goto(`${HOST}`, { waitUntil: 'domcontentloaded', timeout: 5000 });
            console.log('[puppeteerFetch] Navigation complete');
        } catch (e) {
            console.log('[puppeteerFetch] Main page load warning:', e.message);
        }

        console.log('[puppeteerFetch] Starting page.evaluate for:', url);
        const result = await page.evaluate(async (endpoint, fetchOptions, auth, timeoutMs) => {
            try {
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), timeoutMs); // Custom timeout

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
        }, url, options, authString, timeoutMs);

        if (result.status >= 400) {
            console.log('[puppeteerFetch] Error Data:', JSON.stringify(result.data).substring(0, 500));
        }
        console.log('[puppeteerFetch] Result status:', result.status, 'error:', result.error || 'none');
        return result;

    } catch (error) {
        console.error('Puppeteer Error:', error);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

// Reuseable Browser Session Helpers
async function createBrowserSession(apiKey) {
    console.log('[BrowserSession] Starting new session...');
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
        await page.setViewport({ width: 1920, height: 1080 });

        if (apiKey) {
            await page.authenticate({ username: 'apikey', password: apiKey });
        }

        // Initialize session
        await page.goto(`${HOST}`, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(e => console.log('Session init nav warning:', e.message));

        return { browser, page, apiKey };
    } catch (e) {
        await browser.close();
        throw e;
    }
}

async function fetchWithSession(session, url, options = {}, timeoutMs = 30000) {
    const { page, apiKey } = session;
    const authString = apiKey ? Buffer.from(`apikey:${apiKey}`).toString('base64') : null;

    return await page.evaluate(async (endpoint, fetchOptions, auth, timeoutMs) => {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeoutMs);

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
    }, url, options, authString, timeoutMs);
}

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Initialize SQLite Database
const dbFile = process.env.DB_FILE || './projects.db';
console.log(`Database file should be at: ${require('path').resolve(dbFile)}`);
const db = new sqlite3.Database(dbFile);

// Create table if not exists
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, project_id TEXT UNIQUE, name TEXT, updated_at DATETIME)");
    db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS local_assignees (id INTEGER PRIMARY KEY, name TEXT)");
    db.run(`CREATE TABLE IF NOT EXISTS task_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        openproject_id TEXT,
        subject TEXT,
        project_name TEXT,
        start_date TEXT,
        due_date TEXT,
        spent_hours TEXT,
        web_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run("CREATE TABLE IF NOT EXISTS user_project_mapping (user_id TEXT, project_id TEXT, PRIMARY KEY(user_id, project_id))");
    db.run("CREATE TABLE IF NOT EXISTS project_types (project_id TEXT, type_id TEXT, type_name TEXT, PRIMARY KEY(project_id, type_id))");
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
        projects.forEach(p => {
            stmt.run(p.id, p.name, now);
        });

        stmt.finalize();
        db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync', ?)", now);
        db.run("COMMIT");
    });
    console.log(`Synced ${projects.length} projects with database at ${new Date().toISOString()}`);
}

// Helper to Sync All Projects (Global) with Types using Session
async function syncAllProjects(apiKey) {
    if (!apiKey) return;

    console.log(`Syncing ALL projects and types (Persistent Session)...`);
    let session = null;

    try {
        session = await createBrowserSession(apiKey);

        // 1. Fetch Projects
        const result = await fetchWithSession(session, `${HOST}/api/v3/projects?pageSize=500`, { method: 'GET' });

        if (result.status === 200 && result.data && result.data._embedded && result.data._embedded.elements) {
            const projects = result.data._embedded.elements;
            console.log(`Found ${projects.length} projects. Syncing types...`);

            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                const now = new Date().toISOString();

                // Projects Upsert
                const upsertStmt = db.prepare(`
                    INSERT INTO projects (project_id, name, updated_at) 
                    VALUES (?, ?, ?)
                    ON CONFLICT(project_id) DO UPDATE SET
                    name = excluded.name,
                    updated_at = excluded.updated_at
                `);

                projects.forEach(p => {
                    upsertStmt.run(p.id.toString(), p.name, now);
                });
                upsertStmt.finalize();
                db.run("COMMIT");
            });

            // 2. Fetch Types for each project (Sequential loop with same session is fast)
            let typeCount = 0;

            for (const p of projects) {
                try {
                    const typeRes = await fetchWithSession(session, `${HOST}/api/v3/projects/${p.id}/types`, { method: 'GET' }, 5000);

                    if (typeRes.status === 200 && typeRes.data && typeRes.data._embedded && typeRes.data._embedded.elements) {
                        const types = typeRes.data._embedded.elements;

                        await new Promise((resolve) => {
                            db.serialize(() => {
                                db.run("BEGIN TRANSACTION");
                                const typeStmt = db.prepare("INSERT OR REPLACE INTO project_types (project_id, type_id, type_name) VALUES (?, ?, ?)");
                                types.forEach(t => {
                                    typeStmt.run(p.id.toString(), t.id.toString(), t.name);
                                    typeCount++;
                                });
                                typeStmt.finalize();
                                db.run("COMMIT", resolve);
                            });
                        });
                    }
                } catch (err) {
                    // console.error(`Failed to sync types for Project ${p.id}:`, err.message);
                }
            }

            console.log(`Synced Types: ${typeCount}`);
            return projects.length;
        }
        return 0;
    } catch (e) {
        console.error("Failed to sync projects:", e.message);
        throw e;
    } finally {
        if (session && session.browser) {
            console.log('[BrowserSession] Closing session...');
            await session.browser.close();
        }
    }
}

// GET Project Types
app.get('/api/projects/:id/types', (req, res) => {
    const projectId = req.params.id;
    db.all("SELECT type_id, type_name FROM project_types WHERE project_id = ? ORDER BY type_name", [projectId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});


// GET Projects: Read from DB (Filtered by User)
// GET Projects: Read ALL from DB
app.get('/api/projects', (req, res) => {
    const search = req.query.q || '';

    let query = `SELECT project_id as id, name FROM projects`;
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
    let { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and Password are required' });
    }

    // 1. Check Local DB
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, dbUser) => {
        if (err) {
            console.error('Login DB Error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        if (!dbUser) {
            // Use dummy comparison to prevent timing attacks? (Not critical for POC)
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Check Password (Bcrypt or Legacy Plaintext)
        let passwordMatch = false;
        let migrationNeeded = false;

        if (dbUser.password.startsWith('$2b$') || dbUser.password.startsWith('$2a$')) {
            // It's a hash
            passwordMatch = await bcrypt.compare(password, dbUser.password);
        } else {
            // It's likely plaintext (Legacy)
            if (dbUser.password === password) {
                passwordMatch = true;
                migrationNeeded = true;
            }
        }

        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Lazy Migration: Update to Hash
        if (migrationNeeded) {
            console.log(`Migrating password for user ${username} to hash...`);
            const newHash = await bcrypt.hash(password, 10);
            db.run("UPDATE users SET password = ? WHERE id = ?", [newHash, dbUser.id]);
        }

        const apikey = dbUser.api_key;
        console.log(`User '${username}' authenticated. Verifying Key...`);

        try {
            // 2. Refresh/Verify Session with OpenProject
            const result = await puppeteerFetch(`${HOST}/api/v3/users/me`, {
                method: 'GET'
            }, apikey);

            if (result.status >= 200 && result.status < 300) {
                let user = result.data;
                if (typeof user === 'string') {
                    try { user = JSON.parse(user); } catch (e) { }
                }

                console.log(`Login successful for: ${user.name} (ID: ${user.id})`);

                // Backfill openproject_id if missing or mismatch
                if (user.id) {
                    db.run("UPDATE users SET openproject_id = ? WHERE id = ?", [user.id.toString(), dbUser.id]);
                }

                // Set Cookies
                res.cookie('sdb_session', dbUser.id.toString(), {
                    httpOnly: true,
                    secure: false,
                    maxAge: 30 * 24 * 60 * 60 * 1000
                });
                res.cookie('user_apikey', apikey, {
                    httpOnly: true,
                    secure: false,
                    maxAge: 30 * 24 * 60 * 60 * 1000
                });
                res.cookie('user_id', user.id || '0', {
                    httpOnly: true,
                    secure: false,
                    maxAge: 30 * 24 * 60 * 60 * 1000
                });
                res.cookie('user_name', encodeURIComponent(dbUser.name), { // Use Local Name
                    httpOnly: true,
                    secure: false,
                    maxAge: 30 * 24 * 60 * 60 * 1000
                });

                // await syncAllProjects(apikey); // Disabled

                res.json({
                    message: 'Login successful',
                    user: { id: user.id || 0, name: dbUser.name }
                });
            } else {
                console.warn(`Login failed. OpenProject rejected key. Status: ${result.status}`);
                res.status(401).json({
                    error: 'Your OpenProject API Key may have expired or is invalid. Please contact admin or re-register.',
                    details: JSON.stringify(result.data).substring(0, 150)
                });
            }

        } catch (error) {
            console.error('Login System Error:', error);
            res.status(500).json({ error: 'Internal Server Error during login.' });
        }
    });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('sdb_session');
    res.clearCookie('user_apikey');
    res.clearCookie('user_name');
    res.json({ message: 'Logged out' });
});

app.get('/api/user', async (req, res) => {
    const session = getSession(req);
    if (session && session.isValid) {
        // Query Role from DB
        const localId = req.cookies.sdb_session;

        // Default response
        const userResp = session.user || { name: 'User' };

        if (localId) {
            db.get("SELECT role FROM users WHERE id = ?", [localId], (err, row) => {
                userResp.role = (row && row.role) ? row.role : 'user';
                res.json(userResp);
            });
        } else {
            userResp.role = 'user';
            res.json(userResp);
        }
    } else {
        res.status(401).json({ error: 'Not logged in' });
    }
});

function getSession(req) {
    if (req.cookies.user_apikey) {
        const userName = req.cookies.user_name ? decodeURIComponent(req.cookies.user_name) : 'API User';
        const userId = req.cookies.user_id || null;
        return {
            isValid: true,
            type: 'apikey',
            cookies: { apikey: req.cookies.user_apikey },
            user: { id: userId, name: userName }
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
        const url = `${HOST} /api/v3 / projects / ${projectId}/available_assignees`;
        const result = await puppeteerFetch(url, { method: 'GET' }, null, 3000); // 3s Timeout

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
    const { name, projectId, openProjectId } = req.body;

    if (!name) return res.status(400).json({ error: 'Name is required' });

    let finalOpId = openProjectId || null;

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

    if (!finalOpId) {
        for (const pid of uniqueQueue) {
            finalOpId = await findUserInProject(name, pid);
            if (finalOpId) {
                console.log(`Found User '${name}' (ID: ${finalOpId}) in Project ${pid}`);
                break;
            }
        }
    }

    if (!finalOpId) {
        return res.status(404).json({ error: `Could not find OpenProject user matching '${name}'. Please check the spelling.` });
    }

    db.get("SELECT * FROM local_assignees WHERE id = ?", [finalOpId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            // Found existing, return it (Find or Create logic)
            return res.json(row);
        }

        db.run("INSERT INTO local_assignees (id, name) VALUES (?, ?)", [finalOpId, name], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: finalOpId, name: name });
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

// --- Task History API ---
// GET History for current user
// GET History for current user (with Pagination)
app.get('/api/history', (req, res) => {
    const userId = req.cookies.user_id;
    if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const offset = (page - 1) * limit;

    // 1. Get Total Count
    db.get("SELECT COUNT(*) as count FROM task_history WHERE user_id = ?", [userId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        const totalItems = row.count;
        const totalPages = Math.ceil(totalItems / limit);

        // 2. Get Data for current page
        db.all(
            "SELECT * FROM task_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            [userId, limit, offset],
            (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });

                res.json({
                    data: rows || [],
                    pagination: {
                        current: page,
                        limit: limit,
                        totalItems: totalItems,
                        totalPages: totalPages
                    }
                });
            }
        );
    });
});

// POST Add to History
app.post('/api/history', (req, res) => {
    const userId = req.cookies.user_id;
    if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const { openprojectId, subject, projectName, startDate, dueDate, spentHours, webUrl } = req.body;

    db.run(
        `INSERT INTO task_history (user_id, openproject_id, subject, project_name, start_date, due_date, spent_hours, web_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, openprojectId, subject, projectName, startDate, dueDate, spentHours, webUrl],
        function (err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ id: this.lastID, message: 'Added to history' });
        }
    );
});

// DELETE from History (local DB only)
app.delete('/api/history/:id', (req, res) => {
    const userId = req.cookies.user_id;
    if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    console.log(`Deleting from local history: ID=${id}, UserID=${userId}`);

    db.run(
        "DELETE FROM task_history WHERE id = ? AND user_id = ?",
        [id, userId],
        function (err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'History item not found' });
            }
            res.json({ message: 'Deleted from history' });
        }
    );
});

// API to create Work Package
app.post('/api/work_packages', async (req, res) => {
    const { projectId, subject, description, assigneeId, typeId, startDate, dueDate, percentageDone, spentHours } = req.body;
    const userApiKey = req.cookies.user_apikey; // Get user's API key from login session

    if (!userApiKey) {
        return res.status(401).json({ error: 'Not authenticated. Please login.' });
    }

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
            subject: subject.trim(),
            description: { raw: description ? description.trim() : "" }, // Add Description
            percentageDone: parseInt(percentageDone) || 0,
            startDate: startDate || null,
            dueDate: dueDate || null,
            "_links": {
                "type": {
                    "href": `/api/v3/types/${typeId || 1}` // Use provided Type ID or default to 1 (Task)
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
        }, userApiKey);

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
                }, userApiKey);

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

// DELETE Work Package from OpenProject
app.delete('/api/work_packages/:id', async (req, res) => {
    const { id } = req.params;
    const userApiKey = req.cookies.user_apikey;

    if (!userApiKey) {
        return res.status(401).json({ error: 'Not authenticated. Please login.' });
    }

    if (!id) {
        return res.status(400).json({ error: 'Missing work package ID' });
    }

    try {
        console.log(`Deleting Work Package #${id}...`);
        const url = `${HOST}/api/v3/work_packages/${id}`;

        const result = await puppeteerFetch(url, {
            method: 'DELETE'
        }, userApiKey);

        if (result.status >= 200 && result.status < 300) {
            console.log(`Work Package #${id} deleted successfully.`);
            res.json({ success: true, message: `Work Package #${id} deleted.` });
        } else if (result.status === 404) {
            console.log(`Work Package #${id} not found in OpenProject. Treating as success.`);
            res.json({ success: true, message: `Work Package #${id} was already deleted or not found.` });
        } else {
            console.error('Failed to delete:', result.status, result.data);
            res.status(result.status).json({ error: result.data?.message || 'Failed to delete work package' });
        }
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API to sync users (POST) - Persistent Session
app.post('/api/sync-users', async (req, res) => {
    const apiKey = req.cookies.user_apikey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });

    console.log('Syncing users (Persistent Session)...');
    let session = null;

    try {
        session = await createBrowserSession(apiKey);
        const projectIds = [614, 615];
        let allUsers = [];

        for (const pid of projectIds) {
            console.log(`Fetching available assignees for project ${pid}...`);
            const response = await fetchWithSession(session, `${HOST}/api/v3/projects/${pid}/available_assignees`, { method: 'GET' });
            if (response.status === 200 && response.data && response.data._embedded && response.data._embedded.elements) {
                allUsers = allUsers.concat(response.data._embedded.elements);
            }
        }

        if (allUsers.length === 0) return res.status(404).json({ error: 'No assignees found.' });

        const uniqueUsers = Array.from(new Map(allUsers.map(u => [u.id, u])).values());
        console.log(`Total unique assignees found: ${uniqueUsers.length}`);

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            // Use UPSERT
            // id column is now the OpenProject ID (Primary Key)
            const stmt = db.prepare("INSERT INTO local_assignees (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name");
            uniqueUsers.forEach(u => stmt.run(u.id, u.name));
            stmt.finalize();
            db.run("COMMIT");
        });

        res.json({ message: 'Users synced successfully', count: uniqueUsers.length });

    } catch (error) {
        console.error('Sync users error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (session && session.browser) await session.browser.close();
    }
});

// Sync Projects Endpoint (Manual Trigger)
app.post('/api/sync-projects', async (req, res) => {
    const userApiKey = req.cookies.user_apikey;
    if (!userApiKey) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const count = await syncAllProjects(userApiKey);
        res.json({ message: 'Project synchronization started.', count: count || 0 });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// GET User Stats for Dashboard
app.get('/api/users-stats', (req, res) => {
    const query = `
        SELECT 
            COALESCE(u.name, a.name) as name, 
            COUNT(h.id) as task_count
        FROM local_assignees a 
        LEFT JOIN task_history h ON a.id = h.user_id 
        LEFT JOIN users u ON u.openproject_id = a.id
        GROUP BY a.id 
        ORDER BY task_count DESC, a.name ASC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- User Management & Registration ---

// Init Users Table
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            api_key TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            openproject_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

    db.all("PRAGMA table_info(users)", (err, columns) => {
        if (!err && columns) {
            const hasRole = columns.some(c => c.name === 'role');
            if (!hasRole) {
                console.log("Migrating: Adding 'role' column...");
                db.run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
            }
            const hasOpId = columns.some(c => c.name === 'openproject_id');
            if (!hasOpId) {
                console.log("Migrating: Adding 'openproject_id' column...");
                db.run("ALTER TABLE users ADD COLUMN openproject_id TEXT");
            }
        }
    });
});

app.post('/api/register', async (req, res) => {
    const { name, username, password, apikey } = req.body;
    if (!name || !username || !password || !apikey) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    db.get('SELECT id FROM users WHERE username = ?', [username], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(400).json({ error: 'Username already taken.' });

        try {
            const result = await puppeteerFetch(`${HOST}/api/v3/users/me`, { method: 'GET' }, apikey);

            if (result.status >= 200 && result.status < 300) {
                const opUser = result.data;
                const hashedPassword = await bcrypt.hash(password, 10);
                const opId = opUser.id.toString();

                db.run(
                    'INSERT INTO users (username, password, name, api_key, role, openproject_id) VALUES (?, ?, ?, ?, ?, ?)',
                    [username, hashedPassword, name, apikey, 'user', opId],
                    function (err) {
                        if (err) return res.status(500).json({ error: 'Database error: ' + err.message });

                        const newUserId = this.lastID;
                        res.cookie('sdb_session', newUserId.toString(), { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
                        res.cookie('user_apikey', apikey, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
                        res.cookie('user_id', opUser.id || '0', { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
                        res.cookie('user_name', encodeURIComponent(name), { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });

                        res.json({
                            message: 'Registration successful',
                            user: { id: opUser.id, name: name }
                        });
                    }
                );
            } else {
                res.status(401).json({ error: 'Invalid API Key.' });
            }
        } catch (e) {
            console.error('Registration Error:', e);
            res.status(500).json({ error: 'Server error during verification.' });
        }
    });
});

// --- Admin Endpoints ---

// Get All Users (All logged-in users can access)
app.get('/api/admin/users', (req, res) => {
    const localUserId = req.cookies.sdb_session;
    if (!localUserId) return res.status(401).json({ error: "Unauthorized" });

    // Allow all logged-in users to view user list
    db.all("SELECT id, username, name, role, openproject_id, created_at FROM users ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Reset User Password (All logged-in users can access)
app.post('/api/admin/users/:id/reset-password', async (req, res) => {
    const targetId = req.params.id;
    const { newPassword } = req.body;
    const localUserId = req.cookies.sdb_session;

    if (!localUserId) return res.status(401).json({ error: "Unauthorized" });
    if (!newPassword) return res.status(400).json({ error: "New password is required" });

    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        db.run("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, targetId], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Password updated successfully" });
        });
    } catch (e) {
        res.status(500).json({ error: "Error hashing password" });
    }
});

// Update User Info (All logged-in users can access)
app.put('/api/admin/users/:id', (req, res) => {
    const targetId = req.params.id;
    const { username, name } = req.body;
    const localUserId = req.cookies.sdb_session;

    if (!localUserId) return res.status(401).json({ error: "Unauthorized" });
    if (!username && !name) return res.status(400).json({ error: "Username or name is required" });

    // Build dynamic update query
    let updates = [];
    let params = [];

    if (username) {
        updates.push("username = ?");
        params.push(username);
    }
    if (name) {
        updates.push("name = ?");
        params.push(name);
    }

    params.push(targetId);
    const query = `UPDATE users SET ${updates.join(", ")} WHERE id = ?`;

    db.run(query, params, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "User updated successfully" });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    const dbPath = require('path').resolve(dbFile || 'projects.db'); // Safe reference
    console.log(`Database file should be at: ${dbPath}`);
});
