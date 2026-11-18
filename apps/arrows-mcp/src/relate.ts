// Try a drawn model in an in-memory Relate graph engine (https://github.com/relatedb/relate):
// load it, seed synthetic data, then compile or run Cypher against it and report what happened.
// @relate/relate is an optional native dependency.
//
// The engine's Node binding makes synchronous native calls with no timeout, so it runs off the server's
// main thread: in a killable child process, or on a worker thread where the host blocks child processes.
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { toCypher, toSeed, isSchemaGraph, type GraphJson } from './engine';
import { FANOUT, MAX_SEED } from './seed';

export const MAX_ROWS = 50;
export const MAX_ROW_BYTES = 8_000;
export const TIMEOUT_MS = 20_000;
export const DEFAULT_SEED = 1000;
export const MIN_GROWTH_SEED = 100;
// Logical bytes (the engine's RELATE_LOGICAL_GRAPH_SIZE_LIMIT); bounds memory for untrusted queries.
const GRAPH_SIZE_LIMIT = String(256 * 1024 * 1024);

export type Mode = 'run' | 'compile';

export interface TryOptions {
  queries: string[];
  data?: string;
  seed?: number;
  mode?: Mode;
  profile?: boolean;
  growth?: boolean;
}

export interface Warning {
  title: string;
  remedy?: string;
  severity?: string;
}
export interface Operator {
  op: string;
  details: string;
  rows: number | null;
  dbHits: number;
}
export interface QueryOutcome {
  query: string;
  error?: string;
  rows?: Record<string, unknown>[];
  truncated?: boolean;
  warnings: Warning[];
  dbHits?: number;
  ops?: Operator[];
}
export interface RunResult {
  /** rows generated per label in this run (0 = none) */
  seed: number;
  /** setup statements that succeeded before any failure */
  loaded: number;
  setupError?: string;
  counts?: { labels: Record<string, number>; relationships: Record<string, number> };
  outcomes: QueryOutcome[];
}
export type TryResult = { available: false; reason: string } | { available: true; runs: RunResult[] };

/** Engine script, plain JS: run by `node -e` (stdin/stdout) or as a worker (workerData/postMessage). */
const WORKER = `
const wt = require('worker_threads');
const bi = (k, v) => (typeof v === 'bigint' ? v.toString() : v);
const send = (o) => { const s = JSON.stringify(o, bi); if (wt.isMainThread) process.stdout.write(s); else wt.parentPort.postMessage(s); };
let lib;
try { lib = require(wt.isMainThread ? process.argv[1] : wt.workerData.engine); } catch (e) { send({ unavailable: String((e && e.message) || e) }); }
const msg = (e) => String((e && e.message) || e).slice(0, 600);
const PREFIXED = /^\\s*(profile|explain)\\b/i;
const sumHits = (n) => ((n.actual && n.actual.db_hits) || 0) + (n.children || []).reduce((s, c) => s + sumHits(c), 0);
const flatten = (n, acc) => {
  acc.push({ op: n.operator, details: n.details || '', rows: n.actual ? n.actual.rows : null, dbHits: n.actual ? n.actual.db_hits || 0 : 0 });
  (n.children || []).forEach((c) => flatten(c, acc));
  return acc;
};
const warnings = (r) => {
  const seen = new Set();
  return (r.notifications || [])
    .filter((n) => !/EstimationMiss/i.test(n.code || ''))
    .map((n) => ({ title: n.title, remedy: n.remedy, severity: n.severity }))
    .filter((w) => { const k = w.title + '|' + w.remedy; if (seen.has(k)) return false; seen.add(k); return true; });
};
const run = (raw) => {
  const { runs, queries, mode, profile, maxRows, maxBytes } = JSON.parse(raw);
  const capRows = (rows) => {
    let kept = rows.slice(0, maxRows);
    while (kept.length > 1 && JSON.stringify(kept, bi).length > maxBytes) kept = kept.slice(0, Math.ceil(kept.length / 2));
    if (kept.length === 1 && JSON.stringify(kept, bi).length > maxBytes) kept = [{ note: 'row too large to show (over ' + maxBytes + ' bytes)' }];
    return { rows: kept, truncated: kept.length < rows.length };
  };
  const results = runs.map((run) => {
    const conn = lib.Database.open(':memory:').connect();
    let loaded = 0;
    for (const stmt of run.setup) {
      try { conn.query(stmt); loaded++; } catch (e) { return { seed: run.seed, loaded, setupError: msg(e), outcomes: [] }; }
    }
    if (queries.length === 0) {
      const labels = {}, relationships = {};
      for (const r of conn.query('MATCH (n) UNWIND labels(n) AS l RETURN l, count(*) AS c').rows) labels[r.l] = r.c;
      for (const r of conn.query('MATCH ()-[r]->() RETURN type(r) AS t, count(*) AS c').rows) relationships[r.t] = r.c;
      return { seed: run.seed, loaded, counts: { labels, relationships }, outcomes: [] };
    }
    // Each query runs in a transaction that is rolled back, so a query that writes cannot change
    // what the next one sees: "each runs independently" holds.
    const outcomes = queries.map((stmts) => {
      const query = stmts.join('; ');
      try {
        conn.begin();
        let r;
        stmts.forEach((s, k) => {
          if (k === stmts.length - 1 && !PREFIXED.test(s)) s = (mode === 'compile' ? 'EXPLAIN ' : profile ? 'PROFILE ' : '') + s;
          r = conn.query(s);
        });
        const o = { query, warnings: warnings(r) };
        if (mode === 'compile') return o;
        Object.assign(o, capRows(r.rows));
        if (r.plan && r.plan.profiled) { o.dbHits = sumHits(r.plan.root); o.ops = flatten(r.plan.root, []).slice(0, 12); }
        return o;
      } catch (e) {
        return { query, error: msg(e), warnings: [] };
      } finally {
        try { conn.rollback(); } catch (_) {}
      }
    });
    return { seed: run.seed, loaded, outcomes };
  });
  send({ results });
};
if (lib) {
  if (wt.isMainThread) {
    let raw = '';
    process.stdin.on('data', (d) => (raw += d)).on('end', () => run(raw));
  } else run(wt.workerData.input);
}
`;

