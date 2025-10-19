# CockroachDB Parallel DDL Demo (Single-node, insecure, local)

This demo shows how **CockroachDB** can execute **concurrent schema changes** across independent tables in one database/schema.
We run two tests against a local single-node CockroachDB (insecure):

1) **Sequential** — use **Atlas** to apply 20 per-table migrations one-by-one (baseline, like Liquibase/Flyway).  
2) **Parallel** — use a **custom Prisma runner** to execute the same 20 per-table migrations **in parallel**, and **mark** each version as applied in Atlas history when its SQL succeeds.

Both tests target a single database (default: `demo`) and the `public` schema.

---

## Prerequisites

- macOS/Linux with **bash**, **curl**, and **zip** (Windows: use WSL)
- **Node.js 18+** and **npm**
- **CockroachDB** installed (CLI)
- **Atlas** CLI installed (local binary, no server)

---

## 0) Clone the repo

```git clone https://github.com/roachlong/crdb-parallel-ddl-demo.git && cd crdb-parallel-ddl-demo```

Directory layout:
```
crdb-parallel-ddl-demo/
├─ README.md
├─ package.json
├─ tsconfig.json
├─ .env.example
├─ atlas.hcl
├─ migrations/
│  └─ base/
│     ├─ 20251018_001_demo_table_1.sql
│     ├─ ...
│     └─ 20251018_020_demo_table_20.sql
│  └─ fast_inline/
│     ├─ 20251018_001_fast_table_1.sql
│     ├─ ...
│     └─ 20251018_010_fast_table_10.sql
│  └─ separate_jobs/
│     ├─ 20251018_001_sep_table_1.sql
│     ├─ ...
│     └─ 20251018_020_sep_table_10.sql
├─ prisma/
│  └─ schema.prisma
└─ src/
   ├─ run-ddl-sequential.ts
   ├─ run-ddl-parallel.ts
```

for the default base and fast inline paths each migration file contains a single `CREATE TABLE ...` with inline UNIQUE/INDEX for maximum speed per table.

for the separate jobs path each file contains separate DDL statements to create and alter the tables, which will invoke online schema changes, this is where we'll see the impact of parallel vs. sequential runs.

---

## 1) Start a local CockroachDB node (insecure)

> ⚠️ Insecure mode is for **local testing only**.

On mac (brew) or Linux, install Cockroach if you don’t have it.
Download Cockroach (if needed): https://www.cockroachlabs.com/docs/stable/install-cockroachdb-mac.html (or Linux instructions).  
On mac:
```bash
brew install cockroachdb/tap/cockroach
```

Then in a terminal window:
```bash
mkdir -p ./crdb-data
cockroach start-single-node \
  --insecure \
  --listen-addr=127.0.0.1:26257 \
  --http-addr=127.0.0.1:8080 \
  --store="$(pwd)/crdb-data" \
  --background
```

And create the demo database:
```bash
cockroach sql --insecure --host=127.0.0.1:26257 -e 'CREATE DATABASE IF NOT EXISTS demo;'
```

**Connection URL** we’ll use everywhere:
```
postgresql://root@127.0.0.1:26257/demo?sslmode=disable
```

---

## 2) Install Atlas CLI

- mac:
  ```bash
  brew install ariga/tap/atlas
  ```
- linux:
  ```bash
  curl -sSf https://atlasgo.sh | sh
  ```
- verify:
  ```bash
  atlas version
  ```

---

## 3) Configure environment & install Node deps

From the project root:

```bash
cp .env.example .env
npm install
npm run prisma:gen
```

By default `.env` sets:
```
DATABASE_URL=postgresql://root@127.0.0.1:26257/demo?sslmode=disable
ATLAS_URL=${DATABASE_URL}
```

---

## 4) Generate checksums for the migration directory

Atlas uses a checksum file (`atlas.sum`). Generate/update it any time the SQL files change:

```bash
atlas migrate hash --dir file://migrations/base
atlas migrate hash --dir file://migrations/fast_inline
atlas migrate hash --dir file://migrations/separate_jobs
```

---

## 5) **Sequential** test (Atlas applies versions one-by-one)

This runs like Liquibase/Flyway: Atlas locks the DB and applies each migration version sequentially.

```bash
MIG_DIR=migrations/fast_inline npm run ddl:sequential:atlas
MIG_DIR=migrations/separate_jobs npm run ddl:sequential:atlas
```

Logs are written to `./logs/ddl-sequential-*.csv|json`.

Inspect:
```bash
cockroach sql --insecure --host=127.0.0.1:26257 -d demo -e "SHOW TABLES;"
atlas migrate status --url "$ATLAS_URL"
```

---

## 6) Reset the database between tests

Drop & recreate the database
```bash
cockroach sql --insecure --host=127.0.0.1:26257 -e "DROP DATABASE IF EXISTS demo CASCADE; CREATE DATABASE demo;"
atlas migrate hash --dir file://migrations/fast_inline
atlas migrate hash --dir file://migrations/separate_jobs
```

---

## 7) **Parallel** test (Prisma executes; Atlas history preserved)

This runner:
- reads each per-table migration SQL file,
- **executes** it in its own explicit transaction (autocommit OFF),
- on success, **marks** the corresponding Atlas version as applied (`atlas migrate set <version>`),
- runs up to 10 tables **in parallel** (tuneable).

```bash
MIG_DIR=migrations/fast_inline npm run ddl:parallel:atlas
MIG_DIR=migrations/separate_jobs npm run ddl:parallel:atlas
```

You’ll see per-table timing, a total, and final `atlas migrate status`. Logs are written to `./logs/ddl-parallel-atlas-*.csv|json`.

### Tune parallelism
Edit `src/run-ddl-parallel-atlas-mark.ts`:
```ts
const limit = pLimit(10);
```

### Observe concurrent schema-change jobs
While it’s running, in another terminal:
```bash
cockroach sql --insecure --host=127.0.0.1:26257 -d demo -e "
  SELECT * FROM crdb_internal.jobs WHERE job_type = 'NEW SCHEMA CHANGE' ORDER BY created DESC LIMIT 50;
"
```

---

## Notes

- Each table’s DDL is a single explicit transaction; **autocommit OFF** per table.
- Inline UNIQUE/INDEX in `CREATE TABLE` keeps each table as **one schema-change job** (fastest path).
- Parallel DDL on the **same table** won’t help; Cockroach serializes those.
- Online schema change jobs only come into play when a DDL statement touches an existing object.
