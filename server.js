const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const db = require('sqlite3').verbose();

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));

const HOST = 'https://openproject.softdebut.com';

// Database Setup
const DB_SOURCE = "projects.db";
const dbSqlite = new db.Database(DB_SOURCE, (err) => {
    if (err) {
        console.error(err.message);
        throw err;
    } else {
        console.log('Database connected.');
        dbSqlite.run(`CREATE TABLE IF NOT EXISTS local_assignees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            openproject_id TEXT UNIQUE
        )`);

        dbSqlite.run(`CREATE TABLE IF NOT EXISTS project_cache (
            id TEXT PRIMARY KEY,
            name TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    }
});

// Helper to execute fetch inside Puppeteer with Cookies
// Helper to execute fetch inside Puppeteer with Cookies
async function puppeteerFetch(url, options = {}, sessionData = null) {
    // Auth Check for mutations
    if (options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE') {
        if (!sessionData) {
            return { status: 401, data: { error: 'Unauthorized. Please login first.' } };
        }
    }

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

        if (sessionData && sessionData.cookies && sessionData.cookies.length > 0) {
            await page.setCookie(...sessionData.cookies);
        }

        try {
            // Visit base to set cookie context
            await page.goto(`${HOST}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
            console.warn('Navigation warning:', e.message);
        }

        const result = await page.evaluate(async (endpoint, opts, csrf) => {
            try {
                const headers = {
                    'Content-Type': 'application/json',
                    ...opts.headers
                };

                if (csrf && (opts.method === 'POST' || opts.method === 'PUT' || opts.method === 'DELETE')) {
                    headers['X-CSRF-Token'] = csrf;
                }

                const fetchOptions = {
                    method: opts.method || 'GET',
                    headers: headers
                };

                if (opts.body) {
                    fetchOptions.body = opts.body;
                }

                const response = await fetch(endpoint, fetchOptions);

                let data;
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.indexOf("application/json") !== -1) {
                    data = await response.json();
                } else {
                    data = await response.text();
                }

                return {
                    status: response.status,
                    data: data
                };
            } catch (err) {
                return { status: 500, data: { error: err.toString() } };
            }
        }, url, options, sessionData ? sessionData.csrfToken : null);

        return result;

    } catch (error) {
        console.error('Puppeteer Error:', error);
        return { status: 500, data: { error: error.message } };
    } finally {
        await browser.close();
    }
}

