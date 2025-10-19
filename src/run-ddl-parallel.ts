import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import pLimit from "p-limit";
import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";

// ----------------------------- Config -----------------------------
const prisma = new PrismaClient();

const MIG_DIR = process.env.MIG_DIR
  ? path.resolve(process.cwd(), process.env.MIG_DIR)
  : path.join(process.cwd(), "migrations", "base");

const DO_ATLAS_MARK = String(process.env.ATLAS_MARK || "").toLowerCase() === "true";
const ATLAS_DIR = `file://${MIG_DIR.replace(/\\/g, "/")}`;
const DB_URL = process.env.DATABASE_URL!;
const atlasEnv = { ...process.env, NO_COLOR: "1", ATLAS_NO_COLOR: "1", FORCE_COLOR: "0" };

const PAR_LIMIT = Number(process.env.PARALLEL_LIMIT || 10);

// ----------------------------- Types -----------------------------
type Row = {
  version: string;
  file: string;
  table: string;
  startIso: string;
  endIso: string;
  ms: number;
  ok: boolean;
  error?: string;
};

// ----------------------------- Helpers -----------------------------
function listJobs() {
  const files = fs.readdirSync(MIG_DIR).filter(f => f.endsWith(".sql")).sort();
  return files.map(f => {
    const [version] = f.split("_");
    const sql = fs.readFileSync(path.join(MIG_DIR, f), "utf8");
    const m = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)/i);
    const table = m ? m[1] : f;
    return { version, file: f, table, sql };
  });
}

const sleep = (ms:number)=>new Promise(r=>setTimeout(r,ms));
async function withRetries<T>(fn: () => Promise<T>, attempts=6, base=200): Promise<T> {
  let last:any;
  for (let i=0;i<attempts;i++){
    try { return await fn(); }
    catch (e:any) { last = e; if (i<attempts-1) await sleep(base*Math.pow(2,i)); }
  }
  throw last;
}

