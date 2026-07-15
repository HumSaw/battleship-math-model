// Вероятностный движок для игры «Морской бой».
// Метод: Монте-Карло по полным допустимым расстановкам флота противника,
// согласованным со всеми известными фактами (промахи, попадания, потопленные корабли).
// Для каждой клетки считается вероятность присутствия корабля; рекомендуется
// выстрел с максимальным математическим ожиданием попадания.

export const SIZE = 10
export const CELLS = SIZE * SIZE

export const UNKNOWN = 0
export const MISS = 1
export const HIT = 2
export const SUNK = 3

export type RulesMode = 'russian' | 'international'

export const FLEETS: Record<RulesMode, number[]> = {
  // Русские правила: 1×4, 2×3, 3×2, 4×1; корабли не могут касаться даже углами
  russian: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1],
  // Международные (Hasbro): 5, 4, 3, 3, 2; касание разрешено
  international: [5, 4, 3, 3, 2],
}

export const COL_LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К']

export const rowOf = (i: number) => Math.floor(i / SIZE)
export const colOf = (i: number) => i % SIZE

export function cellName(i: number): string {
  return COL_LETTERS[colOf(i)] + String(rowOf(i) + 1)
}

export function neighbors8(i: number): number[] {
  const r = rowOf(i)
  const c = colOf(i)
  const out: number[] = []
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      const nr = r + dr
      const nc = c + dc
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) out.push(nr * SIZE + nc)
    }
  }
  return out
}

export function orthoNeighbors(i: number): number[] {
  const r = rowOf(i)
  const c = colOf(i)
  const out: number[] = []
  if (r > 0) out.push(i - SIZE)
  if (r < SIZE - 1) out.push(i + SIZE)
  if (c > 0) out.push(i - 1)
  if (c < SIZE - 1) out.push(i + 1)
  return out
}

function diagNeighbors(i: number): number[] {
  const r = rowOf(i)
  const c = colOf(i)
  const out: number[] = []
  for (const dr of [-1, 1]) {
    for (const dc of [-1, 1]) {
      const nr = r + dr
      const nc = c + dc
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) out.push(nr * SIZE + nc)
    }
  }
  return out
}

// ---------- Кэш всех возможных положений корабля длины L ----------

const placementsCache = new Map<number, number[][]>()

function placementsFor(len: number): number[][] {
  const cached = placementsCache.get(len)
  if (cached) return cached
  const list: number[][] = []
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c + len <= SIZE; c++) {
      const cells: number[] = []
      for (let k = 0; k < len; k++) cells.push(r * SIZE + c + k)
      list.push(cells)
    }
  }
  if (len > 1) {
    for (let c = 0; c < SIZE; c++) {
      for (let r = 0; r + len <= SIZE; r++) {
        const cells: number[] = []
        for (let k = 0; k < len; k++) cells.push((r + k) * SIZE + c)
        list.push(cells)
      }
    }
  }
  placementsCache.set(len, list)
  return list
}

const coveringCache = new Map<number, number[][][]>()

// Для длины L: по каждой клетке — список положений, покрывающих её
function coveringFor(len: number): number[][][] {
  const cached = coveringCache.get(len)
  if (cached) return cached
  const map: number[][][] = Array.from({ length: CELLS }, () => [])
  for (const cells of placementsFor(len)) {
    for (const c of cells) map[c].push(cells)
  }
  coveringCache.set(len, map)
  return map
}

// ---------- Детерминированный ГПСЧ (стабильные рекомендации между рендерами) ----------

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function floodClusters(board: number[], state: number): number[][] {
  const seen = new Uint8Array(CELLS)
  const clusters: number[][] = []
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== state || seen[i]) continue
    const cluster: number[] = []
    const stack = [i]
    seen[i] = 1
    while (stack.length) {
      const cur = stack.pop() as number
      cluster.push(cur)
      for (const n of orthoNeighbors(cur)) {
        if (board[n] === state && !seen[n]) {
          seen[n] = 1
          stack.push(n)
        }
      }
    }
    clusters.push(cluster)
  }
  return clusters
}

// ---------- Результат анализа ----------