// --- Auth Endpoints ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    console.log(`Attempting login for user: ${username}...`);

    const browser = await puppeteer.launch({
        headless: 'new', // Back to invisible mode
        defaultViewport: null,
        args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();

        // Anti-detection measures
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        });

        // Hide webdriver property explicitly
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });
        });

        await page.goto(`${HOST}/login`, { waitUntil: 'networkidle0' });

        // Wait for login form
        try {
            await page.waitForSelector('input[name="username"], input[name="login"]', { timeout: 10000 });
            console.log('Login form found, pausing for 5 seconds for visual inspection...');
            await new Promise(r => setTimeout(r, 5000)); // Pause for user
        } catch (e) {
            // Debug: Log content if frame
            // const content = await page.content();
            // console.log(content);
            throw new Error('Login form not found (username input missing)');
        }

        // Detect Username Selector
        const usernameSelector = await page.evaluate(() => {
            return document.querySelector('input[name="username"]') ? 'input[name="username"]' : 'input[name="login"]';
        });

        console.log(`Using username selector: ${usernameSelector}`);

        // DIRECTLY SET VALUES VIA DOM (Reliable)
        await page.evaluate((uSelector, uValue, pValue) => {
            // Helper to set value and trigger events
            const setVal = (sel, val) => {
                const el = document.querySelector(sel);
                if (el) {
                    el.value = val;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            };

            setVal(uSelector, uValue);
            setVal('input[name="password"]', pValue);
        }, usernameSelector, username.trim(), password.trim());

        // Wait a moment for events to propagate
        await new Promise(r => setTimeout(r, 500));

        // DEBUG: Check what is in the DOM
        const formValues = await page.evaluate(() => {
            return {
                user: document.querySelector('input[name="username"], input[name="login"]')?.value,
                passLength: document.querySelector('input[name="password"]')?.value?.length
            };
        });
        console.log(`DEBUG Check: User='${formValues.user}', PassLength=${formValues.passLength}`);

        // Submit Login Form
        const submitSelector = 'button[type="submit"], input[type="submit"]';
        const submitBtn = await page.$(submitSelector);

        if (submitBtn) {
            console.log('Clicking submit button via JS...');
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(e => console.log('Navigation timeout/skip', e.message)),
                page.evaluate((btn) => btn.click(), submitBtn)
            ]);
        } else {
            console.log('No submit button found, pressing Enter...');
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(e => console.log('Navigation timeout/skip', e.message)),
                page.keyboard.press('Enter')
            ]);
        }

        // Wait for page to settle after login submit
        try {
            console.log('Waiting for login success indicators...');
            await page.waitForFunction(() => {
                // Check for Meta Tag OR Avatar OR simply successfully navigating away from /login
                return document.querySelector('meta[name="current-user"]') ||
                    document.querySelector('.avatar') ||
                    document.querySelector('#user-menu') ||
                    (!window.location.href.includes('/login') && document.readyState === 'complete');
            }, { timeout: 10000 });
        } catch (e) {
            console.log('Wait for login verification timed out (but might still be logged in)');
        }

        // Verify Login
        // Verify Login
        const isLoggedIn = await page.evaluate(() => {
            // Check 1: Meta Tag (Hidden ID embedded by OpenProject when logged in)
            const metaUser = document.querySelector('meta[name="current-user"]');

            // Check 2: UI Elements (Avatar OR User Menu) - Works even if user has default avatar
            const avatar = document.querySelector('.avatar') || document.querySelector('img[class*="avatar"]');
            const userMenu = document.querySelector('#user-menu');

            // Check 3: Address Bar (If we are NOT on /login anymore, we likely succeeded)
            const notLoginUrl = !window.location.href.includes('/login');

            // RESULT: Use OR (||) operator. 
            // If ANY ONE of these is true, we consider the login successful.
            return !!(metaUser || avatar || userMenu || notLoginUrl);
        });

        if (!isLoggedIn) {
            // CAPTURE DEBUG ARTIFACTS
            const timestamp = Date.now();
            const debugFilename = `debug_login_fail_${timestamp}.png`;
            await page.screenshot({ path: `public/${debugFilename}`, fullPage: true });

            const errorDetails = await page.evaluate(() => {
                const alert = document.querySelector('.flash.error') ||
                    document.querySelector('.notification-box.-error') ||
                    document.querySelector('.alert-error') ||
                    document.querySelector('[class*="error"]');

                if (alert) return `Alert found: ${alert.innerText.trim()}`;

                // If no specific alert, return page title and body snippet
                return `No alert found. Title: ${document.title}. Body: ${document.body.innerText.substring(0, 300).replace(/\s+/g, ' ')}`;
            });

            console.log(`Login Failed. Screenshot saved: public/${debugFilename}`);
            // await browser.close(); // Keep open on failure too

            return res.status(401).json({
                error: `Login Verification Failed. Details: ${errorDetails}`,
                debugSnapshot: `/${debugFilename}`
            });
        }

        const cookies = await page.cookies();

        const csrfToken = await page.evaluate(() => {
            const meta = document.querySelector('meta[name="csrf-token"]');
            return meta ? meta.content : null;
        });

        const sessionData = {
            isValid: true,
            cookies: cookies,
            csrfToken: csrfToken,
            lastUpdated: new Date()
        };

        // Fetch user details manually using the new session
        const userUrl = `${HOST}/api/v3/users/me`;
        const userData = await page.evaluate(async (url) => {
            const r = await fetch(url);
            return r.json();
        }, userUrl);

        if (userData && userData.id) {
            sessionData.user = {
                id: userData.id,
                name: userData.name,
                avatar: userData.avatarUrl
            };
        } else {
            sessionData.user = { name: username, id: 'unknown' };
        }

        // Set Cookie (Max 1 day)
        res.cookie('sdb_session', JSON.stringify(sessionData), {
            httpOnly: true,
            secure: false,
            maxAge: 24 * 60 * 60 * 1000
        });

        console.log(`Login Successful for ${sessionData.user.name}`);
        res.json({ message: 'Login successful', user: sessionData.user });

    } catch (e) {
        console.error('Login Error:', e);
        res.status(500).json({ error: `Login failed: ${e.message}` });
    } finally {
        if (browser) await browser.close();
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('sdb_session');
    res.json({ message: 'Logged out' });
});

