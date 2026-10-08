# Disease Trend Analysis and Reporting System

A web-based system that stores a health facility's monthly disease returns,
renders them as trends, rankings, demographic breakdowns and seasonal
profiles, and raises a signal when a monthly count rises above what the same
month produced in previous years.

Built as the implementation for *Design and Implementation of a Web-Based
Disease Trend Analysis and Reporting System (A Case Study of the University of
Benin Teaching Hospital, Benin City, Edo State)*.

---

## What it does

**Stores aggregate counts only.** One row is the number of cases of one
disease, in one department, in one month, for one age group and one sex.
There is no table, column or index anywhere in the schema capable of holding a
patient name, hospital number, address or date of birth. This is a design
decision, not an omission, and it is what allows the system to run without the
consent and disclosure machinery that identifiable clinical data requires.

**Analyses in the database.** Aggregation, ranking, seasonal profiling and
baseline computation live in six PostgreSQL views and two PL/pgSQL functions
in `db/002_analysis.sql`, not in JavaScript. The engine is built for set
operations, less data crosses the wire, and each rule can be inspected and
tested on its own.

**Signals unusual months.** For a disease in a given month, the system takes
the counts recorded in that same calendar month in every previous year and
computes their average and spread. The threshold is the average plus two
standard deviations. The comparison uses the same month in earlier years
rather than the months immediately before, because comparing July against June
would flag every malaria season as an outbreak.

Two refinements keep the rule usable. Case counts behave roughly like Poisson
data, where variance tracks the mean, so the spread is held at no less than
the square root of the mean; without this, a sample standard deviation drawn
from three observations produces a threshold only a few cases above the
average. A minimum rise of 25 per cent is also required. Together these took
the demonstration dataset from 60 alerts to 10, while still catching every one
of the five outbreaks deliberately planted in it.

Where fewer than two previous years exist, no threshold is computed at all,
rather than presenting a figure that cannot bear weight.

---

## Requirements

- Node.js 18.17 or later
- PostgreSQL 14 or later (local), or a Supabase project (hosted)

---

## Running it locally

```bash
npm install
cp .env.local.example .env.local
```

Edit `.env.local` and set `DATABASE_URL` to your own PostgreSQL database and
`SESSION_SECRET` to a long random string. Generate one with:

```bash
openssl rand -base64 48
```

Then create the schema and load the demonstration data:

```bash
npm run db:migrate     # applies db/001, 002, 003 in order
npm run db:seed        # loads reference data, accounts and 56 months of returns
npm run dev            # http://localhost:3000
```

### Demonstration accounts

| Role | Email | Password | Can do |
|---|---|---|---|
| Administrator | `admin@ubth.edu.ng` | `Admin@2026` | Everything, plus manage accounts |
| Records officer | `records@ubth.edu.ng` | `Records@2026` | Enter and correct returns, review signals |
| Medical officer | `viewer@ubth.edu.ng` | `Viewer@2026` | Read dashboards and reports only |

**Change these before the system holds any real data.**

---

## Testing

```bash
npm run build
npm start &           # the suite drives the running server
npm test
```

45 tests across four groups: database integrity, the analytical functions,
authentication and access control, and the HTTP interface. Among other things
the suite proves that the schema holds no identifying column, that a month
never appears in its own baseline, that every planted outbreak was detected,
that no signal rests on fewer than two years of history, that a medical
officer cannot write a return, and that an attempted SQL injection is treated
as data rather than code.

---

## Deploying to Supabase and Vercel

### 1. Create the database

In your Supabase project, open **SQL Editor** and run the three files in
`db/` in order: `001_schema.sql`, then `002_analysis.sql`, then
`003_reference.sql`. Paste each one in full and run it before moving to the
next.

### 2. Get the right connection string

Go to **Project Settings > Database > Connection string** and choose
**Transaction mode**. Use that one. It looks like:

```
postgresql://postgres.abcdefgh:PASSWORD@aws-0-eu-west-2.pooler.supabase.com:6543/postgres
```

Note the port: **6543**, not 5432. This matters. Vercel runs each request in a
serverless function that opens its own connection, and the direct port 5432
connection limit will be exhausted within minutes of real use. The pooler
exists for exactly this. The connection pool in `src/lib/db.js` is already
sized for it.

### 3. Load the demonstration data (optional)

From your own machine, with `DATABASE_URL` set to the pooler string:

```bash
DATABASE_URL="postgresql://postgres.xxx:...@...:6543/postgres" npm run db:seed
```

Skip this if you are going straight to entering the facility's real returns.

### 4. Deploy

Push the repository to GitHub, then in Vercel choose **Add New > Project** and
import it. Before deploying, add two environment variables:

| Name | Value |
|---|---|
| `DATABASE_URL` | the Supabase pooler string from step 2 |
| `SESSION_SECRET` | a long random string, from `openssl rand -base64 48` |

Deploy. Vercel gives you the live link.

### If something goes wrong

**"DATABASE_URL is not configured"** — the environment variable was not saved
in Vercel, or was added after the deployment. Add it and redeploy.

**"SESSION_SECRET must be set and at least 32 characters"** — exactly what it
says. The value must be at least 32 characters.

**"too many connections"** — you used the port 5432 string. Switch to the
port 6543 pooler string and redeploy.

**Sign in appears to succeed but returns you to the sign in page** — this is
almost always a cookie problem. The session cookie is marked `Secure` only
when the connection is actually HTTPS, so it works on Vercel and on
`http://localhost`. If you are serving over plain HTTP from some other host,
put it behind HTTPS.

---

## How the code is arranged

```
db/
  001_schema.sql       tables, constraints, indexes, the updated_at trigger
  002_analysis.sql     six views and two functions: the analytical layer
  003_reference.sql    departments, diseases and age bands
scripts/
  migrate.mjs          applies the SQL files in order
  seed.mjs             generates the demonstration dataset
  test.mjs             the 45 automated tests
  shots.mjs            captures the interface figures
src/
  lib/db.js            connection pool and parameterised query helpers
  lib/auth.js          bcrypt hashing, signed session cookie, role checks
  lib/audit.js         the activity record
  middleware.js        blocks unauthenticated access before anything runs
  app/api/             the server-side route handlers
  app/(app)/           dashboard, trend analysis, signals, returns, admin
  components/          the navigation rail and the chart components
```

### Security

Passwords are stored as bcrypt hashes and never in recoverable form. Sessions
are signed JSON web tokens held in an httpOnly cookie, so page scripts cannot
read them. Access is decided by role rather than by permissions granted
individually. Every database call is parameterised, so values never reach the
SQL string. All input is validated on the server regardless of what the
browser checked, because a request can be made without a browser. Failed sign
in attempts, data changes and account creation are written to the activity
record.

The sign in form returns the same message whether the account does not exist
or the password is wrong, so it cannot be used to discover which addresses
have accounts.

---

## About the demonstration data

The 16,800 case counts loaded by `npm run db:seed` are **simulated**. They
reproduce the seasonal shape reported for southern Nigeria, with malaria and
diarrhoeal disease rising with the rains and Lassa fever and respiratory
infection rising in the dry season, so that the analytical features can be
exercised and demonstrated.

They are not University of Benin Teaching Hospital figures. Replace them with
the facility's own returns before making any epidemiological claim, and say
plainly in Chapter Four which of the two you are showing.
