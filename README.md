# Latha Backend — Phase 1

This is the shared server for Godown Book and Business Tools. Phase 1 only
covers real accounts and real sessions — Godown Book and Task Management's
actual data (Items, Bills, Tasks, etc.) will be added in Phase 2/3.

## What this replaces

Instead of a static shared password (Business Tools / Godown Book v1) or a
username list shipped to the browser (Godown Book v2), this server:
- Stores only a **salted, hashed** password per user — never plaintext
- Issues a **temporary session token** on login (expires after 24 hours)
- Locks out a username for 15 minutes after 5 failed login attempts
- Will let every future feature (Godown Book, Task Management, ...) check
  the token's role server-side before allowing anything sensitive

## One-time setup

### 1. Create a Postgres database
On Render or Railway, create a new Postgres database. Copy its connection
string — it looks like `postgres://user:pass@host:port/dbname`.

### 2. Set environment variables
Create a `.env` file (or set these in Render/Railway's dashboard):
```
DATABASE_URL=<your Postgres connection string>
PORT=3000
```

### 3. Install dependencies
```
npm install
```

### 4. Run the migration (creates the tables)
```
npm run migrate
```

### 5. Seed the starting accounts
Open `scripts/seed.js`, change the placeholder passwords to whatever you
actually want them to be, then run:
```
npm run seed
```
This only stores the hashed version in the database — the plaintext
password never touches the database, only your local script run.

### 6. Deploy
Push this folder to a GitHub repo, then connect it to Render or Railway as
a Node.js web service. Both platforms auto-detect `npm start` from
`package.json`. Set the same environment variables there as step 2.

### 7. Test it
```
curl https://your-service.onrender.com/health
```
Should return `{"ok":true,"time":"..."}`.

Then test login:
```
curl -X POST https://your-service.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<whatever you set in seed.js>"}'
```
Should return a token, role, name, and email.

## What's next
GST Reconciliation, Ledger Reconciliation, and Payment & Outstanding are the
only pieces left (Phase 4) — and that one comes with the privacy tradeoff
discussed earlier (PDFs would be processed on the server, not just in the
browser). Decide that one whenever you're ready; nothing here depends on it.

## Phase 2: Godown Book (already included)

`migrations/002_godown.sql` adds Items, Transactions, Edit Log, Bills, and
Customers as real tables. `src/routes/godown.js` exposes:

- `GET /api/godown/all` — everything, for the app's initial load
- `POST /api/godown/items` *(admin only)* — add an item
- `POST /api/godown/items/bulk` *(admin only)* — bulk import
- `PUT /api/godown/items/:id` *(admin only)* — edit an item
- `POST /api/godown/bills` — create a bill (IN or OUT)
- `PUT /api/godown/bills/:billGroup` — edit a bill (only the creator or an admin)
- `DELETE /api/godown/bills/:billGroup` — delete a bill (only the creator or an admin)
- `POST /api/godown/received-bills` — log received bills
- `PUT /api/godown/received-bills/:id/dispatch` — mark one dispatched
- `DELETE /api/godown/received-bills/:id` — remove a pending received bill

## Phase 3: Task Management (already included)

`migrations/003_tasks.sql` adds Employees, Tasks, and Updates. No admin
restriction here — matches the original tool, where anyone logged in can
manage tasks. `src/routes/tasks.js` exposes:

- `GET /api/tasks/all` — everything, for the app's initial load
- `POST /api/tasks/employees` — add an employee
- `PUT /api/tasks/employees/:id` — edit one field (`{field, value}` in the body)
- `DELETE /api/tasks/employees/:id` — remove an employee (their tasks stay, marked unassigned)
- `POST /api/tasks/tasks` — create a task
- `PUT /api/tasks/tasks/:id` — edit a task (a status change automatically logs an update)
- `POST /api/tasks/tasks/:id/done` — the one-click "mark done" shortcut
- `DELETE /api/tasks/tasks/:id` — delete a task (its update history goes with it)
- `POST /api/tasks/updates` — log a manual update, optionally changing status

Every route above (except the two `/all` endpoints) requires a valid
session token in the `Authorization: Bearer <token>` header — get one from
`POST /api/auth/login`.

Re-run `npm run migrate` after pulling this update — it's safe to run
multiple times (each migration file only creates tables if they don't
already exist).

