// Вероятностный движок для игры «Морской бой».
//
// Три уровня расчёта (по убыванию точности):
//  1. Точный перебор всех допустимых расстановок (эндшпиль, пространство мало) — точные вероятности.
//  2. Монте-Карло с importance-весами (SIS): каждая сгенерированная расстановка учитывается
//     с весом, равным произведению числа доступных вариантов на каждом шаге построения, —
//     это устраняет смещение последовательного сэмплирования.
//  3. Эвристика плотности размещений — запасной режим, если валидные расстановки не найдены.
//
// Ключевые инварианты:
//  - У живого (не потопленного) корабля есть хотя бы одна необстрелянная клетка:
//    корабль, все клетки которого «ранены», был бы объявлен убитым. (Исправление К-1)
//  - Потопленные корабли передаются явным списком клеток (sunkShips), а не выводятся
//    заливкой из доски: в международных правилах потопленные корабли могут соприкасаться
//    и заливка бы их слипала. (Исправление К-2)
//  - «Точно пусто» — доказуемое утверждение: ни одно допустимое размещение ни одного
//    оставшегося корабля не покрывает клетку. (Исправление В-2)

export const SIZE = 10
export const CELLS = SIZE * SIZE

export const UNKNOWN = 0
export const MISS = 1
export const HIT = 2
export const SUNK = 3

export type RulesMode = 'russian' | 'international'