/** The engine runs one statement per call: drop // comments, split on ; outside quotes. */
export function statements(script: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote !== '`') cur += script[++i] ?? '';
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      cur += ch;
    } else if (ch === '/' && script[i + 1] === '/') {
      while (i < script.length && script[i] !== '\n') i++;
      cur += '\n';
    } else if (ch === ';') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

function resolveEngine(): string | undefined {
  try {
    return require.resolve('@relate/relate');
  } catch {
    return undefined;
  }
}

/** Only what the engine needs; the server's own environment (tokens, credentials) stays out. */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1', RELATE_LOGICAL_GRAPH_SIZE_LIMIT: GRAPH_SIZE_LIMIT };
  for (const key of ['RELATE_LIB', 'SystemRoot']) if (process.env[key]) env[key] = process.env[key];
  return env;
}

/** Throws Error for a bad combination of options; the message is written for the model that sent it. */
function plan(graph: GraphJson, o: TryOptions): { seeds: number[]; mode: Mode; profile: boolean } {
  const mode = o.mode ?? 'run';
  const profile = o.profile ?? true;
  const schema = isSchemaGraph(graph);
  if (mode === 'compile' && o.queries.length === 0) throw new Error('mode "compile" needs `queries` to compile');
  if (o.seed !== undefined && o.seed > 0 && !schema) {
    throw new Error('`seed` generates data for a schema model (property values are type names). This model carries literal data, which is loaded as drawn; drop `seed`.');
  }
  // Compile mode needs one row per label: the engine learns property names from data, so on an
  // empty store every property would be reported as an unknown key.
  const rows = !schema ? 0 : mode === 'compile' ? 1 : Math.min(o.seed ?? (o.data ? 0 : DEFAULT_SEED), MAX_SEED);
  if (o.growth) {
    if (mode !== 'run' || !profile || o.queries.length === 0) throw new Error('`growth` compares query cost at two data sizes, so it needs mode "run", profile on, and `queries`');
    if (rows < MIN_GROWTH_SEED) throw new Error(`\`growth\` compares N/10 with N rows per label, so it needs a schema model and \`seed\` of at least ${MIN_GROWTH_SEED}`);
    return { seeds: [Math.floor(rows / 10), rows], mode, profile };
  }
  return { seeds: [rows], mode, profile };
}

