/**
 * АДМИРАЛ_ — тренировочный полигон.
 *
 * Многопоточная симуляция боёв: движок играет против случайных честных
 * расстановок и считает, за сколько выстрелов топит весь флот.
 *
 * Запуск (после сборки в simulate.mjs, см. README внизу файла):
 *   node scripts/simulate.mjs --games 100000 --workers 20
 *
 * Флаги:
 *   --games N     число боёв (по умолчанию 100000)
 *   --workers N   число потоков (по умолчанию: все ядра)
 *   --rules R     russian | international | both (по умолчанию russian)
 *   --samples N   целевое число MC-сэмплов на ход (по умолчанию 1200)
 *   --budget MS   бюджет времени на ход, мс (по умолчанию 30)
 *   --seed N      базовый сид (по умолчанию 42) — результаты воспроизводимы
 */

import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

import {
  analyze,
  neighbors8,
  FLEETS,
  SIZE,
  CELLS,
  UNKNOWN,
  MISS,
  HIT,
  SUNK,
  type RulesMode,
} from '../lib/battleship-engine'

// ---------- Общее ----------

interface SimOptions {
  games: number
  workers: number
  rules: RulesMode
  samples: number
  budget: number
  seed: number
}

/** mulberry32 — быстрый детерминированный PRNG */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Случайная честная расстановка флота */
function placeFleet(rules: RulesMode, rng: () => number): number[][] {
  const fleet = FLEETS[rules]
  const noTouch = rules === 'russian'

  outer: for (let attempt = 0; attempt < 2000; attempt++) {
    const blocked = new Uint8Array(CELLS)
    const overlap = new Uint8Array(CELLS)
    const ships: number[][] = []

    for (const len of fleet) {
      let placed = false
      for (let tries = 0; tries < 300; tries++) {
        const horiz = rng() < 0.5
        const r = Math.floor(rng() * (horiz ? SIZE : SIZE - len + 1))
        const c = Math.floor(rng() * (horiz ? SIZE - len + 1 : SIZE))
        const cells: number[] = []
        let ok = true
        for (let k = 0; k < len; k++) {
          const i = (horiz ? r : r + k) * SIZE + (horiz ? c + k : c)
          if (overlap[i] || (noTouch && blocked[i])) {
            ok = false
            break
          }
          cells.push(i)
        }
        if (!ok) continue
        ships.push(cells)
        for (const i of cells) {
          overlap[i] = 1
          blocked[i] = 1
          if (noTouch) for (const n of neighbors8(i)) blocked[n] = 1
        }
        placed = true
        break
      }
      if (!placed) continue outer
    }
    return ships
  }
  throw new Error('Не удалось разместить флот (не должно происходить)')
}

/** Один бой: движок стреляет до полной победы. Возвращает число выстрелов. */
function playGame(
  rules: RulesMode,
  seed: number,
  samples: number,
  budget: number,
): number {
  const rng = mulberry32(seed)
  const ships = placeFleet(rules, rng)

  const owner = new Int16Array(CELLS).fill(-1)
  ships.forEach((s, si) => s.forEach((c) => (owner[c] = si)))
  const hitsLeft = ships.map((s) => s.length)

  const board: number[] = new Array(CELLS).fill(UNKNOWN)
  const sunkShips: number[][] = []
  let alive = ships.length
  let shots = 0

  while (alive > 0) {
    const a = analyze(board, rules, sunkShips, {
      targetSamples: samples,
      timeBudgetMs: budget,
      maxAttempts: samples * 20,
    })

    let target = a.best
    if (target === null || board[target] !== UNKNOWN) {
      // страховка: никогда не должно срабатывать на честной партии
      target = board.findIndex((s, i) => s === UNKNOWN && !a.impossible[i])
      if (target < 0) target = board.indexOf(UNKNOWN)
      if (target < 0) throw new Error('Нет клеток для выстрела')
    }

    shots++
    const o = owner[target]
    if (o === -1) {
      board[target] = MISS
    } else {
      board[target] = HIT
      if (--hitsLeft[o] === 0) {
        for (const c of ships[o]) board[c] = SUNK
        sunkShips.push([...ships[o]])
        alive--
      }
    }
    if (shots > CELLS) throw new Error('Больше 100 выстрелов — баг движка')
  }
  return shots
}

// ---------- Воркер ----------

interface WorkerInput {
  rules: RulesMode
  seeds: number[]
  samples: number
  budget: number
}

if (!isMainThread) {
  const { rules, seeds, samples, budget } = workerData as WorkerInput
  const results = new Uint8Array(seeds.length)
  const PROGRESS_EVERY = 50

  for (let g = 0; g < seeds.length; g++) {
    results[g] = playGame(rules, seeds[g], samples, budget)
    if ((g + 1) % PROGRESS_EVERY === 0) {
      parentPort!.postMessage({ type: 'progress', done: PROGRESS_EVERY })
    }
  }
  parentPort!.postMessage(
    { type: 'done', results, rest: seeds.length % PROGRESS_EVERY },
    [results.buffer],
  )
}

// ---------- Главный поток ----------

function parseArgs(): SimOptions {
  const argv = process.argv.slice(2)
  const get = (name: string, def: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def
  }
  const rulesArg = get('rules', 'russian')
  return {
    games: parseInt(get('games', '100000'), 10),
    workers: parseInt(get('workers', String(os.cpus().length)), 10),
    rules: (rulesArg === 'both' ? 'russian' : rulesArg) as RulesMode,
    samples: parseInt(get('samples', '1200'), 10),
    budget: parseInt(get('budget', '30'), 10),
    seed: parseInt(get('seed', '42'), 10),
  }
}

