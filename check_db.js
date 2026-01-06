const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./projects.db');

db.serialize(() => {
    db.all("SELECT count(*) as count FROM local_assignees", (err, rows) => {
        if (err) console.error(err);
        else console.log("Total Assignees:", rows[0].count);
    });
    db.all("SELECT * FROM local_assignees LIMIT 5", (err, rows) => {
        if (err) console.error(err);
        else console.log("Samples:", rows);
    });
});
// db.close(); // let it drain