function ensureLogsDir() {
  const dir = path.join(process.cwd(), "logs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  return dir;
}

function writeLogs(kind: string, rows: Row[], totalMs: number) {
  const dir = ensureLogsDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(dir, `ddl-${kind}-${stamp}`);

  const header = "version,file,table,startIso,endIso,ms,ok,error";
  const lines = rows.map(r =>
    [r.version, r.file, r.table, r.startIso, r.endIso, r.ms, r.ok, r.error ?? ""]
      .map(v => String(v).replaceAll('"','""'))
      .map(v => /[",\n]/.test(v) ? `"${v}"` : v)
      .join(",")
  );

  const sumMs = rows.reduce((a,b) => a + b.ms, 0);

  fs.writeFileSync(`${base}.csv`, [
    header, 
    ...lines,
    `SUM_PER_TABLE,,,,,${sumMs},,`,
    `TOTAL_WALL,,,,,${totalMs},,`
  ].join("\n"));

  fs.writeFileSync(`${base}.json`, JSON.stringify({
    totalMs,
    sumPerTableMs: sumMs,
    total: rows.length,
    ok: rows.filter(r=>r.ok).length,
    failed: rows.filter(r=>!r.ok).length,
    rows
  }, null, 2));

  console.log(`\nWrote logs:\n  ${base}.csv\n  ${base}.json`);
}

async function atlasHashIfNeeded() {
  if (!DO_ATLAS_MARK) return;
  await execa("atlas", ["migrate", "hash", "--dir", ATLAS_DIR], { stdio: "pipe", env: atlasEnv });
}

async function atlasSetSequential(versions: string[]) {
  if (!DO_ATLAS_MARK) return;
  const sorted = [...versions].sort();
  for (const v of sorted) {
    await withRetries(async () => {
      const { stdout } = await execa(
        "atlas",
        ["migrate", "set", v, "--dir", ATLAS_DIR, "--url", DB_URL],
        { stdio: "pipe", env: atlasEnv }
      );
      if (stdout?.trim()) console.log(stdout.trim());
    });
  }
}

async function atlasStatus() {
  if (!DO_ATLAS_MARK) return;
  const { stdout } = await execa(
    "atlas",
    ["migrate", "status", "--dir", ATLAS_DIR, "--url", DB_URL],
    { stdio: "pipe", env: atlasEnv }
  );
  console.log(stdout.trim());
}

function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let i = 0, cur = "", inS = false, inD = false, inLine = false, inBlock = false;
  let dollarTag: string | null = null;

  const startsDollar = (idx: number) => {
    if (sql[idx] !== "$") return null;
    let j = idx + 1;
    while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
    if (sql[j] === "$") return sql.slice(idx, j + 1); // like $tag$
    return "$$";
  };

  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];

    if (inLine) {                // -- comment
      if (c === "\n") { inLine = false; cur += c; }
      else cur += c;
      i++; continue;
    }
    if (inBlock) {               /* block comment */
      if (c === "*" && n === "/") { cur += "*/"; i += 2; inBlock = false; continue; }
      cur += c; i++; continue;
    }
    if (dollarTag) {             // dollar-quoted string
      if (sql.startsWith(dollarTag, i)) { cur += dollarTag; i += dollarTag.length; dollarTag = null; continue; }
      cur += c; i++; continue;
    }
    if (inS) {                   // single-quoted
      cur += c; i++;
      if (c === "'" && sql[i] === "'") { cur += sql[i]; i++; } // escaped ''
      else if (c === "'") inS = false;
      continue;
    }
    if (inD) {                   // double-quoted identifier
      cur += c; i++;
      if (c === '"' && sql[i] === '"') { cur += sql[i]; i++; } // escaped ""
      else if (c === '"') inD = false;
      continue;
    }

    // not in any string/comment
    if (c === "-" && n === "-") { inLine = true; cur += "--"; i += 2; continue; }
    if (c === "/" && n === "*") { inBlock = true; cur += "/*"; i += 2; continue; }
    if (c === "'") { inS = true; cur += c; i++; continue; }
    if (c === '"') { inD = true; cur += c; i++; continue; }
    if (c === "$") {
      const tag = startsDollar(i);
      if (tag) { dollarTag = tag; cur += tag; i += tag.length; continue; }
    }
    if (c === ";") {
      const stmt = cur.trim();
      if (stmt) out.push(stmt);
      cur = ""; i++; continue;
    }

    cur += c; i++;
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out.filter(s => s && !/^\s*--/.test(s));
}

// ----------------------------- Main -----------------------------
async function main() {
  console.log(`Running PARALLEL DDL from: ${MIG_DIR}  (Atlas mark: ${DO_ATLAS_MARK ? "on" : "off"})  (limit=${PAR_LIMIT})`);
  await atlasHashIfNeeded();

  const jobs = listJobs();
  const rows: Row[] = [];
  const limit = pLimit(PAR_LIMIT);

  const t0 = Date.now();
  await Promise.all(
    jobs.map(j => limit(async () => {
      const start = Date.now();
      const startIso = new Date(start).toISOString();
      try {
        await withRetries(() =>
          prisma.$transaction(async (tx) => {
            const stmts = splitStatements(j.sql);
            for (const s of stmts) {
              await tx.$executeRawUnsafe(s);
            }
          })
        );
        const end = Date.now();
        console.log(`✔ ${j.table} (v${j.version}) in ${end - start}ms`);
        rows.push({ version: j.version, file: j.file, table: j.table, startIso, endIso: new Date(end).toISOString(), ms: end - start, ok: true });
      } catch (e:any) {
        const end = Date.now();
        const msg = String(e?.message ?? e);
        console.error(`✖ ${j.table} (v${j.version}) failed after ${end - start}ms -> ${msg}`);
        rows.push({ version: j.version, file: j.file, table: j.table, startIso, endIso: new Date(end).toISOString(), ms: end - start, ok: false, error: msg });
      }
    }))
  );
  const totalMs = Date.now() - t0;

  const successVersions = rows.filter(r => r.ok).map(r => r.version);
  await atlasSetSequential(successVersions);
  await atlasStatus();

  console.log(`parallel-total: ${totalMs}ms`);
  writeLogs("parallel", rows, totalMs);
  await prisma.$disconnect();
}

main().catch(async e => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
