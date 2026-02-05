# SDB OpenProject POC System Overview

This document provides a technical overview of the **sdb-openproject-poc** system, a middleware application designed to integrate with OpenProject.

## 1. Project Purpose
The system serves as a Proof of Concept (POC) for interacting with an OpenProject instance (`https://openproject.softdebut.com`). It acts as a bridge/middleware that:
-   Simplifies user interaction with OpenProject tasks.
-   Caches project data locally to improve performance.
-   Bypasses complex authentication/protection mechanisms (likely Cloudflare) using Puppeteer.
-   Manages a local history of tasks created through this interface.

## 2. Technology Stack

### Backend
-   **Runtime:** Node.js
-   **Web Framework:** Express.js
-   **Database:** SQLite (`projects.db`) - Used for local caching of projects, types, user mappings, and task history.
-   **Authentication:** 
    -   Local `users` table with `bcrypt` password hashing.
    -   Verification against OpenProject API using API Keys.
    -   Session management via Cookies (`sdb_session`, `user_apikey`).

### External Integration & Automation
-   **Puppeteer:** Used as a headless browser to perform API requests to OpenProject. This is a critical component designed to bypass bot protections (Stealth Plugin used).
-   **Axios / Node-fetch:** Standard HTTP clients (though Puppeteer is heavily favored for core interactions).

### Frontend
-   Served as static files from the `public/` directory.
-   Uses `jQuery UI` and `Select2` for UI components.

## 3. Key Features & Modules

### A. Authentication System (`server.js`)
-   **Login:** Validates credentials against a local database.
-   **API Verification:** Authenticates the user's API key against OpenProject (`/api/v3/users/me`).
-   **Migration:** Automatically migrates legacy plaintext passwords to `bcrypt` hashes upon successful login.

### B. Project Synchronization
-   **Sync Mechanism:** Periodically/Manually syncs all projects and work package types from OpenProject.
-   **Storage:** Stores project IDs, names, and types in the local SQLite database to allow fast, offline-capable searching and loading.

### C. Task Management
-   **Create Work Package:** Allows users to create tasks (Work Packages) in OpenProject.
-   **History:** configuration Keeps a local log of all tasks created via this tool (`task_history` table), enabling a "Recent Tasks" view.

### D. Assignee Management
-   **Local Assignees:** Maintains a curated list of users/assignees in the local database to speed up assignment selection without constantly querying the full OpenProject user directory.
-   **Search:** Implements a search strategy to find users across specific projects or default pools (Production/MA projects).

### E. Puppeteer "Fetch" Wrapper
-   A custom `puppeteerFetch` function replaces standard HTTP requests.
-   Launches a headless browser instance for requests to handle complex headers, CORS, and anti-bot challenges transparently.

## 4. Database Schema (SQLite)

-   **`projects`**: Stores Project ID and Name.
-   **`project_types`**: Stores mapping of Project IDs to available Work Package Types.
-   **`local_assignees`**: Cache of frequently used assignees (ID, Name).
-   **`task_history`**: Log of created tasks (Subject, Project, Date, Spending, URL).
-   **`users`**: Local user accounts (Username, Password Hash, API Key, OpenProject ID).
-   **`user_project_mapping`**: (Optional) Mapping specific users to projects.

## 5. Setup & Running

1.  **Install Dependencies:**
    ```bash
    npm install
    ```
2.  **Environment Variables:**
    -   `PORT`: Server port (default: 3001)
    -   `DB_FILE`: Path to SQLite DB (default: `./projects.db`)
    -   `PUPPETEER_EXECUTABLE_PATH`: Optional path to Chrome binary.
3.  **Start Server:**
    ```bash
    npm start
    ```