app.get('/api/user', (req, res) => {
    const sessionCookie = req.cookies.sdb_session;
    try {
        const session = JSON.parse(sessionCookie);
        if (session && session.isValid) {
            return res.json(session.user);
        }
    } catch (e) { }
    res.status(401).json({ error: 'Not logged in' });
});

// Helper to get session from request
function getSession(req) {
    try {
        const s = JSON.parse(req.cookies.sdb_session);
        if (s && s.isValid) return s;
    } catch (e) { }
    return null;
}

// GET All Projects
app.get('/api/projects', async (req, res) => {
    console.log('Fetching projects...');
    dbSqlite.all("SELECT * FROM project_cache ORDER BY name ASC", [], async (err, rows) => {
        if (!err && rows.length > 0) {
            console.log(`Serving ${rows.length} projects from cache.`);
            return res.json(rows);
        }

        const session = getSession(req);

        if (!session) {
            return res.status(401).json({ error: 'Please login to fetch projects' });
        }

        const url = `${HOST}/api/v3/projects`;
        const result = await puppeteerFetch(url, { method: 'GET' }, session);

        if (result.status === 200 && result.data._embedded) {
            const projects = result.data._embedded.elements.map(p => ({
                id: p.id.toString(),
                name: p.name
            }));

            const stmt = dbSqlite.prepare("INSERT OR REPLACE INTO project_cache (id, name) VALUES (?, ?)");
            projects.forEach(p => stmt.run(p.id, p.name));
            stmt.finalize();

            res.json(projects);
        } else {
            res.status(result.status).json(result.data);
        }
    });
});

// GET All Local Assignees
app.get('/api/assignees', (req, res) => {
    dbSqlite.all("SELECT * FROM local_assignees ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

async function findUserInProject(name, projectId, sessionData) {
    if (!sessionData) return null;

    try {
        console.log(`Searching for '${name}' in Project ${projectId}...`);
        const url = `${HOST}/api/v3/projects/${projectId}/available_assignees`;
        const result = await puppeteerFetch(url, { method: 'GET' }, sessionData);

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

app.post('/api/assignees', async (req, res) => {
    const { name, projectId } = req.body;
    const session = getSession(req);

    if (!name) return res.status(400).json({ error: 'Name is required' });

    let finalOpId = null;

    if (session) {
        const searchQueue = [];
        if (projectId) searchQueue.push(projectId);
        searchQueue.push('614');
        searchQueue.push('615');

        const uniqueQueue = [...new Set(searchQueue)];

        for (const pid of uniqueQueue) {
            finalOpId = await findUserInProject(name, pid, session);
            if (finalOpId) {
                console.log(`Found User '${name}' (ID: ${finalOpId}) in Project ${pid}`);
                break;
            }
        }
    } else {
        console.warn('Skipping auto-search: Not logged in.');
    }

    if (!finalOpId && session) {
        return res.status(404).json({ error: `Could not find OpenProject user matching '${name}'. Please check the spelling.` });
    } else if (!finalOpId) {
        return res.status(401).json({ error: `Please login to verify assignee.` });
    }

    dbSqlite.get("SELECT * FROM local_assignees WHERE openproject_id = ?", [finalOpId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            return res.status(409).json({ error: `Duplicate: '${row.name}' already uses ID ${finalOpId}.` });
        }

        dbSqlite.run("INSERT INTO local_assignees (name, openproject_id) VALUES (?, ?)", [name, finalOpId], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name: name, openproject_id: finalOpId });
        });
    });
});

app.put('/api/assignees/:id', async (req, res) => {
    const { name, projectId } = req.body;
    const { id } = req.params;
    const session = getSession(req);

    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!session) return res.status(401).json({ error: 'Please login first.' });

    let finalOpId = null;

    const searchQueue = [];
    if (projectId) searchQueue.push(projectId);
    searchQueue.push('614');
    searchQueue.push('615');

    const uniqueQueue = [...new Set(searchQueue)];

    for (const pid of uniqueQueue) {
        finalOpId = await findUserInProject(name, pid, session);
        if (finalOpId) {
            console.log(`Found User '${name}' (ID: ${finalOpId}) in Project ${pid}`);
            break;
        }
    }

    if (!finalOpId) {
        return res.status(404).json({ error: `Could not find OpenProject user matching '${name}'. Please check the spelling.` });
    }

    dbSqlite.get("SELECT * FROM local_assignees WHERE openproject_id = ? AND id != ?", [finalOpId, id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            return res.status(409).json({ error: `Duplicate: '${row.name}' already uses ID ${finalOpId}.` });
        }

        dbSqlite.run("UPDATE local_assignees SET name = ?, openproject_id = ? WHERE id = ?", [name, finalOpId, id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Updated successfully' });
        });
    });
});