/** Fresh database per run. The model is loaded first (constraints for a type model, literal
 * CREATE for an instance model), then seed rows, then `data`; each query runs independently. */
export function tryModel(graph: GraphJson, opts: TryOptions): Promise<TryResult> {
  const engine = resolveEngine();
  if (!engine) {
    return Promise.resolve({
      available: false,
      reason:
        'The Relate engine (@relate/relate) is not installed in this server, so models cannot be queried. ' +
        'The diagram and exports are unaffected.',
    });
  }
  if (workerStuck) {
    return Promise.resolve({
      available: false,
      reason: 'A previous query is still running inside the engine and cannot be stopped here. Restart the extension to clear it.',
    });
  }
  const { seeds, mode, profile } = plan(graph, opts);
  const model = statements(toCypher(graph));
  const data = opts.data ? statements(opts.data) : [];
  const input = JSON.stringify({
    runs: seeds.map((seed) => ({ seed, setup: [...model, ...(seed > 0 ? toSeed(graph, seed) : []), ...data] })),
    queries: opts.queries.map(statements),
    mode,
    profile,
    maxRows: MAX_ROWS,
    maxBytes: MAX_ROW_BYTES,
  });

  return run(engine, input).then(parse);
}

interface Raw {
  out: string;
  err: string;
  timedOut: boolean;
}

const TIMEOUT_REASON = `Stopped after ${TIMEOUT_MS / 1000}s: the data or a query is too expensive (unbounded cross product or variable-length path, or a very large \`seed\`). Nothing was returned; narrow it and retry.`;

/** Rejects only when the child cannot be started; a started child always resolves. */
const viaChild = (engine: string, input: string): Promise<Raw> =>
  new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(process.execPath, ['-e', WORKER, engine], { env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(e);
    }
    let out = '';
    let err = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.stdout!.on('data', (d) => (out += d));
    child.stderr!.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve({ out, err, timedOut });
    });
    child.stdin!.end(input);
  });

// A worker stuck in native code cannot be stopped, so after a timeout the engine is refused until it exits.
let workerStuck = false;

const viaWorker = (engine: string, input: string): Promise<Raw> =>
  new Promise((resolve) => {
    process.env.RELATE_LOGICAL_GRAPH_SIZE_LIMIT ??= GRAPH_SIZE_LIMIT;
    const worker = new Worker(WORKER, { eval: true, workerData: { engine, input } });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      workerStuck = true;
      void worker.terminate();
      resolve({ out, err, timedOut: true });
    }, TIMEOUT_MS);
    worker.on('message', (m: string) => (out = m));
    worker.on('error', (e) => (err += e.message));
    worker.on('exit', () => {
      workerStuck = false;
      clearTimeout(timer);
      resolve({ out, err, timedOut: false });
    });
  });

const run = (engine: string, input: string): Promise<Raw> =>
  viaChild(engine, input).catch(() => viaWorker(engine, input));

function parse({ out, err, timedOut }: Raw): TryResult {
  if (timedOut) return { available: false, reason: TIMEOUT_REASON };
  try {
    const res = JSON.parse(out) as { unavailable: string } | { results: RunResult[] };
    if ('unavailable' in res) return { available: false, reason: `The Relate engine is installed but failed to load: ${res.unavailable}` };
    return { available: true, runs: res.results };
  } catch {
    return { available: false, reason: `the Relate engine exited without a result${err ? `: ${err.slice(0, 300)}` : ''}` };
  }
}

// ---------------------------------------------------------------------------------------------
// Report

const n = (v: number): string => v.toLocaleString('en-US');

