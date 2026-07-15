/**
 * Поиск оборонительной расстановки, максимально трудной для вероятностного охотника.
 *
 * Метод: генерируем кандидатов (анти-статистические схемы + случайный поиск),
 * каждую расстановку «вскрывает» наш движок — считаем число выстрелов до полного
 * уничтожения флота. Чем больше выстрелов, тем лучше оборона.
 * Партия детерминирована (сид движка зависит только от позиции), поэтому
 * одна партия на кандидата даёт точную оценку против этого класса атакующих.
 */
import {
  CELLS,
  HIT,
  MISS,
  SIZE,
  SUNK,
  UNKNOWN,
  analyze,
  cellName,
  colOf,
  rowOf,
  FLEETS,
} from '../lib/battleship-engine'

type Ship = number[]

const RULES = 'russian' as const
const FLEET = FLEETS[RULES]

// ---------- Валидация и генерация расстановок ----------

function shipCells(start: number, len: number, horizontal: boolean): Ship | null {
  const r = rowOf(start)
  const c = colOf(start)
  if (horizontal) {
    if (c + len > SIZE) return null
    return Array.from({ length: len }, (_, k) => start + k)
  }
  if (r + len > SIZE) return null
  return Array.from({ length: len }, (_, k) => start + k * SIZE)
}

/** Проверка: корабли в пределах поля и не касаются даже углами */
function isValidFleet(ships: Ship[]): boolean {
  const occ = new Set<number>()
  for (const ship of ships) {
    for (const cell of ship) {
      if (cell < 0 || cell >= CELLS) return false
      if (occ.has(cell)) return false
    }
    for (const cell of ship) occ.add(cell)
  }
  // Запрет касания: вокруг каждого корабля не должно быть чужих клеток
  for (const ship of ships) {
    const own = new Set(ship)
    for (const cell of ship) {
      const r = rowOf(cell)
      const c = colOf(cell)
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr
          const nc = c + dc
          if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue
          const n = nr * SIZE + nc
          if (occ.has(n) && !own.has(n)) return false
        }
      }
    }
  }
  return true
}

function randomFleet(rng: () => number): Ship[] | null {
  const ships: Ship[] = []
  const blocked = new Set<number>()
  for (const len of FLEET) {
    let placed = false
    for (let tries = 0; tries < 200 && !placed; tries++) {
      const start = Math.floor(rng() * CELLS)
      const horizontal = rng() < 0.5
      const cells = shipCells(start, len, horizontal)
      if (!cells) continue
      if (cells.some((c) => blocked.has(c))) continue
      ships.push(cells)
      for (const cell of cells) {
        const r = rowOf(cell)
        const c = colOf(cell)
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr
            const nc = c + dc
            if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) blocked.add(nr * SIZE + nc)
          }
        }
      }
      placed = true
    }
    if (!placed) return null
  }
  return ships
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- «Вскрытие» расстановки движком ----------

/** Клетка -> индекс корабля */
function buildOwnership(ships: Ship[]): Int8Array {
  const own = new Int8Array(CELLS).fill(-1)
  ships.forEach((ship, si) => {
    for (const c of ship) own[c] = si
  })
  return own
}

/** Сколько выстрелов нужно движку, чтобы уничтожить флот (детерминировано) */
function shotsToKill(ships: Ship[]): number {
  const own = buildOwnership(ships)
  const board: number[] = new Array(CELLS).fill(UNKNOWN)
  const hitsLeft = ships.map((s) => s.length)
  let aliveShips = ships.length
  let shots = 0

  while (aliveShips > 0 && shots < CELLS + 1) {
    const res = analyze(board, RULES, { targetSamples: 900, timeBudgetMs: 25 })
    const target = res.best
    if (target === null || board[target] !== UNKNOWN) {
      // Движок в тупике — не должно происходить на честной расстановке
      return -1
    }
    shots++
    const si = own[target]
    if (si < 0) {
      board[target] = MISS
    } else {
      board[target] = HIT
      hitsLeft[si]--
      if (hitsLeft[si] === 0) {
        aliveShips--
        for (const c of ships[si]) board[c] = SUNK
      }
    }
  }
  return shots
}

// ---------- Кандидаты: анти-статистические схемы ----------