export interface Analysis {
  /** Вероятность корабля в клетке (0..1). Для эвристики — относительный вес 0..1. */
  probs: number[]
  /** Лучшая клетка для выстрела */
  best: number | null
  /** Топ альтернатив */
  top: { idx: number; p: number }[]
  validSamples: number
  attempts: number
  mode: 'hunt' | 'target' | 'won' | 'inconsistent'
  remaining: number[]
  destroyed: number[]
  /** Клетки, где корабля точно нет (доказано перебором) */
  impossible: boolean[]
  /** true — вероятности Монте-Карло; false — эвристический запасной режим */
  exact: boolean
}

export function analyze(board: number[], rules: RulesMode): Analysis {
  const nt = rules === 'russian' // no-touch правило

  // 1. Потопленные корабли -> оставшийся флот
  const sunkClusters = floodClusters(board, SUNK)
  const destroyed = sunkClusters.map((c) => c.length).sort((a, b) => b - a)
  const fleet = [...FLEETS[rules]]
  let inconsistent = false
  for (const d of destroyed) {
    const ix = fleet.indexOf(d)
    if (ix === -1) inconsistent = true
    else fleet.splice(ix, 1)
  }
  const remaining = fleet.sort((a, b) => b - a)
  const maxRemaining = remaining.length ? remaining[0] : 0

  // 2. Непотопленные попадания и их кластеры
  const hitCells: number[] = []
  for (let i = 0; i < CELLS; i++) if (board[i] === HIT) hitCells.push(i)

  const hitClusters = floodClusters(board, HIT)
  const clusterOf: (number[] | undefined)[] = new Array(CELLS)
  const collinearOf = new Uint8Array(CELLS)
  for (const cl of hitClusters) {
    const rows = new Set(cl.map(rowOf))
    const cols = new Set(cl.map(colOf))
    const collinear = rows.size === 1 || cols.size === 1
    if (nt && !collinear) inconsistent = true
    if (cl.length > maxRemaining) inconsistent = true
    for (const c of cl) {
      clusterOf[c] = cl
      collinearOf[c] = collinear ? 1 : 0
    }
  }

  // 3. Базовая карта запрещённых клеток
  const baseBlocked = new Uint8Array(CELLS)
  for (let i = 0; i < CELLS; i++) {
    if (board[i] === MISS || board[i] === SUNK) baseBlocked[i] = 1
  }
  if (nt) {
    for (let i = 0; i < CELLS; i++) {
      if (board[i] === SUNK) {
        for (const n of neighbors8(i)) if (board[n] !== SUNK) baseBlocked[n] = 1
      }
      if (board[i] === HIT) {
        for (const n of diagNeighbors(i)) baseBlocked[n] = 1
      }
    }
  }
  for (const h of hitCells) {
    if (baseBlocked[h]) inconsistent = true
  }

  const emptyResult = (mode: Analysis['mode']): Analysis => ({
    probs: new Array(CELLS).fill(0),
    best: null,
    top: [],
    validSamples: 0,
    attempts: 0,
    mode,
    remaining,
    destroyed,
    impossible: new Array(CELLS).fill(false),
    exact: true,
  })

  if (remaining.length === 0 && hitCells.length === 0) {
    return emptyResult(inconsistent ? 'inconsistent' : 'won')
  }

  // 4. Сид ГПСЧ из позиции — рекомендации стабильны для одной и той же позиции
  let seed = rules === 'russian' ? 0x9e3779b9 : 0x85ebca6b
  for (let i = 0; i < CELLS; i++) seed = (Math.imul(seed, 31) + board[i] + 1) | 0
  const rng = mulberry32(seed)

  const placeable = (cells: number[], blocked: Uint8Array): boolean => {
    for (const c of cells) if (blocked[c]) return false
    return true
  }

  const place = (cells: number[], occupied: Uint8Array, blocked: Uint8Array) => {
    for (const c of cells) {
      occupied[c] = 1
      blocked[c] = 1
    }
    if (nt) {
      for (const c of cells) for (const n of neighbors8(c)) blocked[n] = 1
    }
  }

  // 5. Одна попытка построить полную допустимую расстановку флота
  const trySample = (): Uint8Array | null => {
    const occupied = new Uint8Array(CELLS)
    const blocked = baseBlocked.slice()
    const pool = remaining.slice()
    let uncovered = hitCells.slice()
    let guard = 0

    // Фаза 1: раненые корабли — размещаем корабли, покрывающие все попадания
    while (uncovered.length) {
      if (guard++ > 24) return null
      const h = uncovered[(rng() * uncovered.length) | 0]
      const cl = clusterOf[h] as number[]
      const mustCoverAll = nt && collinearOf[h] === 1

      const options: { li: number; cells: number[] }[] = []
      const seenLen = new Set<number>()
      for (let li = 0; li < pool.length; li++) {
        const L = pool[li]
        if (seenLen.has(L)) continue
        seenLen.add(L)
        if (mustCoverAll && L < cl.length) continue
        for (const cells of coveringFor(L)[h]) {
          if (mustCoverAll) {
            let coversAll = true
            for (const c of cl) {
              if (!cells.includes(c)) {
                coversAll = false
                break
              }
            }
            if (!coversAll) continue
          }
          if (placeable(cells, blocked)) options.push({ li, cells })
        }
      }
      if (!options.length) return null
      const pick = options[(rng() * options.length) | 0]
      pool.splice(pick.li, 1)
      place(pick.cells, occupied, blocked)
      uncovered = uncovered.filter((c) => !occupied[c])
    }

    // Фаза 2: оставшиеся корабли — случайные допустимые позиции
    for (const L of pool) {
      const cand = placementsFor(L)
      let done = false
      for (let t = 0; t < 30 && !done; t++) {
        const cells = cand[(rng() * cand.length) | 0]
        if (placeable(cells, blocked)) {
          place(cells, occupied, blocked)
          done = true
        }
      }
      if (!done) {
        const opts = cand.filter((cells) => placeable(cells, blocked))
        if (!opts.length) return null
        place(opts[(rng() * opts.length) | 0], occupied, blocked)
      }
    }
    return occupied
  }

  // 6. Основной цикл Монте-Карло
  const counts = new Float64Array(CELLS)
  let valid = 0
  let attempts = 0
  const TARGET_SAMPLES = 3500
  const MAX_ATTEMPTS = 60000
  const deadline = Date.now() + 260

  while (valid < TARGET_SAMPLES && attempts < MAX_ATTEMPTS && Date.now() < deadline) {
    attempts++
    const occ = trySample()
    if (occ) {
      valid++
      for (let i = 0; i < CELLS; i++) {
        if (occ[i] && board[i] === UNKNOWN) counts[i]++
      }
    }
  }

  let exact = true
  const probs = new Array<number>(CELLS).fill(0)

  if (valid > 0) {
    for (let i = 0; i < CELLS; i++) {
      if (board[i] === UNKNOWN) probs[i] = counts[i] / valid
    }
  } else {
    // 7. Запасной режим: классическая эвристика плотности размещений
    exact = false
    const weights = new Float64Array(CELLS)
    for (const L of remaining) {
      for (const cells of placementsFor(L)) {
        let bad = false
        let hits = 0
        for (const c of cells) {
          if (baseBlocked[c]) {
            bad = true
            break
          }
          if (board[c] === HIT) hits++
        }
        if (bad) continue
        if (hitCells.length > 0 && hits === 0) continue
        const w = 1 + hits * 25
        for (const c of cells) {
          if (board[c] === UNKNOWN) weights[c] += w
        }
      }
    }
    let max = 0
    for (let i = 0; i < CELLS; i++) if (weights[i] > max) max = weights[i]
    if (max > 0) {
      for (let i = 0; i < CELLS; i++) probs[i] = weights[i] / max
    } else {
      return { ...emptyResult('inconsistent'), attempts }
    }
  }

  // 8. Рекомендация: клетка с максимальной вероятностью
  let best: number | null = null
  let bestP = 0
  const ranked: { idx: number; p: number }[] = []
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== UNKNOWN || probs[i] <= 0) continue
    ranked.push({ idx: i, p: probs[i] })
    if (probs[i] > bestP) {
      bestP = probs[i]
      best = i
    }
  }
  ranked.sort((a, b) => b.p - a.p)

  const impossible = new Array<boolean>(CELLS).fill(false)
  if (exact && valid > 0) {
    for (let i = 0; i < CELLS; i++) {
      if (board[i] === UNKNOWN && counts[i] === 0) impossible[i] = true
    }
  }

  let mode: Analysis['mode']
  if (inconsistent) mode = 'inconsistent'
  else if (best === null) mode = 'inconsistent'
  else if (hitCells.length > 0) mode = 'target'
  else mode = 'hunt'

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
  }
}