/** How cost grew while the data grew by `dataFactor`; the one number that carries over to Neo4j. */
export function growthNote(small: number, large: number, dataFactor: number): string {
  if (small <= 0 || large <= 0) return 'growth: not measurable (no db hits in one run)';
  const ratio = large / small;
  const exponent = Math.log(ratio) / Math.log(dataFactor);
  const kind =
    exponent < 0.3 ? 'roughly constant' : exponent < 1.3 ? 'roughly linear' : exponent < 1.8 ? 'worse than linear' : 'about quadratic or worse';
  return `growth: db hits x${ratio.toFixed(1)} for x${dataFactor.toFixed(0)} data (${kind})`;
}

const PROFILE_NOTE =
  'Note on PROFILE: it adds a small overhead (about 3-7% measured) but is on by default because it gives real query details - ' +
  'warnings and how cost grows with data size. The engine is Relate, not Neo4j: trust the warnings and the growth, not absolute db hits. ' +
  'A clean result at this scale does not guarantee speed on real data volume.';

function scaleLabel(seed: number): string {
  return seed > 0
    ? `${n(seed)} rows per label, uniform, fan-out ${FANOUT}, no skew (supernodes and skewed data are not represented)`
    : 'no generated data (the model\'s own data and your `data`, if any)';
}

function opsTable(ops: Operator[]): string {
  return ops.map((o) => `      ${o.op}  ${n(o.dbHits)} db hits, ${o.rows ?? '?'} rows  ${o.details}`.trimEnd()).join('\n');
}

export function formatTry(runs: RunResult[], o: { mode: Mode; profile: boolean; hasQueries: boolean }): { text: string; isError: boolean } {
  const bad = runs.find((r) => r.setupError);
  if (bad) {
    const at = bad.seed > 0 ? ` at ${n(bad.seed)} rows per label` : '';
    return {
      isError: true,
      text: `Loading failed${at} after ${bad.loaded} statement(s): ${bad.setupError}\nThis is the model or the data, not the queries - nothing was run.`,
    };
  }
  const large = runs[runs.length - 1];
  const small = runs.length > 1 ? runs[0] : undefined;
  const header =
    o.mode === 'compile'
      ? 'Compile only (EXPLAIN): nothing was executed. A one-row placeholder per label stands in so property names are known; results say nothing about data or speed.'
      : `Data: ${scaleLabel(large.seed)}${small ? ` (compared with ${n(small.seed)} per label)` : ''}.`;

  if (!o.hasQueries) {
    const c = large.counts;
    const fmt = (m: Record<string, number>): string => Object.entries(m).map(([k, v]) => `${k} ${n(v)}`).join(', ') || 'none';
    return {
      isError: false,
      text: `${header}\nLoaded ${large.loaded} statement(s) without a constraint violation.\nNodes: ${fmt(c?.labels ?? {})}\nRelationships: ${fmt(c?.relationships ?? {})}`,
    };
  }

  const blocks = large.outcomes.map((q, i) => {
    const lines = [`${i + 1}. ${q.query}`];
    if (q.error) {
      lines.push(`   ERROR: ${q.error}`);
      return lines.join('\n');
    }
    if (o.mode === 'compile') lines.push(q.warnings.length ? '   compiles, with warnings' : '   compiles, no warnings');
    else lines.push(`   ${q.rows?.length ?? 0} row(s)${q.truncated ? ' (more not shown)' : ''}: ${JSON.stringify(q.rows)}`);
    let slow = false;
    if (q.dbHits !== undefined) {
      lines.push(`   profile: ${n(q.dbHits)} db hits${large.seed > 0 ? ` at ${n(large.seed)} per label` : ''}`);
      const s = small?.outcomes[i];
      if (s && s.dbHits !== undefined && !s.error) {
        const note = growthNote(s.dbHits, q.dbHits, large.seed / small!.seed);
        lines.push(`   ${note}`);
        slow = /worse than linear|quadratic/.test(note);
      }
    }
    for (const w of q.warnings) lines.push(`   warning: ${w.title}${w.remedy ? ` - ${w.remedy}` : ''}`);
    if ((q.warnings.length > 0 || slow) && q.ops?.length) lines.push(`   plan:\n${opsTable(q.ops)}`);
    return lines.join('\n');
  });
  const footer = o.mode === 'run' && o.profile ? `\n\n${PROFILE_NOTE}` : '';
  return { isError: false, text: `${header}\n\n${blocks.join('\n\n')}${footer}` };
}