app.delete('/api/assignees/:id', (req, res) => {
    const { id } = req.params;
    dbSqlite.run("DELETE FROM local_assignees WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Deleted successfully' });
    });
});

app.post('/api/work_packages', async (req, res) => {
    const { projectId, subject, assigneeId, startDate, dueDate, percentageDone, spentHours } = req.body;
    const session = getSession(req);

    if (!session) return res.status(401).json({ error: 'Please login first.' });

    if (!projectId || !subject) {
        return res.status(400).json({ error: 'Missing projectId or subject' });
    }

    try {
        let openProjectAssigneeId = null;

        if (assigneeId) {
            const assignee = await new Promise((resolve, reject) => {
                dbSqlite.get("SELECT openproject_id FROM local_assignees WHERE id = ?", [assigneeId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            if (assignee && assignee.openproject_id) {
                openProjectAssigneeId = assignee.openproject_id;
            }
        }

        console.log(`Creating Task '${subject}' in Project ${projectId}...`);
        const url = `${HOST}/api/v3/projects/${projectId}/work_packages`;

        const payload = {
            subject: subject,
            percentageDone: parseInt(percentageDone) || 0,
            startDate: startDate || null,
            dueDate: dueDate || null,
            "_links": {
                "type": {
                    "href": "/api/v3/types/1"
                }
            }
        };

        if (openProjectAssigneeId) {
            payload._links.assignee = {
                href: `/api/v3/users/${openProjectAssigneeId}`
            };
        }

        if (!payload.startDate) delete payload.startDate;
        if (!payload.dueDate) delete payload.dueDate;

        const result = await puppeteerFetch(url, {
            method: 'POST',
            body: JSON.stringify(payload)
        }, session);

        if (result.status >= 200 && result.status < 300) {
            const newWorkPackageId = result.data.id;
            const webUrl = `${HOST}/work_packages/${newWorkPackageId}`;

            let timeLogged = false;
            let timeError = null;

            if (spentHours && parseFloat(spentHours) > 0) {
                console.log(`Logging ${spentHours} hours for WP #${newWorkPackageId}...`);
                const timeUrl = `${HOST}/api/v3/time_entries`;

                const isoDuration = `PT${spentHours}H`;
                const dateToLog = startDate || new Date().toISOString().split('T')[0];

                const timePayload = {
                    "_links": {
                        "workPackage": { "href": `/api/v3/work_packages/${newWorkPackageId}` },
                        "activity": { "href": "/api/v3/time_entries/activities/1" }
                    },
                    "hours": isoDuration,
                    "spentOn": dateToLog,
                    "comment": { "raw": "Logged via Task Creator" }
                };

                const timeResult = await puppeteerFetch(timeUrl, {
                    method: 'POST',
                    body: JSON.stringify(timePayload)
                }, session);

                if (timeResult.status >= 200 && timeResult.status < 300) {
                    timeLogged = true;
                } else {
                    timeError = timeResult.data.message || 'Failed to create time entry';
                    console.error('Failed to log time:', timeResult.status, JSON.stringify(timeResult.data));
                }
            }

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
    console.log(`Target Host: ${HOST}`);
});