/** Схема из имён клеток: [строкаБуква][столбецЦифра], строки А..К сверху вниз */
const L = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К']
function cell(name: string): number {
  const row = L.indexOf(name[0])
  const col = Number.parseInt(name.slice(1), 10) - 1
  return row * SIZE + col
}
function ship(...names: string[]): Ship {
  return names.map(cell)
}

/** Теоретические кандидаты: крупные корабли по краям, однопалубники враздрос */
const HANDCRAFTED: { label: string; ships: Ship[] }[] = [
  {
    // Классика анти-статистики: всё крупное прижато к границам,
    // однопалубники в углах оставшегося пустого пространства
    label: 'края+углы',
    ships: [
      ship('А1', 'Б1', 'В1', 'Г1'), // 4п вдоль левого края
      ship('А3', 'А4', 'А5'), // 3п вдоль верха
      ship('А7', 'А8', 'А9'),
      ship('Е1', 'Ж1'), // 2п левый край
      ship('И1', 'К1'),
      ship('К3', 'К4'), // 2п низ
      ship('В10'), // 1п по дальним краям
      ship('Е10'),
      ship('К10'),
      ship('К7'),
    ],
  },
  {
    // «Баржа» — весь крупный флот в одном углу, singles растянуты по диагонали
    label: 'угол+диагональ',
    ships: [
      ship('К1', 'К2', 'К3', 'К4'),
      ship('И6', 'И7', 'И8'), // ниже: строки И/К
      ship('З1', 'З2', 'З3'),
      ship('К6', 'К7'),
      ship('Е1', 'Е2'),
      ship('К9', 'К10'),
      ship('А1'),
      ship('А10'),
      ship('В5'),
      ship('Д10'),
    ],
  },
  {
    // Периметр: всё по кромке, центр полностью пуст (охотник тратит ходы на центр)
    label: 'периметр',
    ships: [
      ship('А4', 'А5', 'А6', 'А7'),
      ship('Г1', 'Д1', 'Е1'),
      ship('Г10', 'Д10', 'Е10'),
      ship('А1', 'Б1'),
      ship('А9', 'А10'),
      ship('К1', 'К2'),
      ship('К4'),
      ship('К6'),
      ship('К8'),
      ship('К10'),
    ],
  },
]

// ---------- Основной поиск ----------

function fmt(ships: Ship[]): string {
  return ships
    .map((s) => (s.length === 1 ? cellName(s[0]) : `${cellName(s[0])}–${cellName(s[s.length - 1])}`))
    .join(', ')
}

async function main() {
  const candidates: { label: string; ships: Ship[] }[] = []

  for (const hc of HANDCRAFTED) {
    if (!isValidFleet(hc.ships)) {
      console.log(`ОТБРАКОВАН (невалиден): ${hc.label}`)
      continue
    }
    candidates.push(hc)
  }

  // Случайный поиск с уклоном в края (анти-статистический прием)
  const rng = mulberry32(20260715)
  let added = 0
  while (added < 40) {
    const fleet = randomFleet(rng)
    if (!fleet || !isValidFleet(fleet)) continue
    candidates.push({ label: `random-${added + 1}`, ships: fleet })
    added++
  }

  console.log(`Кандидатов: ${candidates.length}. Оцениваю движком (детерминированно)...\n`)

  const results: { label: string; ships: Ship[]; shots: number }[] = []
  for (const cand of candidates) {
    const shots = shotsToKill(cand.ships)
    results.push({ label: cand.label, ships: cand.ships, shots })
    console.log(`${String(shots).padStart(3)} выстрелов — ${cand.label}`)
  }

  results.sort((a, b) => b.shots - a.shots)
  console.log('\n===== ТОП-5 самых живучих расстановок =====')
  for (const r of results.slice(0, 5)) {
    console.log(`\n[${r.shots} выстрелов] ${r.label}`)
    console.log(`  ${fmt(r.ships)}`)
  }

  // ASCII-схема лучшей
  const bst = results[0]
  const grid: string[][] = Array.from({ length: SIZE }, () => Array(SIZE).fill('·'))
  bst.ships.forEach((s) => {
    for (const c of s) grid[rowOf(c)][colOf(c)] = '■'
  })
  console.log(`\nЛучшая (${bst.shots} выстрелов):`)
  console.log('   1 2 3 4 5 6 7 8 9 10')
  grid.forEach((row, r) => console.log(` ${L[r]} ${row.join(' ')}`))
}

main()
