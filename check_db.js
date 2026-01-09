const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./projects.db');

db.serialize(() => {
    console.log("Checking Users...");
    db.all("SELECT id, username, name, role, openproject_id FROM users", (err, rows) => {
        if (err) console.error(err);
        else {
            console.log("Users Found:", rows.length);
            console.table(rows);
        }
    });
});