function stats(all: number[]) {
  all.sort((a, b) => a - b)
  const n = all.length
  const sum = all.reduce((s, x) => s + x, 0)
  const mean = sum / n
  const variance = all.reduce((s, x) => s + (x - mean) ** 2, 0) / n
  const pct = (p: number) => all[Math.min(n - 1, Math.floor((p / 100) * n))]
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
    p99: pct(99),
  }
}

function histogram(all: number[], width = 50): string {
  const counts = new Map<number, number>()
  for (const x of all) counts.set(x, (counts.get(x) ?? 0) + 1)
  const keys = [...counts.keys()].sort((a, b) => a - b)
  const maxCount = Math.max(...counts.values())
  const lines: string[] = []
  for (const k of keys) {
    const c = counts.get(k)!
    const bar = '#'.repeat(Math.max(1, Math.round((c / maxCount) * width)))
    const pctStr = ((c / all.length) * 100).toFixed(1).padStart(5)
    lines.push(`  ${String(k).padStart(3)} | ${pctStr}% ${bar}`)
  }
  return lines.join('\n')
}

async function runPool(rules: RulesMode, opts: SimOptions): Promise<number[]> {
  const { games, workers, samples, budget, seed } = opts
  const seedRng = mulberry32(seed ^ (rules === 'russian' ? 0 : 0x5f3759df))
  const seeds = Array.from({ length: games }, () =>
    Math.floor(seedRng() * 0xffffffff),
  )

  const perWorker = Math.ceil(games / workers)
  const chunks: number[][] = []
  for (let w = 0; w < workers; w++) {
    const chunk = seeds.slice(w * perWorker, (w + 1) * perWorker)
    if (chunk.length > 0) chunks.push(chunk)
  }

  let done = 0
  const t0 = Date.now()
  const all: number[] = []

  const tick = () => {
    const elapsed = (Date.now() - t0) / 1000
    const rate = done / Math.max(elapsed, 0.001)
    const eta = rate > 0 ? (games - done) / rate : 0
    process.stdout.write(
      `\r  [${rules}] ${done}/${games} боёв | ${rate.toFixed(0)} боёв/с | ETA ${Math.ceil(eta)}с   `,
    )
  }

  await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<void>((resolve, reject) => {
          const worker = new Worker(fileURLToPath(import.meta.url), {
            workerData: {
              rules,
              seeds: chunk,
              samples,
              budget,
            } satisfies WorkerInput,
          })
          worker.on('message', (msg) => {
            if (msg.type === 'progress') {
              done += msg.done
              tick()
            } else if (msg.type === 'done') {
              done += msg.rest
              for (const x of msg.results as Uint8Array) all.push(x)
              tick()
              resolve()
            }
          })
          worker.on('error', reject)
          worker.on('exit', (code) => {
            if (code !== 0) reject(new Error(`Воркер завершился с кодом ${code}`))
          })
        }),
    ),
  )
  process.stdout.write('\n')
  return all
}

function report(rules: RulesMode, all: number[], elapsedS: number) {
  const s = stats(all)
  const fleet = FLEETS[rules]
  const totalDeck = fleet.reduce((a, b) => a + b, 0)
  console.log('')
  console.log(`==== РЕЗУЛЬТАТЫ [${rules}] ====`)
  console.log(`  Боёв:            ${s.n}`)
  console.log(`  Флот:            ${fleet.join('-')} (${totalDeck} палуб)`)
  console.log(`  Среднее:         ${s.mean.toFixed(3)} выстрелов`)
  console.log(`  Ст. отклонение:  ${s.std.toFixed(3)}`)
  console.log(`  Медиана:         ${s.median}`)
  console.log(`  Мин / Макс:      ${s.min} / ${s.max}`)
  console.log(
    `  Перцентили:      p5=${s.p5}  p25=${s.p25}  p75=${s.p75}  p95=${s.p95}  p99=${s.p99}`,
  )
  console.log(
    `  Точность огня:   ${((totalDeck / s.mean) * 100).toFixed(1)}% попаданий в среднем`,
  )
  console.log(`  Время:           ${elapsedS.toFixed(1)}с (${(s.n / elapsedS).toFixed(1)} боёв/с)`)
  console.log('')
  console.log('  Распределение (выстрелов до победы):')
  console.log(histogram(all))
  // Машиночитаемая строка для объединения статистики нескольких серий
  const counts: Record<string, number> = {}
  for (const x of all) counts[x] = (counts[x] ?? 0) + 1
  console.log(`RAWCOUNTS ${rules} ${JSON.stringify(counts)}`)
}

async function main() {
  const opts = parseArgs()
  const rulesArg = process.argv.includes('both')
    ? (['russian', 'international'] as RulesMode[])
    : [opts.rules]

  console.log('АДМИРАЛ_ — тренировочный полигон')
  console.log(
    `  боёв: ${opts.games} | потоков: ${opts.workers} | сэмплов/ход: ${opts.samples} | бюджет: ${opts.budget}мс | сид: ${opts.seed}`,
  )
  console.log('')

  for (const rules of rulesArg) {
    const t0 = Date.now()
    const all = await runPool(rules, opts)
    report(rules, all, (Date.now() - t0) / 1000)
  }
}

if (isMainThread) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
