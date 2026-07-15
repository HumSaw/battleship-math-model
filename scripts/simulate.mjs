// scripts/simulate.ts
import {
  Worker,
  isMainThread,
  parentPort,
  workerData
} from "node:worker_threads";
import { fileURLToPath } from "node:url";
import os from "node:os";

// lib/battleship-engine.ts
var SIZE = 10;
var CELLS = SIZE * SIZE;
var UNKNOWN = 0;
var MISS = 1;
var HIT = 2;
var SUNK = 3;
var FLEETS = {
  // Русские правила: 1×4, 2×3, 3×2, 4×1; корабли не касаются даже углами
  russian: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1],
  // Международные (Hasbro): 5, 4, 3, 3, 2; касание разрешено
  international: [5, 4, 3, 3, 2]
};
var rowOf = (i) => Math.floor(i / SIZE);
var colOf = (i) => i % SIZE;
function neighbors8(i) {
  const r = rowOf(i);
  const c = colOf(i);
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) out.push(nr * SIZE + nc);
    }
  }
  return out;
}
function orthoNeighbors(i) {
  const r = rowOf(i);
  const c = colOf(i);
  const out = [];
  if (r > 0) out.push(i - SIZE);
  if (r < SIZE - 1) out.push(i + SIZE);
  if (c > 0) out.push(i - 1);
  if (c < SIZE - 1) out.push(i + 1);
  return out;
}
function diagNeighbors(i) {
  const r = rowOf(i);
  const c = colOf(i);
  const out = [];
  for (const dr of [-1, 1]) {
    for (const dc of [-1, 1]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) out.push(nr * SIZE + nc);
    }
  }
  return out;
}
function isStraightLine(cells) {
  if (cells.length === 0) return false;
  if (cells.length === 1) return true;
  const rows = cells.map(rowOf);
  const cols = cells.map(colOf);
  const sameRow = rows.every((r) => r === rows[0]);
  const sameCol = cols.every((c) => c === cols[0]);
  if (!sameRow && !sameCol) return false;
  const axis = (sameRow ? cols : rows).slice().sort((a, b) => a - b);
  for (let k = 1; k < axis.length; k++) {
    if (axis[k] !== axis[k - 1] + 1) return false;
  }
  return true;
}
var placementsCache = /* @__PURE__ */ new Map();
function placementsFor(len) {
  const cached = placementsCache.get(len);
  if (cached) return cached;
  const list = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c + len <= SIZE; c++) {
      const cells = [];
      for (let k = 0; k < len; k++) cells.push(r * SIZE + c + k);
      list.push(cells);
    }
  }
  if (len > 1) {
    for (let c = 0; c < SIZE; c++) {
      for (let r = 0; r + len <= SIZE; r++) {
        const cells = [];
        for (let k = 0; k < len; k++) cells.push((r + k) * SIZE + c);
        list.push(cells);
      }
    }
  }
  placementsCache.set(len, list);
  return list;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function floodClusters(board, state) {
  const seen = new Uint8Array(CELLS);
  const clusters = [];
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== state || seen[i]) continue;
    const cluster = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const cur = stack.pop();
      cluster.push(cur);
      for (const n of orthoNeighbors(cur)) {
        if (board[n] === state && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}
var DEFAULT_OPTIONS = {
  targetSamples: 12e3,
  maxAttempts: 2e5,
  timeBudgetMs: 380,
  enumLimit: 25e4
};
var DEADLINE_CHECK_INTERVAL = 64;
var EXPECTIMAX_MAX_CONFIGS = 1500;
var EXPECTIMAX_NODE_CAP = 15e5;
var TIEBREAK_EPS = 0.05;
var TIEBREAK_TOP = 10;
var MC_STORE_LIMIT = 6e3;
var SKEW_BONUS = 0.02;
function analyze(board, rules, sunkShips, options) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const nt = rules === "russian";
  let inconsistent = false;
  const ships = sunkShips && sunkShips.length > 0 ? sunkShips : floodClusters(board, SUNK);
  const sunkOwner = new Int16Array(CELLS).fill(-1);
  for (let s = 0; s < ships.length; s++) {
    if (!isStraightLine(ships[s])) inconsistent = true;
    for (const c of ships[s]) {
      if (board[c] !== SUNK || sunkOwner[c] !== -1) inconsistent = true;
      sunkOwner[c] = s;
    }
  }
  for (let i = 0; i < CELLS; i++) {
    if (board[i] === SUNK && sunkOwner[i] === -1) inconsistent = true;
  }
  if (nt) {
    for (let i = 0; i < CELLS; i++) {
      if (sunkOwner[i] === -1) continue;
      for (const n of neighbors8(i)) {
        if (sunkOwner[n] !== -1 && sunkOwner[n] !== sunkOwner[i]) inconsistent = true;
      }
    }
  }
  const destroyed = ships.map((s) => s.length).sort((a, b) => b - a);
  const fleet = [...FLEETS[rules]];
  for (const d of destroyed) {
    const ix = fleet.indexOf(d);
    if (ix === -1) inconsistent = true;
    else fleet.splice(ix, 1);
  }
  const remaining = fleet.sort((a, b) => b - a);
  const maxRemaining = remaining.length ? remaining[0] : 0;
  const hitCells = [];
  for (let i = 0; i < CELLS; i++) if (board[i] === HIT) hitCells.push(i);
  const hitClusters = floodClusters(board, HIT);
  const clusterOf = new Array(CELLS);
  const collinearOf = new Uint8Array(CELLS);
  for (const cl of hitClusters) {
    const rows = new Set(cl.map(rowOf));
    const cols = new Set(cl.map(colOf));
    const collinear = rows.size === 1 || cols.size === 1;
    if (nt && !collinear) inconsistent = true;
    if (cl.length > maxRemaining) inconsistent = true;
    for (const c of cl) {
      clusterOf[c] = cl;
      collinearOf[c] = collinear ? 1 : 0;
    }
  }
  const baseBlocked = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    if (board[i] === MISS || board[i] === SUNK) baseBlocked[i] = 1;
  }
  if (nt) {
    for (let i = 0; i < CELLS; i++) {
      if (board[i] === SUNK) {
        for (const n of neighbors8(i)) if (board[n] !== SUNK) baseBlocked[n] = 1;
      }
      if (board[i] === HIT) {
        for (const n of diagNeighbors(i)) baseBlocked[n] = 1;
      }
    }
  }
  for (const h of hitCells) {
    if (baseBlocked[h]) inconsistent = true;
  }
  const emptyResult = (mode2) => ({
    probs: new Array(CELLS).fill(0),
    best: null,
    top: [],
    validSamples: 0,
    attempts: 0,
    mode: mode2,
    remaining,
    destroyed,
    impossible: new Array(CELLS).fill(false),
    exact: true,
    method: "enumerated",
    effectiveSamples: 0,
    policy: "maxprob",
    expectedShots: null
  });
  if (inconsistent) return emptyResult("inconsistent");
  if (remaining.length === 0 && hitCells.length === 0) return emptyResult("won");
  if (remaining.length === 0 && hitCells.length > 0) return emptyResult("inconsistent");
  const uniqueLens = [...new Set(remaining)];
  const validByLen = /* @__PURE__ */ new Map();
  for (const L of uniqueLens) {
    const list = [];
    for (const cells of placementsFor(L)) {
      let ok = true;
      let hasUnknown = false;
      for (const c of cells) {
        if (baseBlocked[c]) {
          ok = false;
          break;
        }
        if (board[c] === UNKNOWN) hasUnknown = true;
      }
      if (ok && hasUnknown) list.push(cells);
    }
    validByLen.set(L, list);
  }
  const coveringByLen = /* @__PURE__ */ new Map();
  for (const L of uniqueLens) {
    const map = Array.from({ length: CELLS }, () => []);
    for (const cells of validByLen.get(L)) {
      for (const c of cells) map[c].push(cells);
    }
    coveringByLen.set(L, map);
  }
  const staticPossible = new Uint8Array(CELLS);
  for (const L of uniqueLens) {
    for (const cells of validByLen.get(L)) {
      for (const c of cells) staticPossible[c] = 1;
    }
  }
  let seed = rules === "russian" ? 2654435769 : 2246822507;
  for (let i = 0; i < CELLS; i++) seed = Math.imul(seed, 31) + board[i] + 1 | 0;
  const rng = mulberry32(seed);
  const enumResult = tryEnumerate(
    remaining,
    validByLen,
    baseBlocked,
    board,
    hitCells,
    nt,
    opts.enumLimit
  );
  const counts = new Float64Array(CELLS);
  let totalWeight = 0;
  let sumW2 = 0;
  let valid = 0;
  let attempts = 0;
  let method = "montecarlo";
  const storedOcc = [];
  const storedW = [];
  if (enumResult) {
    method = "enumerated";
    counts.set(enumResult.counts);
    totalWeight = enumResult.total;
    valid = enumResult.total;
    attempts = enumResult.nodes;
    sumW2 = enumResult.total;
  } else {
    const placeable = (cells, blocked) => {
      for (const c of cells) if (blocked[c]) return false;
      return true;
    };
    const place = (cells, occupied, blocked) => {
      for (const c of cells) {
        occupied[c] = 1;
        blocked[c] = 1;
      }
      if (nt) {
        for (const c of cells) for (const n of neighbors8(c)) blocked[n] = 1;
      }
    };
    const trySample = () => {
      const occupied = new Uint8Array(CELLS);
      const blocked = baseBlocked.slice();
      const pool = remaining.slice();
      let uncovered = hitCells.slice();
      let weight = 1;
      while (uncovered.length) {
        const h = uncovered[rng() * uncovered.length | 0];
        const cl = clusterOf[h];
        const mustCoverAll = nt && collinearOf[h] === 1;
        const options2 = [];
        const seenLen = /* @__PURE__ */ new Set();
        for (let li = 0; li < pool.length; li++) {
          const L = pool[li];
          if (seenLen.has(L)) continue;
          seenLen.add(L);
          if (mustCoverAll && L < cl.length) continue;
          const covering = coveringByLen.get(L)[h];
          for (const cells of covering) {
            if (mustCoverAll) {
              let coversAll = true;
              for (const c of cl) {
                if (!cells.includes(c)) {
                  coversAll = false;
                  break;
                }
              }
              if (!coversAll) continue;
            }
            if (placeable(cells, blocked)) options2.push({ li, cells });
          }
        }
        if (!options2.length) return null;
        weight *= options2.length;
        const pick = options2[rng() * options2.length | 0];
        pool.splice(pick.li, 1);
        place(pick.cells, occupied, blocked);
        uncovered = uncovered.filter((c) => !occupied[c]);
      }
      for (const L of pool) {
        const cand = validByLen.get(L);
        const opts2 = [];
        for (const cells of cand) {
          if (placeable(cells, blocked)) opts2.push(cells);
        }
        if (!opts2.length) return null;
        weight *= opts2.length;
        place(opts2[rng() * opts2.length | 0], occupied, blocked);
      }
      return { occ: occupied, w: weight };
    };
    const deadline = Date.now() + opts.timeBudgetMs;
    while (valid < opts.targetSamples && attempts < opts.maxAttempts) {
      if (attempts % DEADLINE_CHECK_INTERVAL === 0 && Date.now() >= deadline) break;
      attempts++;
      const sample = trySample();
      if (sample) {
        valid++;
        totalWeight += sample.w;
        sumW2 += sample.w * sample.w;
        for (let i = 0; i < CELLS; i++) {
          if (sample.occ[i] && board[i] === UNKNOWN) counts[i] += sample.w;
        }
        if (storedOcc.length < MC_STORE_LIMIT) {
          storedOcc.push(sample.occ);
          storedW.push(sample.w);
        }
      }
    }
  }
  let exact = true;
  const probs = new Array(CELLS).fill(0);
  if (totalWeight > 0) {
    for (let i = 0; i < CELLS; i++) {
      if (board[i] === UNKNOWN) probs[i] = counts[i] / totalWeight;
    }
  } else {
    exact = false;
    method = "heuristic";
    const HIT_BONUS = 25;
    const weights = new Float64Array(CELLS);
    for (const L of uniqueLens) {
      for (const cells of validByLen.get(L)) {
        let hits = 0;
        for (const c of cells) if (board[c] === HIT) hits++;
        if (hitCells.length > 0 && hits === 0) continue;
        const w = 1 + hits * HIT_BONUS;
        for (const c of cells) {
          if (board[c] === UNKNOWN) weights[c] += w;
        }
      }
    }
    let max = 0;
    for (let i = 0; i < CELLS; i++) if (weights[i] > max) max = weights[i];
    if (max > 0) {
      for (let i = 0; i < CELLS; i++) probs[i] = weights[i] / max;
    } else {
      return { ...emptyResult("inconsistent"), attempts };
    }
  }
  let best = null;
  let bestP = 0;
  const ranked = [];
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== UNKNOWN || probs[i] <= 0) continue;
    ranked.push({ idx: i, p: probs[i] });
    if (probs[i] > bestP) {
      bestP = probs[i];
      best = i;
    }
  }
  ranked.sort((a, b) => b.p - a.p);
  let policy = "maxprob";
  let expectedShots = null;
  if (method === "enumerated" && enumResult?.configs && enumResult.configs.length > 1 && enumResult.configs.length <= EXPECTIMAX_MAX_CONFIGS) {
    const em = expectimaxBest(enumResult.configs, board);
    if (em && board[em.best] === UNKNOWN) {
      best = em.best;
      policy = "expectimax";
      expectedShots = em.expected;
    }
  }
  if (policy === "maxprob" && method === "montecarlo" && best !== null && storedOcc.length > 200) {
    const minAlive = remaining.length > 0 ? Math.max(2, Math.min(...remaining)) : 2;
    const classShots = new Array(minAlive).fill(0);
    for (let i = 0; i < CELLS; i++) {
      if (board[i] !== UNKNOWN) classShots[(rowOf(i) + colOf(i)) % minAlive]++;
    }
    let skewClass = 0;
    for (let k = 1; k < minAlive; k++) {
      if (classShots[k] > classShots[skewClass]) skewClass = k;
    }
    const onLattice = (c) => (rowOf(c) + colOf(c)) % minAlive === skewClass;
    const cands = ranked.filter((r) => r.p >= bestP - TIEBREAK_EPS).slice(0, TIEBREAK_TOP);
    if (cands.length > 1) {
      let storedTotal = 0;
      const storedCounts = new Float64Array(CELLS);
      for (let s = 0; s < storedOcc.length; s++) {
        storedTotal += storedW[s];
        const occ = storedOcc[s];
        for (let i = 0; i < CELLS; i++) {
          if (occ[i] && board[i] === UNKNOWN) storedCounts[i] += storedW[s];
        }
      }
      let bestScore = -1;
      let bestIdx = best;
      const condCounts = new Float64Array(CELLS);
      for (const cand of cands) {
        const c = cand.idx;
        condCounts.fill(0);
        let wHit = 0;
        for (let s = 0; s < storedOcc.length; s++) {
          const occ = storedOcc[s];
          if (!occ[c]) continue;
          wHit += storedW[s];
          for (let i = 0; i < CELLS; i++) {
            if (occ[i] && board[i] === UNKNOWN) condCounts[i] += storedW[s];
          }
        }
        const wMiss = storedTotal - wHit;
        let maxHit = 0;
        let maxMiss = 0;
        for (let i = 0; i < CELLS; i++) {
          if (i === c || board[i] !== UNKNOWN) continue;
          if (wHit > 0) {
            const ph = condCounts[i] / wHit;
            if (ph > maxHit) maxHit = ph;
          }
          if (wMiss > 0) {
            const pm = (storedCounts[i] - condCounts[i]) / wMiss;
            if (pm > maxMiss) maxMiss = pm;
          }
        }
        const q = storedTotal > 0 ? wHit / storedTotal : 0;
        let score = q * (1 + maxHit) + (1 - q) * maxMiss;
        if (hitCells.length === 0 && onLattice(c)) score += SKEW_BONUS;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = c;
        }
      }
      if (bestIdx !== best) {
        best = bestIdx;
      }
      policy = "lookahead";
    }
  }
  const impossible = new Array(CELLS).fill(false);
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== UNKNOWN) continue;
    if (!staticPossible[i]) impossible[i] = true;
    else if (method === "enumerated" && counts[i] === 0) impossible[i] = true;
  }
  const effectiveSamples = method === "montecarlo" && sumW2 > 0 ? totalWeight * totalWeight / sumW2 : valid;
  let mode;
  if (best === null) mode = "inconsistent";
  else if (hitCells.length > 0) mode = "target";
  else mode = "hunt";
  return {
    probs,
    best,
    top: ranked.slice(0, 5),
    validSamples: valid,
    attempts,
    mode,
    remaining,
    destroyed,
    impossible,
    exact,
    method,
    effectiveSamples: Math.round(effectiveSamples),
    policy,
    expectedShots
  };
}
function tryEnumerate(remaining, validByLen, baseBlocked, board, hitCells, nt, limit) {
  const n = remaining.length;
  if (n === 0) return { counts: new Float64Array(CELLS), total: 1, nodes: 0, configs: [] };
  let estimate = 1;
  const groupSize = /* @__PURE__ */ new Map();
  for (const L of remaining) groupSize.set(L, (groupSize.get(L) ?? 0) + 1);
  for (const [L, g] of groupSize) {
    const c = validByLen.get(L).length;
    if (c === 0) return { counts: new Float64Array(CELLS), total: 0, nodes: 0, configs: [] };
    let f = 1;
    for (let k = 0; k < g; k++) f *= c;
    let fact = 1;
    for (let k = 2; k <= g; k++) fact *= k;
    estimate *= f / fact;
    if (estimate > limit) return null;
  }
  const isHit = new Uint8Array(CELLS);
  for (const h of hitCells) isHit[h] = 1;
  const blockCount = new Int16Array(CELLS);
  const counts = new Float64Array(CELLS);
  const chosen = [];
  const cfgs = [];
  let collect = true;
  let total = 0;
  let nodes = 0;
  let uncoveredHits = hitCells.length;
  const suffixLen = new Array(n + 1).fill(0);
  for (let k = n - 1; k >= 0; k--) suffixLen[k] = suffixLen[k + 1] + remaining[k];
  const isBlocked = (c) => baseBlocked[c] === 1 || blockCount[c] > 0;
  const placeEnum = (cells) => {
    let covered = 0;
    for (const c of cells) {
      blockCount[c]++;
      if (isHit[c]) covered++;
    }
    if (nt) {
      for (const c of cells) for (const nb of neighbors8(c)) blockCount[nb]++;
    }
    uncoveredHits -= covered;
    return covered;
  };
  const unplaceEnum = (cells, covered) => {
    for (const c of cells) blockCount[c]--;
    if (nt) {
      for (const c of cells) for (const nb of neighbors8(c)) blockCount[nb]--;
    }
    uncoveredHits += covered;
  };
  let aborted = false;
  const dfs = (k, prevIdxSameLen) => {
    if (aborted) return;
    if (nodes++ > limit * 4) {
      aborted = true;
      return;
    }
    if (k === n) {
      if (uncoveredHits === 0) {
        total++;
        for (const cells of chosen) {
          for (const c of cells) {
            if (board[c] === UNKNOWN) counts[c]++;
          }
        }
        if (collect) {
          if (total <= EXPECTIMAX_MAX_CONFIGS) cfgs.push(chosen.slice());
          else {
            collect = false;
            cfgs.length = 0;
          }
        }
      }
      return;
    }
    if (uncoveredHits > suffixLen[k]) return;
    const L = remaining[k];
    const cand = validByLen.get(L);
    const start = k > 0 && remaining[k - 1] === L ? prevIdxSameLen + 1 : 0;
    for (let ci = start; ci < cand.length; ci++) {
      const cells = cand[ci];
      let ok = true;
      for (const c of cells) {
        if (isBlocked(c)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const covered = placeEnum(cells);
      chosen.push(cells);
      dfs(k + 1, ci);
      chosen.pop();
      unplaceEnum(cells, covered);
      if (aborted) return;
    }
  };
  dfs(0, -1);
  if (aborted) return null;
  return { counts, total, nodes, configs: collect ? cfgs : null };
}
var EXPECTIMAX_ABORT = /* @__PURE__ */ Symbol("expectimax-abort");
function expectimaxBest(configs, board) {
  const shipOf = configs.map((cfg) => {
    const m = new Int8Array(CELLS).fill(-1);
    for (let si = 0; si < cfg.length; si++) {
      for (const c of cfg[si]) m[c] = si;
    }
    return m;
  });
  const hits = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) if (board[i] === HIT) hits[i] = 1;
  let nodes = 0;
  const memo = /* @__PURE__ */ new Map();
  const remCells = (k) => {
    let r = 0;
    for (const ship of configs[k]) for (const c of ship) if (!hits[c]) r++;
    return r;
  };
  const lowerBound = (alive) => {
    let sum = 0;
    for (const k of alive) sum += remCells(k);
    return sum / alive.length;
  };
  const stateKey = (alive) => {
    let hk = "";
    for (let i = 0; i < CELLS; i++) if (hits[i]) hk += i + ",";
    return alive.join(",") + "|" + hk;
  };
  const solve = (alive) => {
    if (alive.length === 1) return remCells(alive[0]);
    if (nodes++ > EXPECTIMAX_NODE_CAP) throw EXPECTIMAX_ABORT;
    const key = stateKey(alive);
    const cached = memo.get(key);
    if (cached !== void 0) return cached;
    const occCount = new Float64Array(CELLS);
    for (const k of alive) {
      const so = shipOf[k];
      for (let c = 0; c < CELLS; c++) {
        if (so[c] >= 0 && !hits[c]) occCount[c]++;
      }
    }
    const candidates = [];
    for (let c = 0; c < CELLS; c++) if (occCount[c] > 0) candidates.push(c);
    candidates.sort((a, b) => occCount[b] - occCount[a]);
    let bestE = Infinity;
    for (const c of candidates) {
      const missGroup = [];
      const groups = /* @__PURE__ */ new Map();
      for (const k of alive) {
        const si = shipOf[k][c];
        if (si < 0) {
          missGroup.push(k);
          continue;
        }
        const ship = configs[k][si];
        let sunk = true;
        for (const cc of ship) {
          if (cc !== c && !hits[cc]) {
            sunk = false;
            break;
          }
        }
        const sig = sunk ? "S" + ship.length : "H";
        const g = groups.get(sig);
        if (g) g.push(k);
        else groups.set(sig, [k]);
      }
      hits[c] = 1;
      let optimistic = 1;
      if (missGroup.length) {
        optimistic += missGroup.length / alive.length * lowerBound(missGroup);
      }
      for (const g of groups.values()) {
        optimistic += g.length / alive.length * lowerBound(g);
      }
      if (optimistic >= bestE) {
        hits[c] = 0;
        continue;
      }
      let e = 1;
      for (const g of groups.values()) {
        e += g.length / alive.length * (g.length === 1 ? remCells(g[0]) : solve(g));
        if (e >= bestE) break;
      }
      hits[c] = 0;
      if (e < bestE && missGroup.length) {
        e += missGroup.length / alive.length * (missGroup.length === 1 ? remCells(missGroup[0]) : solve(missGroup));
      }
      if (e < bestE) bestE = e;
    }
    memo.set(key, bestE);
    return bestE;
  };
  try {
    const all = configs.map((_, k) => k);
    let anyRem = false;
    for (const k of all) {
      if (remCells(k) > 0) {
        anyRem = true;
        break;
      }
    }
    if (!anyRem) return null;
    const occCount = new Float64Array(CELLS);
    for (const k of all) {
      const so = shipOf[k];
      for (let c = 0; c < CELLS; c++) if (so[c] >= 0 && !hits[c]) occCount[c]++;
    }
    const candidates = [];
    for (let c = 0; c < CELLS; c++) if (occCount[c] > 0) candidates.push(c);
    candidates.sort((a, b) => occCount[b] - occCount[a]);
    let bestCell = -1;
    let bestE = Infinity;
    for (const c of candidates) {
      const missGroup = [];
      const groups = /* @__PURE__ */ new Map();
      for (const k of all) {
        const si = shipOf[k][c];
        if (si < 0) {
          missGroup.push(k);
          continue;
        }
        const ship = configs[k][si];
        let sunk = true;
        for (const cc of ship) {
          if (cc !== c && !hits[cc]) {
            sunk = false;
            break;
          }
        }
        const sig = sunk ? "S" + ship.length : "H";
        const g = groups.get(sig);
        if (g) g.push(k);
        else groups.set(sig, [k]);
      }
      hits[c] = 1;
      let e = 1;
      for (const g of groups.values()) {
        e += g.length / all.length * (g.length === 1 ? remCells(g[0]) : solve(g));
        if (e >= bestE) break;
      }
      hits[c] = 0;
      if (e < bestE && missGroup.length) {
        e += missGroup.length / all.length * (missGroup.length === 1 ? remCells(missGroup[0]) : solve(missGroup));
      }
      if (e < bestE) {
        bestE = e;
        bestCell = c;
      }
    }
    if (bestCell < 0) return null;
    return { best: bestCell, expected: bestE };
  } catch (err) {
    if (err === EXPECTIMAX_ABORT) return null;
    throw err;
  }
}

// scripts/simulate.ts
function mulberry322(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function placeFleet(rules, rng) {
  const fleet = FLEETS[rules];
  const noTouch = rules === "russian";
  outer: for (let attempt = 0; attempt < 2e3; attempt++) {
    const blocked = new Uint8Array(CELLS);
    const overlap = new Uint8Array(CELLS);
    const ships = [];
    for (const len of fleet) {
      let placed = false;
      for (let tries = 0; tries < 300; tries++) {
        const horiz = rng() < 0.5;
        const r = Math.floor(rng() * (horiz ? SIZE : SIZE - len + 1));
        const c = Math.floor(rng() * (horiz ? SIZE - len + 1 : SIZE));
        const cells = [];
        let ok = true;
        for (let k = 0; k < len; k++) {
          const i = (horiz ? r : r + k) * SIZE + (horiz ? c + k : c);
          if (overlap[i] || noTouch && blocked[i]) {
            ok = false;
            break;
          }
          cells.push(i);
        }
        if (!ok) continue;
        ships.push(cells);
        for (const i of cells) {
          overlap[i] = 1;
          blocked[i] = 1;
          if (noTouch) for (const n of neighbors8(i)) blocked[n] = 1;
        }
        placed = true;
        break;
      }
      if (!placed) continue outer;
    }
    return ships;
  }
  throw new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0440\u0430\u0437\u043C\u0435\u0441\u0442\u0438\u0442\u044C \u0444\u043B\u043E\u0442 (\u043D\u0435 \u0434\u043E\u043B\u0436\u043D\u043E \u043F\u0440\u043E\u0438\u0441\u0445\u043E\u0434\u0438\u0442\u044C)");
}
function playGame(rules, seed, samples, budget) {
  const rng = mulberry322(seed);
  const ships = placeFleet(rules, rng);
  const owner = new Int16Array(CELLS).fill(-1);
  ships.forEach((s, si) => s.forEach((c) => owner[c] = si));
  const hitsLeft = ships.map((s) => s.length);
  const board = new Array(CELLS).fill(UNKNOWN);
  const sunkShips = [];
  let alive = ships.length;
  let shots = 0;
  while (alive > 0) {
    const a = analyze(board, rules, sunkShips, {
      targetSamples: samples,
      timeBudgetMs: budget,
      maxAttempts: samples * 20
    });
    let target = a.best;
    if (target === null || board[target] !== UNKNOWN) {
      target = board.findIndex((s, i) => s === UNKNOWN && !a.impossible[i]);
      if (target < 0) target = board.indexOf(UNKNOWN);
      if (target < 0) throw new Error("\u041D\u0435\u0442 \u043A\u043B\u0435\u0442\u043E\u043A \u0434\u043B\u044F \u0432\u044B\u0441\u0442\u0440\u0435\u043B\u0430");
    }
    shots++;
    const o = owner[target];
    if (o === -1) {
      board[target] = MISS;
    } else {
      board[target] = HIT;
      if (--hitsLeft[o] === 0) {
        for (const c of ships[o]) board[c] = SUNK;
        sunkShips.push([...ships[o]]);
        alive--;
      }
    }
    if (shots > CELLS) throw new Error("\u0411\u043E\u043B\u044C\u0448\u0435 100 \u0432\u044B\u0441\u0442\u0440\u0435\u043B\u043E\u0432 \u2014 \u0431\u0430\u0433 \u0434\u0432\u0438\u0436\u043A\u0430");
  }
  return shots;
}
if (!isMainThread) {
  const { rules, seeds, samples, budget } = workerData;
  const results = new Uint8Array(seeds.length);
  const PROGRESS_EVERY = 50;
  for (let g = 0; g < seeds.length; g++) {
    results[g] = playGame(rules, seeds[g], samples, budget);
    if ((g + 1) % PROGRESS_EVERY === 0) {
      parentPort.postMessage({ type: "progress", done: PROGRESS_EVERY });
    }
  }
  parentPort.postMessage(
    { type: "done", results, rest: seeds.length % PROGRESS_EVERY },
    [results.buffer]
  );
}
function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (name, def) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  const rulesArg = get("rules", "russian");
  return {
    games: parseInt(get("games", "100000"), 10),
    workers: parseInt(get("workers", String(os.cpus().length)), 10),
    rules: rulesArg === "both" ? "russian" : rulesArg,
    samples: parseInt(get("samples", "1200"), 10),
    budget: parseInt(get("budget", "30"), 10),
    seed: parseInt(get("seed", "42"), 10)
  };
}
function stats(all) {
  all.sort((a, b) => a - b);
  const n = all.length;
  const sum = all.reduce((s, x) => s + x, 0);
  const mean = sum / n;
  const variance = all.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const pct = (p) => all[Math.min(n - 1, Math.floor(p / 100 * n))];
  return {
    n,
    mean,
    std: Math.sqrt(variance),
    min: all[0],
    max: all[n - 1],
    p5: pct(5),
    p25: pct(25),
    median: pct(50),
    p75: pct(75),
    p95: pct(95),
    p99: pct(99)
  };
}
function histogram(all, width = 50) {
  const counts = /* @__PURE__ */ new Map();
  for (const x of all) counts.set(x, (counts.get(x) ?? 0) + 1);
  const keys = [...counts.keys()].sort((a, b) => a - b);
  const maxCount = Math.max(...counts.values());
  const lines = [];
  for (const k of keys) {
    const c = counts.get(k);
    const bar = "#".repeat(Math.max(1, Math.round(c / maxCount * width)));
    const pctStr = (c / all.length * 100).toFixed(1).padStart(5);
    lines.push(`  ${String(k).padStart(3)} | ${pctStr}% ${bar}`);
  }
  return lines.join("\n");
}
async function runPool(rules, opts) {
  const { games, workers, samples, budget, seed } = opts;
  const seedRng = mulberry322(seed ^ (rules === "russian" ? 0 : 1597463007));
  const seeds = Array.from(
    { length: games },
    () => Math.floor(seedRng() * 4294967295)
  );
  const perWorker = Math.ceil(games / workers);
  const chunks = [];
  for (let w = 0; w < workers; w++) {
    const chunk = seeds.slice(w * perWorker, (w + 1) * perWorker);
    if (chunk.length > 0) chunks.push(chunk);
  }
  let done = 0;
  const t0 = Date.now();
  const all = [];
  const tick = () => {
    const elapsed = (Date.now() - t0) / 1e3;
    const rate = done / Math.max(elapsed, 1e-3);
    const eta = rate > 0 ? (games - done) / rate : 0;
    process.stdout.write(
      `\r  [${rules}] ${done}/${games} \u0431\u043E\u0451\u0432 | ${rate.toFixed(0)} \u0431\u043E\u0451\u0432/\u0441 | ETA ${Math.ceil(eta)}\u0441   `
    );
  };
  await Promise.all(
    chunks.map(
      (chunk) => new Promise((resolve, reject) => {
        const worker = new Worker(fileURLToPath(import.meta.url), {
          workerData: {
            rules,
            seeds: chunk,
            samples,
            budget
          }
        });
        worker.on("message", (msg) => {
          if (msg.type === "progress") {
            done += msg.done;
            tick();
          } else if (msg.type === "done") {
            done += msg.rest;
            for (const x of msg.results) all.push(x);
            tick();
            resolve();
          }
        });
        worker.on("error", reject);
        worker.on("exit", (code) => {
          if (code !== 0) reject(new Error(`\u0412\u043E\u0440\u043A\u0435\u0440 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043B\u0441\u044F \u0441 \u043A\u043E\u0434\u043E\u043C ${code}`));
        });
      })
    )
  );
  process.stdout.write("\n");
  return all;
}
function report(rules, all, elapsedS) {
  const s = stats(all);
  const fleet = FLEETS[rules];
  const totalDeck = fleet.reduce((a, b) => a + b, 0);
  console.log("");
  console.log(`==== \u0420\u0415\u0417\u0423\u041B\u042C\u0422\u0410\u0422\u042B [${rules}] ====`);
  console.log(`  \u0411\u043E\u0451\u0432:            ${s.n}`);
  console.log(`  \u0424\u043B\u043E\u0442:            ${fleet.join("-")} (${totalDeck} \u043F\u0430\u043B\u0443\u0431)`);
  console.log(`  \u0421\u0440\u0435\u0434\u043D\u0435\u0435:         ${s.mean.toFixed(3)} \u0432\u044B\u0441\u0442\u0440\u0435\u043B\u043E\u0432`);
  console.log(`  \u0421\u0442. \u043E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0438\u0435:  ${s.std.toFixed(3)}`);
  console.log(`  \u041C\u0435\u0434\u0438\u0430\u043D\u0430:         ${s.median}`);
  console.log(`  \u041C\u0438\u043D / \u041C\u0430\u043A\u0441:      ${s.min} / ${s.max}`);
  console.log(
    `  \u041F\u0435\u0440\u0446\u0435\u043D\u0442\u0438\u043B\u0438:      p5=${s.p5}  p25=${s.p25}  p75=${s.p75}  p95=${s.p95}  p99=${s.p99}`
  );
  console.log(
    `  \u0422\u043E\u0447\u043D\u043E\u0441\u0442\u044C \u043E\u0433\u043D\u044F:   ${(totalDeck / s.mean * 100).toFixed(1)}% \u043F\u043E\u043F\u0430\u0434\u0430\u043D\u0438\u0439 \u0432 \u0441\u0440\u0435\u0434\u043D\u0435\u043C`
  );
  console.log(`  \u0412\u0440\u0435\u043C\u044F:           ${elapsedS.toFixed(1)}\u0441 (${(s.n / elapsedS).toFixed(1)} \u0431\u043E\u0451\u0432/\u0441)`);
  console.log("");
  console.log("  \u0420\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u0435 (\u0432\u044B\u0441\u0442\u0440\u0435\u043B\u043E\u0432 \u0434\u043E \u043F\u043E\u0431\u0435\u0434\u044B):");
  console.log(histogram(all));
  const counts = {};
  for (const x of all) counts[x] = (counts[x] ?? 0) + 1;
  console.log(`RAWCOUNTS ${rules} ${JSON.stringify(counts)}`);
}
async function main() {
  const opts = parseArgs();
  const rulesArg = process.argv.includes("both") ? ["russian", "international"] : [opts.rules];
  console.log("\u0410\u0414\u041C\u0418\u0420\u0410\u041B_ \u2014 \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043E\u0447\u043D\u044B\u0439 \u043F\u043E\u043B\u0438\u0433\u043E\u043D");
  console.log(
    `  \u0431\u043E\u0451\u0432: ${opts.games} | \u043F\u043E\u0442\u043E\u043A\u043E\u0432: ${opts.workers} | \u0441\u044D\u043C\u043F\u043B\u043E\u0432/\u0445\u043E\u0434: ${opts.samples} | \u0431\u044E\u0434\u0436\u0435\u0442: ${opts.budget}\u043C\u0441 | \u0441\u0438\u0434: ${opts.seed}`
  );
  console.log("");
  for (const rules of rulesArg) {
    const t0 = Date.now();
    const all = await runPool(rules, opts);
    report(rules, all, (Date.now() - t0) / 1e3);
  }
}
if (isMainThread) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
