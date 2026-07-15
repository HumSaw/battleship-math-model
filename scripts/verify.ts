// Математическая верификация движка «АДМИРАЛ_».
//
// Тесты:
//  A. Несмещённость Монте-Карло: на позициях, где возможен точный перебор,
//     принудительный Монте-Карло должен сходиться к тем же вероятностям.
//  B. Симметрия: первая рекомендация на пустой доске и карта вероятностей
//     должны быть симметричны относительно поворотов/отражений.
//  C. Режим добивания: после одиночного ранения вероятности продолжений
//     должны быть симметричны, диагонали (русские правила) — нули.
//  D. Инварианты: движок никогда не рекомендует доказуемо пустую клетку,
//     никогда не объявляет inconsistent на честной партии.
//  E. Сила: мини-бенчмарк на случайных честных партиях.

import {
  analyze,
  CELLS,
  SIZE,
  UNKNOWN,
  MISS,
  HIT,
  SUNK,
  FLEETS,
  cellName,
  neighbors8,
  type RulesMode,
} from '../lib/battleship-engine'

let failures = 0
const fail = (msg: string) => {
  failures++
  console.log(`  FAIL: ${msg}`)
}
const ok = (msg: string) => console.log(`  ok: ${msg}`)

// ---------- Утилиты ----------

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

/** Честная случайная расстановка флота (равномерная по попыткам с retry) */
function randomFleet(rules: RulesMode, rng: () => number): number[][] | null {
  const nt = rules === 'russian'
  const blocked = new Uint8Array(CELLS)
  const ships: number[][] = []
  for (const L of FLEETS[rules]) {
    const options: number[][] = []
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c + L <= SIZE; c++) {
        const cells = Array.from({ length: L }, (_, k) => r * SIZE + c + k)
        if (cells.every((x) => !blocked[x])) options.push(cells)
      }
    }
    if (L > 1) {
      for (let c = 0; c < SIZE; c++) {
        for (let r = 0; r + L <= SIZE; r++) {
          const cells = Array.from({ length: L }, (_, k) => (r + k) * SIZE + c)
          if (cells.every((x) => !blocked[x])) options.push(cells)
        }
      }
    }
    if (!options.length) return null
    const pick = options[(rng() * options.length) | 0]
    ships.push(pick)
    for (const x of pick) {
      blocked[x] = 1
      if (nt) for (const n of neighbors8(x)) blocked[n] = 1
    }
  }
  return ships
}

const rot90 = (i: number) => {
  const r = Math.floor(i / SIZE)
  const c = i % SIZE
  return c * SIZE + (SIZE - 1 - r)
}
const mirror = (i: number) => {
  const r = Math.floor(i / SIZE)
  const c = i % SIZE
  return r * SIZE + (SIZE - 1 - c)
}

// ---------- Тест A: несмещённость Монте-Карло ----------

console.log('\nТест A: Монте-Карло сходится к точному перебору')
{
  // Позиция с малым флотом: убиты все, кроме 3 кораблей (русские правила).
  // Строим позицию: потоплены 4,3,3,2,2,2,1 — остались 1,1,1.
  // Для простоты кладём потопленные корабли явно.
  const board = new Array<number>(CELLS).fill(UNKNOWN)
  const sunkShips: number[][] = []
  const putSunk = (cells: number[]) => {
    for (const c of cells) board[c] = SUNK
    sunkShips.push(cells)
  }
  // Ряды 0,2,4,6: корабли через клетку (не касаются)
  putSunk([0, 1, 2, 3]) // 4п: А1-Г1
  putSunk([20, 21, 22]) // 3п: А3-В3
  putSunk([25, 26, 27]) // 3п: Е3-Ж3... (индексы: 25=Е3? нет, 25 = ряд2 кол5)
  putSunk([40, 41]) // 2п
  putSunk([44, 45]) // 2п
  putSunk([48, 49]) // 2п
  putSunk([60]) // 1п
  // Немного промахов для интереса
  for (const m of [70, 71, 85, 99]) board[m] = MISS

  const exactRes = analyze(board, 'russian', sunkShips, { enumLimit: 10_000_000 })
  if (exactRes.method !== 'enumerated') {
    fail(`ожидался точный перебор, получен ${exactRes.method}`)
  } else {
    // Принудительный Монте-Карло на той же позиции
    const mcRes = analyze(board, 'russian', sunkShips, {
      enumLimit: 0,
      targetSamples: 60000,
      maxAttempts: 500000,
      timeBudgetMs: 20000,
    })
    if (mcRes.method !== 'montecarlo') {
      fail(`ожидался Монте-Карло, получен ${mcRes.method}`)
    } else {
      let maxDiff = 0
      let maxCell = -1
      for (let i = 0; i < CELLS; i++) {
        const d = Math.abs(exactRes.probs[i] - mcRes.probs[i])
        if (d > maxDiff) {
          maxDiff = d
          maxCell = i
        }
      }
      console.log(
        `  точный best=${cellName(exactRes.best!)}, MC best=${cellName(mcRes.best!)}, ` +
          `MC сэмплов=${mcRes.validSamples} (эфф. ${mcRes.effectiveSamples})`,
      )
      console.log(`  макс. |Δp| = ${(maxDiff * 100).toFixed(2)}% в клетке ${cellName(maxCell)}`)
      if (maxDiff > 0.02) fail(`расхождение MC и точного перебора ${(maxDiff * 100).toFixed(2)}% > 2%`)
      else ok('Монте-Карло несмещён (|Δp| ≤ 2%)')
    }
  }
}

