require('dotenv').config();

const HOST = process.env.HOST || 'https://openproject.softdebut.com';
const API_KEY = process.env.OPENPROJECT_API_KEY;

if (!API_KEY) {
    console.error("No API Key found");
    process.exit(1);
}

const name = "Nutthapong Vivithsurakarn";
const authHeader = 'Basic ' + Buffer.from('apikey:' + API_KEY).toString('base64');

async function testSearch(searchName) {
    console.log(`Testing search for: '${searchName}'`);
    const filters = JSON.stringify([{ "name": { "operator": "~", "values": [searchName] } }]);
    const url = `${HOST}/api/v3/users?filters=${encodeURIComponent(filters)}`;

    console.log('URL:', url);

    try {
        const fetch = (await import('node-fetch')).default;
        const res = await fetch(url, {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            }
        });

        console.log('Status:', res.status);
        const text = await res.text();
        console.log('Body:', text.substring(0, 1000));
    } catch (e) {
        console.error(e);
    }
}

testSearch(name);
testSearch("Nutthapong");
