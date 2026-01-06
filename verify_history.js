const fetch = require('node-fetch');

async function test() {
    console.log('--- Testing History Recording ---');

    // 1. Check Initial History
    console.log('1. Checking initial history...');
    let res = await fetch('http://localhost:3000/api/history');
    let history = await res.json();
    console.log('Initial History Count:', history.length);

    // 2. Mock Database Insert directly (Simulate successful creation)
    // Since we cannot easily mock the full OpenProject creation without credentials working perfectly headless,
    // we will inspect the database directly or use the endpoint if we were sure.
    // Actually, I can use sqlite3 directly to insert a mock record to see if Frontend picks it up.

    const db = require('sqlite3').verbose();
    const dbSqlite = new db.Database('projects.db');

    console.log('2. Inserting mock record into DB...');
    dbSqlite.run(`INSERT INTO work_package_history (work_package_id, subject, project_name, link) 
                  VALUES (9999, 'Test Task from Script', 'Mock Project', 'http://example.com/wp/9999')`, async (err) => {
        if (err) console.error(err);
        else console.log('Insert Success.');

        // 3. Check History Again API
        console.log('3. Checking history via API...');
        res = await fetch('http://localhost:3000/api/history');
        history = await res.json();
        console.log('New History Count:', history.length);
        if (history.length > 0 && history[0].subject === 'Test Task from Script') {
            console.log('SUCCESS: History API is serving content!');
        } else {
            console.log('FAILURE: History API not returning new record.');
        }
    });

}

test();