export const FLEETS: Record<RulesMode, number[]> = {
  // Русские правила: 1×4, 2×3, 3×2, 4×1; корабли не касаются даже углами
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

/** Клетки образуют прямую непрерывную линию (форма настоящего корабля) */
export function isStraightLine(cells: number[]): boolean {
  if (cells.length === 0) return false
  if (cells.length === 1) return true
  const rows = cells.map(rowOf)
  const cols = cells.map(colOf)
  const sameRow = rows.every((r) => r === rows[0])
  const sameCol = cols.every((c) => c === cols[0])
  if (!sameRow && !sameCol) return false
  const axis = (sameRow ? cols : rows).slice().sort((a, b) => a - b)
  for (let k = 1; k < axis.length; k++) {
    if (axis[k] !== axis[k - 1] + 1) return false
  }
  return true
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

export function floodClusters(board: ArrayLike<number>, state: number): number[][] {
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

// ---------- Параметры движка ----------

export interface EngineOptions {
  /** Целевое число валидных сэмплов Монте-Карло */
  targetSamples?: number
  /** Максимум попыток генерации (защита от тесных позиций) */
  maxAttempts?: number
  /** Бюджет времени на анализ, мс */
  timeBudgetMs?: number
  /** Верхняя оценка числа узлов, при которой включается точный перебор */
  enumLimit?: number
}

const DEFAULT_OPTIONS: Required<EngineOptions> = {
  targetSamples: 5000,
  maxAttempts: 80000,
  timeBudgetMs: 240,
  enumLimit: 150000,
}

/** Как часто проверять дедлайн (каждые N попыток) — Date.now() в цикле дорог */
const DEADLINE_CHECK_INTERVAL = 64

export type AnalysisMethod = 'enumerated' | 'montecarlo' | 'heuristic'

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
  /** Клетки, где корабля точно нет (доказано) */
  impossible: boolean[]
  /** true — вероятности расчётные (перебор или Монте-Карло); false — эвристика */
  exact: boolean
  /** Каким методом получены вероятности */
  method: AnalysisMethod
  /** Эффективный размер выборки (для Монте-Карло с весами) */
  effectiveSamples: number
}

/**
 * Главная функция анализа.
 * @param board — состояние поля (UNKNOWN/MISS/HIT/SUNK)
 * @param rules — набор правил
 * @param sunkShips — потопленные корабли явными списками клеток (обязательно для
 *   международных правил: заливка слипает соприкасающиеся корабли). Если не передано,
 *   корабли выводятся заливкой (безопасно только для русских правил).
 * @param options — параметры точности/времени
 */
export function analyze(
  board: number[],
  rules: RulesMode,
  sunkShips?: number[][] | null,
  options?: EngineOptions,
): Analysis {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const nt = rules === 'russian' // no-touch правило

  let inconsistent = false

  // 1. Потопленные корабли: явные (из UI) или заливкой (запасной путь)
  const ships: number[][] =
    sunkShips && sunkShips.length > 0 ? sunkShips : floodClusters(board, SUNK)

  // Валидация формы и согласованности с доской
  const sunkOwner = new Int16Array(CELLS).fill(-1)
  for (let s = 0; s < ships.length; s++) {
    if (!isStraightLine(ships[s])) inconsistent = true
    for (const c of ships[s]) {
      if (board[c] !== SUNK || sunkOwner[c] !== -1) inconsistent = true
      sunkOwner[c] = s
    }
  }
  for (let i = 0; i < CELLS; i++) {
    if (board[i] === SUNK && sunkOwner[i] === -1) inconsistent = true
  }
  // Русские правила: потопленные корабли не могут касаться друг друга
  if (nt) {
    for (let i = 0; i < CELLS; i++) {
      if (sunkOwner[i] === -1) continue
      for (const n of neighbors8(i)) {
        if (sunkOwner[n] !== -1 && sunkOwner[n] !== sunkOwner[i]) inconsistent = true
      }
    }
  }

  const destroyed = ships.map((s) => s.length).sort((a, b) => b - a)
  const fleet = [...FLEETS[rules]]
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
    method: 'enumerated',
    effectiveSamples: 0,
  })

  if (inconsistent) return emptyResult('inconsistent')
  if (remaining.length === 0 && hitCells.length === 0) return emptyResult('won')
  if (remaining.length === 0 && hitCells.length > 0) return emptyResult('inconsistent')

  // 4. Префильтрация размещений: совместимы с baseBlocked и имеют хотя бы одну
  //    необстрелянную клетку (К-1: живой корабль не может состоять из одних ранений).
  const uniqueLens = [...new Set(remaining)]
  const validByLen = new Map<number, number[][]>()
  for (const L of uniqueLens) {
    const list: number[][] = []
    for (const cells of placementsFor(L)) {
      let ok = true
      let hasUnknown = false
      for (const c of cells) {
        if (baseBlocked[c]) {
          ok = false
          break
        }
        if (board[c] === UNKNOWN) hasUnknown = true
      }
      if (ok && hasUnknown) list.push(cells)
    }
    validByLen.set(L, list)
  }

  // Покрытия по клеткам (для фазы добивания)
  const coveringByLen = new Map<number, number[][][]>()
  for (const L of uniqueLens) {
    const map: number[][][] = Array.from({ length: CELLS }, () => [])
    for (const cells of validByLen.get(L) as number[][]) {
      for (const c of cells) map[c].push(cells)
    }
    coveringByLen.set(L, map)
  }

  // В-2: «точно пусто» — доказуемо: клетку не покрывает ни одно валидное размещение
  const staticPossible = new Uint8Array(CELLS)
  for (const L of uniqueLens) {
    for (const cells of validByLen.get(L) as number[][]) {
      for (const c of cells) staticPossible[c] = 1
    }
  }

  // 5. Сид ГПСЧ из позиции — рекомендации стабильны для одной и той же позиции
  let seed = rules === 'russian' ? 0x9e3779b9 : 0x85ebca6b
  for (let i = 0; i < CELLS; i++) seed = (Math.imul(seed, 31) + board[i] + 1) | 0
  const rng = mulberry32(seed)

  // ---------- Точный перебор (эндшпиль) ----------

  const enumResult = tryEnumerate(
    remaining,
    validByLen,
    baseBlocked,
    board,
    hitCells,
    nt,
    opts.enumLimit,
  )

  const counts = new Float64Array(CELLS)
  let totalWeight = 0
  let sumW2 = 0
  let valid = 0
  let attempts = 0
  let method: AnalysisMethod = 'montecarlo'

  if (enumResult) {
    method = 'enumerated'
    counts.set(enumResult.counts)
    totalWeight = enumResult.total
    valid = enumResult.total
    attempts = enumResult.nodes
    sumW2 = enumResult.total
  } else {
    // ---------- Монте-Карло с importance-весами (SIS) ----------
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

    // Одна попытка построить полную допустимую расстановку.
    // Вес сэмпла = произведение числа доступных вариантов на каждом шаге —
    // классическая схема Sequential Importance Sampling, устраняющая смещение
    // последовательного размещения (В-1).
    const trySample = (): { occ: Uint8Array; w: number } | null => {
      const occupied = new Uint8Array(CELLS)
      const blocked = baseBlocked.slice()
      const pool = remaining.slice()
      let uncovered = hitCells.slice()
      let weight = 1

      // Фаза 1: раненые корабли — размещаем корабли, покрывающие все попадания
      while (uncovered.length) {
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
          const covering = (coveringByLen.get(L) as number[][][])[h]
          for (const cells of covering) {
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
        weight *= options.length
        const pick = options[(rng() * options.length) | 0]
        pool.splice(pick.li, 1)
        place(pick.cells, occupied, blocked)
        uncovered = uncovered.filter((c) => !occupied[c])
      }

      // Фаза 2: оставшиеся корабли — равномерный выбор из всех валидных позиций
      for (const L of pool) {
        const cand = validByLen.get(L) as number[][]
        const opts2: number[][] = []
        for (const cells of cand) {
          if (placeable(cells, blocked)) opts2.push(cells)
        }
        if (!opts2.length) return null
        weight *= opts2.length
        place(opts2[(rng() * opts2.length) | 0], occupied, blocked)
      }
      return { occ: occupied, w: weight }
    }

    const deadline = Date.now() + opts.timeBudgetMs
    while (valid < opts.targetSamples && attempts < opts.maxAttempts) {
      if (attempts % DEADLINE_CHECK_INTERVAL === 0 && Date.now() >= deadline) break
      attempts++
      const sample = trySample()
      if (sample) {
        valid++
        totalWeight += sample.w
        sumW2 += sample.w * sample.w
        for (let i = 0; i < CELLS; i++) {
          if (sample.occ[i] && board[i] === UNKNOWN) counts[i] += sample.w
        }
      }
    }
  }

  let exact = true
  const probs = new Array<number>(CELLS).fill(0)

  if (totalWeight > 0) {
    for (let i = 0; i < CELLS; i++) {
      if (board[i] === UNKNOWN) probs[i] = counts[i] / totalWeight
    }
  } else {
    // ---------- Эвристика плотности размещений (запасной режим) ----------
    exact = false
    method = 'heuristic'
    const HIT_BONUS = 25 // усиление размещений, проходящих через ранения
    const weights = new Float64Array(CELLS)
    for (const L of uniqueLens) {
      for (const cells of validByLen.get(L) as number[][]) {
        let hits = 0
        for (const c of cells) if (board[c] === HIT) hits++
        if (hitCells.length > 0 && hits === 0) continue
        const w = 1 + hits * HIT_BONUS
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

  // Рекомендация: клетка с максимальной вероятностью
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

  // «Точно пусто»: статическое доказательство (всегда корректно) +
  // нулевой счётчик при полном переборе (тоже доказательство)
  const impossible = new Array<boolean>(CELLS).fill(false)
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== UNKNOWN) continue
    if (!staticPossible[i]) impossible[i] = true
    else if (method === 'enumerated' && counts[i] === 0) impossible[i] = true
  }

  const effectiveSamples =
    method === 'montecarlo' && sumW2 > 0 ? (totalWeight * totalWeight) / sumW2 : valid

  let mode: Analysis['mode']
  if (best === null) mode = 'inconsistent'
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
    method,
    effectiveSamples: Math.round(effectiveSamples),
  }
}

// ---------- Точный перебор ----------

interface EnumResult {
  counts: Float64Array
  total: number
  nodes: number
}

/**
 * Полный перебор всех допустимых конфигураций оставшегося флота.
 * Запускается, только если верхняя оценка числа комбинаций не превышает limit.
 * Возвращает точные счётчики: counts[i] = число конфигураций с кораблём в клетке i.
 */
function tryEnumerate(
  remaining: number[],
  validByLen: Map<number, number[][]>,
  baseBlocked: Uint8Array,
  board: number[],
  hitCells: number[],
  nt: boolean,
  limit: number,
): EnumResult | null {
  const n = remaining.length
  if (n === 0) return { counts: new Float64Array(CELLS), total: 1, nodes: 0 }

  // Верхняя оценка: произведение числа кандидатов с поправкой на одинаковые длины
  let estimate = 1
  const groupSize = new Map<number, number>()
  for (const L of remaining) groupSize.set(L, (groupSize.get(L) ?? 0) + 1)
  for (const [L, g] of groupSize) {
    const c = (validByLen.get(L) as number[][]).length
    if (c === 0) return { counts: new Float64Array(CELLS), total: 0, nodes: 0 }
    // C(c, g) ≤ c^g / g!
    let f = 1
    for (let k = 0; k < g; k++) f *= c
    let fact = 1
    for (let k = 2; k <= g; k++) fact *= k
    estimate *= f / fact
    if (estimate > limit) return null
  }

  const isHit = new Uint8Array(CELLS)
  for (const h of hitCells) isHit[h] = 1

  const blockCount = new Int16Array(CELLS)
  const counts = new Float64Array(CELLS)
  const chosen: number[][] = []
  let total = 0
  let nodes = 0
  let uncoveredHits = hitCells.length
  const suffixLen: number[] = new Array(n + 1).fill(0)
  for (let k = n - 1; k >= 0; k--) suffixLen[k] = suffixLen[k + 1] + remaining[k]

  const isBlocked = (c: number) => baseBlocked[c] === 1 || blockCount[c] > 0

  const placeEnum = (cells: number[]) => {
    let covered = 0
    for (const c of cells) {
      blockCount[c]++
      if (isHit[c]) covered++
    }
    if (nt) {
      for (const c of cells) for (const nb of neighbors8(c)) blockCount[nb]++
    }
    uncoveredHits -= covered
    return covered
  }

  const unplaceEnum = (cells: number[], covered: number) => {
    for (const c of cells) blockCount[c]--
    if (nt) {
      for (const c of cells) for (const nb of neighbors8(c)) blockCount[nb]--
    }
    uncoveredHits += covered
  }

  let aborted = false

  const dfs = (k: number, prevIdxSameLen: number) => {
    if (aborted) return
    if (nodes++ > limit * 4) {
      aborted = true
      return
    }
    if (k === n) {
      if (uncoveredHits === 0) {
        total++
        for (const cells of chosen) {
          for (const c of cells) {
            if (board[c] === UNKNOWN) counts[c]++
          }
        }
      }
      return
    }
    // Отсечение: оставшиеся корабли не смогут покрыть все ранения
    if (uncoveredHits > suffixLen[k]) return

    const L = remaining[k]
    const cand = validByLen.get(L) as number[][]
    // Дедупликация одинаковых длин: индексы кандидатов строго возрастают
    const start = k > 0 && remaining[k - 1] === L ? prevIdxSameLen + 1 : 0
    for (let ci = start; ci < cand.length; ci++) {
      const cells = cand[ci]
      let ok = true
      for (const c of cells) {
        if (isBlocked(c)) {
          ok = false
          break
        }
      }
      if (!ok) continue
      const covered = placeEnum(cells)
      chosen.push(cells)
      dfs(k + 1, ci)
      chosen.pop()
      unplaceEnum(cells, covered)
      if (aborted) return
    }
  }

  dfs(0, -1)
  if (aborted) return null
  return { counts, total, nodes }
}
