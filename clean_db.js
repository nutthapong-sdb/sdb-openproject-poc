const fs = require('fs');
const path = require('path');

const dbPath = path.resolve('./projects.db');

if (fs.existsSync(dbPath)) {
    try {
        fs.unlinkSync(dbPath);
        console.log('projects.db deleted successfully.');
    } catch (e) {
        console.error('Failed to delete projects.db:', e);
    }
} else {
    console.log('projects.db does not exist.');
}