// ---------- Тест B: симметрия первого хода ----------

console.log('\nТест B: симметрия карты вероятностей на пустой доске')
for (const rules of ['russian', 'international'] as RulesMode[]) {
  const empty = new Array<number>(CELLS).fill(UNKNOWN)
  const res = analyze(empty, rules, null, { targetSamples: 40000, timeBudgetMs: 15000 })
  // Проверяем симметрию probs относительно поворота на 90° и зеркала
  let maxAsym = 0
  for (let i = 0; i < CELLS; i++) {
    maxAsym = Math.max(
      maxAsym,
      Math.abs(res.probs[i] - res.probs[rot90(i)]),
      Math.abs(res.probs[i] - res.probs[mirror(i)]),
    )
  }
  console.log(
    `  ${rules}: best=${cellName(res.best!)} p=${(res.probs[res.best!] * 100).toFixed(1)}%, ` +
      `макс. асимметрия ${(maxAsym * 100).toFixed(2)}%`,
  )
  if (maxAsym > 0.04) fail(`${rules}: асимметрия ${(maxAsym * 100).toFixed(2)}% > 4% (шум MC?)`)
  else ok(`${rules}: карта симметрична (в пределах шума)`)
}

// ---------- Тест C: добивание после одиночного ранения ----------

console.log('\nТест C: добивание одиночного ранения в центре (русские правила)')
{
  const board = new Array<number>(CELLS).fill(UNKNOWN)
  const h = 4 * SIZE + 4 // Д5
  board[h] = HIT
  const res = analyze(board, 'russian', null, { targetSamples: 40000, timeBudgetMs: 15000 })
  if (res.mode !== 'target') fail(`ожидался режим target, получен ${res.mode}`)
  const up = res.probs[h - SIZE]
  const down = res.probs[h + SIZE]
  const left = res.probs[h - 1]
  const right = res.probs[h + 1]
  console.log(
    `  вверх=${(up * 100).toFixed(1)}% вниз=${(down * 100).toFixed(1)}% ` +
      `влево=${(left * 100).toFixed(1)}% вправо=${(right * 100).toFixed(1)}%`,
  )
  // Симметрия: все 4 направления равны (позиция в центре симметрична)
  const dirs = [up, down, left, right]
  const spread = Math.max(...dirs) - Math.min(...dirs)
  if (spread > 0.05) fail(`асимметрия направлений ${(spread * 100).toFixed(1)}% > 5%`)
  else ok('направления симметричны')
  // Диагонали — доказуемые нули
  for (const d of [h - SIZE - 1, h - SIZE + 1, h + SIZE - 1, h + SIZE + 1]) {
    if (res.probs[d] > 0 || !res.impossible[d]) fail(`диагональ ${cellName(d)} не исключена`)
  }
  ok('диагонали ранения исключены')
  // Сумма вероятностей по соседям: ранение обязано продолжиться (весь флот жив,
  // одиночек 4 — корабль может быть и однопалубником!). Значит best — один из соседей,
  // но не обязательно p=1.
  if (![h - SIZE, h + SIZE, h - 1, h + 1].includes(res.best!))
    fail(`best=${cellName(res.best!)} — не сосед ранения`)
  else ok(`best=${cellName(res.best!)} — сосед ранения`)
}

// ---------- Тест C2: ранение двухпалубника, «полностью раненый» исключён (К-1) ----------

