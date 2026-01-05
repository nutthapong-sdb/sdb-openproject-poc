require('dotenv').config();

const HOST = process.env.HOST || 'https://openproject.softdebut.com';
const API_KEY = process.env.OPENPROJECT_API_KEY;

if (!API_KEY) {
    console.error("No API Key found");
    process.exit(1);
}

const authHeader = 'Basic ' + Buffer.from('apikey:' + API_KEY).toString('base64');

async function findProjectID(name) {
    console.log(`Searching for project: '${name}'`);
    // Filter for project name
    const filters = JSON.stringify([{ "name": { "operator": "~", "values": [name] } }]);
    const url = `${HOST}/api/v3/projects?filters=${encodeURIComponent(filters)}`;

    console.log('URL:', url);

    try {
        const fetch = (await import('node-fetch')).default;
        const res = await fetch(url, {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (res.status === 403) {
            console.log("Project search blocked by Cloudflare or Permission");
            return;
        }

        const data = await res.json();
        if (data._embedded && data._embedded.elements) {
            data._embedded.elements.forEach(p => {
                console.log(`Found Project: ${p.name} (ID: ${p.id})`);
            });
        } else {
            console.log("No projects found.");
        }

    } catch (e) {
        console.error(e);
    }
}

findProjectID('eng-sdb');