console.log('\nТест C2: К-1 — два ранения подряд, двухпалубник исключён')
{
  const board = new Array<number>(CELLS).fill(UNKNOWN)
  board[44] = HIT // Д5
  board[45] = HIT // Е5
  const res = analyze(board, 'russian', null, { targetSamples: 40000, timeBudgetMs: 15000 })
  // Кластер длины 2 при живом двухпалубнике: если бы это был 2п — сказали бы «убил».
  // Значит корабль длины ≥ 3 → клетки Г5 (43) и Ж5 (46) должны иметь p > 0,
  // и в сумме конфигурации обязаны продолжаться влево или вправо.
  const pl = res.probs[43]
  const pr = res.probs[46]
  console.log(`  p(Г5)=${(pl * 100).toFixed(1)}% p(Ж5)=${(pr * 100).toFixed(1)}%`)
  if (pl + pr < 0.99) fail(`сумма продолжений ${((pl + pr) * 100).toFixed(1)}% — должна быть ~100%+`)
  else ok('корабль обязан продолжаться (2п исключён движком)')
}

// ---------- Тест D: инварианты на честных партиях ----------

console.log('\nТест D: инварианты на 40 честных случайных партиях (русские)')
{
  const rng = mulberry32(0xc0ffee)
  let bad = 0
  for (let g = 0; g < 40; g++) {
    const fleet = randomFleet('russian', rng)
    if (!fleet) {
      g--
      continue
    }
    const shipAt = new Int16Array(CELLS).fill(-1)
    fleet.forEach((s, si) => s.forEach((c) => (shipAt[c] = si)))
    const hitsLeft = fleet.map((s) => s.length)
    const board = new Array<number>(CELLS).fill(UNKNOWN)
    const sunkList: number[][] = []
    let shots = 0
    for (; shots < 200; shots++) {
      const res = analyze(board, 'russian', sunkList, {
        targetSamples: 1200,
        timeBudgetMs: 60,
        maxAttempts: 40000,
      })
      if (res.mode === 'won') break
      if (res.mode === 'inconsistent') {
        bad++
        fail(`партия ${g}: inconsistent на честной позиции (ход ${shots})`)
        break
      }
      const t = res.best!
      if (board[t] !== UNKNOWN) {
        bad++
        fail(`партия ${g}: рекомендована уже обстрелянная клетка ${cellName(t)}`)
        break
      }
      if (res.impossible[t]) {
        bad++
        fail(`партия ${g}: рекомендована «точно пустая» клетка ${cellName(t)}`)
        break
      }
      const si = shipAt[t]
      if (si === -1) board[t] = MISS
      else {
        hitsLeft[si]--
        if (hitsLeft[si] === 0) {
          for (const c of fleet[si]) board[c] = SUNK
          sunkList.push(fleet[si])
        } else {
          board[t] = HIT
        }
      }
    }
  }
  if (bad === 0) ok('все инварианты соблюдены во всех партиях')
}

// ---------- Тест E: мини-бенчмарк силы ----------

console.log('\nТест E: сила движка, 120 партий (русские правила)')
{
  const rng = mulberry32(0xdead1234)
  const results: number[] = []
  for (let g = 0; g < 120; g++) {
    const fleet = randomFleet('russian', rng)
    if (!fleet) {
      g--
      continue
    }
    const shipAt = new Int16Array(CELLS).fill(-1)
    fleet.forEach((s, si) => s.forEach((c) => (shipAt[c] = si)))
    const hitsLeft = fleet.map((s) => s.length)
    const board = new Array<number>(CELLS).fill(UNKNOWN)
    const sunkList: number[][] = []
    let shots = 0
    let sunkCount = 0
    while (sunkCount < fleet.length && shots < 150) {
      const res = analyze(board, 'russian', sunkList, {
        targetSamples: 1500,
        timeBudgetMs: 80,
        maxAttempts: 50000,
      })
      if (res.best === null) break
      const t = res.best
      shots++
      const si = shipAt[t]
      if (si === -1) board[t] = MISS
      else {
        hitsLeft[si]--
        if (hitsLeft[si] === 0) {
          for (const c of fleet[si]) board[c] = SUNK
          sunkList.push(fleet[si])
          sunkCount++
        } else {
          board[t] = HIT
        }
      }
    }
    results.push(shots)
  }
  results.sort((a, b) => a - b)
  const mean = results.reduce((a, b) => a + b, 0) / results.length
  const median = results[Math.floor(results.length / 2)]
  console.log(
    `  среднее=${mean.toFixed(2)} медиана=${median} мин=${results[0]} макс=${results[results.length - 1]}`,
  )
  if (mean > 60) fail(`среднее ${mean.toFixed(1)} > 60 — движок слабее ожидаемого`)
  else ok(`средняя партия ${mean.toFixed(1)} выстрелов — уровень сильного солвера`)
}

console.log(`\n${'='.repeat(50)}`)
console.log(failures === 0 ? 'ВСЕ ТЕСТЫ ПРОЙДЕНЫ' : `ПРОВАЛЕНО ПРОВЕРОК: ${failures}`)
process.exit(failures === 0 ? 0 : 1)
