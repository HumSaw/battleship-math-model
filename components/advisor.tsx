'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  CELLS,
  HIT,
  MISS,
  SUNK,
  UNKNOWN,
  cellName,
  colOf,
  isStraightLine,
  orthoNeighbors,
  rowOf,
  type RulesMode,
} from '@/lib/battleship-engine'
import { useAnalysis } from '@/hooks/use-analysis'
import { Board } from '@/components/board'
import { RecommendationPanel } from '@/components/recommendation-panel'
import { FleetStatus } from '@/components/fleet-status'

interface Snapshot {
  board: number[]
  ships: number[][] // потопленные корабли — явные списки клеток
}

type PopoverStage =
  | { stage: 'result' }
  | { stage: 'length'; error?: string }
  | { stage: 'segment'; length: number; candidates: number[][] }

interface PopoverState {
  cell: number
  x: number
  y: number
  data: PopoverStage
}

const emptySnapshot = (): Snapshot => ({
  board: new Array<number>(CELLS).fill(UNKNOWN),
  ships: [],
})

/** Все прямые отрезки длины L, содержащие клетку i, где остальные клетки — ранения */
function sunkCandidates(board: number[], i: number, L: number): number[][] {
  const out: number[][] = []
  const r = rowOf(i)
  const c = colOf(i)
  // Горизонтальные
  for (let start = Math.max(0, c - L + 1); start <= Math.min(c, 10 - L); start++) {
    const cells: number[] = []
    let ok = true
    for (let k = 0; k < L; k++) {
      const idx = r * 10 + start + k
      if (idx !== i && board[idx] !== HIT) {
        ok = false
        break
      }
      cells.push(idx)
    }
    if (ok) out.push(cells)
  }
  // Вертикальные (для L=1 не дублируем)
  if (L > 1) {
    for (let start = Math.max(0, r - L + 1); start <= Math.min(r, 10 - L); start++) {
      const cells: number[] = []
      let ok = true
      for (let k = 0; k < L; k++) {
        const idx = (start + k) * 10 + c
        if (idx !== i && board[idx] !== HIT) {
          ok = false
          break
        }
        cells.push(idx)
      }
      if (ok) out.push(cells)
    }
  }
  return out
}

function segmentLabel(cells: number[]): string {
  return cells.length === 1
    ? cellName(cells[0])
    : `${cellName(cells[0])}–${cellName(cells[cells.length - 1])}`
}

export function Advisor() {
  const [history, setHistory] = useState<Snapshot[]>([emptySnapshot()])
  const [cursor, setCursor] = useState(0)
  const [rules, setRules] = useState<RulesMode>('russian')
  const [showHeat, setShowHeat] = useState(true)
  const [showPercent, setShowPercent] = useState(true)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [resetArmed, setResetArmed] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const snapshot = history[cursor]
  const { board, ships } = snapshot

  const { analysis, computing } = useAnalysis(board, rules, ships)

  const canUndo = cursor > 0
  const canRedo = cursor < history.length - 1

  const push = useCallback(
    (next: Snapshot) => {
      setHistory((h) => [...h.slice(0, cursor + 1), next])
      setCursor((c) => c + 1)
    },
    [cursor],
  )

  const undo = useCallback(() => setCursor((c) => Math.max(0, c - 1)), [])
  const redo = useCallback(
    () => setCursor((c) => Math.min(history.length - 1, c + 1)),
    [history.length],
  )

  const reset = () => {
    setHistory([emptySnapshot()])
    setCursor(0)
    setPopover(null)
    setResetArmed(false)
  }

  // Горячие клавиши: Ctrl+Z — отмена, Ctrl+Shift+Z / Ctrl+Y — повтор, Esc — закрыть поповер
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPopover(null)
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // Закрытие поповера по клику вне его
  useEffect(() => {
    if (!popover) return
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [popover])

  const shots = board.filter((s) => s !== UNKNOWN).length
  const hits = board.filter((s) => s === HIT || s === SUNK).length

  const setCellState = (i: number, state: number) => {
    const b = [...board]
    b[i] = state
    push({ board: b, ships })
    setPopover(null)
  }

  const eraseCell = (i: number) => {
    const b = [...board]
    if (b[i] === SUNK) {
      // Стираем весь потопленный корабль целиком
      const shipIx = ships.findIndex((s) => s.includes(i))
      if (shipIx !== -1) {
        for (const c of ships[shipIx]) b[c] = UNKNOWN
        push({ board: b, ships: ships.filter((_, k) => k !== shipIx) })
      } else {
        b[i] = UNKNOWN
        push({ board: b, ships })
      }
    } else {
      b[i] = UNKNOWN
      push({ board: b, ships })
    }
    setPopover(null)
  }

  const applySunkShip = (cells: number[]) => {
    const b = [...board]
    for (const c of cells) b[c] = SUNK
    push({ board: b, ships: [...ships, cells] })
    setPopover(null)
  }

  const markSunk = (i: number) => {
    if (rules === 'russian') {
      // Русские правила: корабль = клетка + все смежные ранения (не касаются — однозначно)
      const cells = [i]
      const b = [...board]
      b[i] = SUNK
      const stack = [i]
      const seen = new Set([i])
      while (stack.length) {
        const cur = stack.pop() as number
        for (const n of orthoNeighbors(cur)) {
          if (board[n] === HIT && !seen.has(n)) {
            seen.add(n)
            cells.push(n)
            stack.push(n)
          }
        }
      }
      if (!isStraightLine(cells)) {
        setPopover((p) =>
          p ? { ...p, data: { stage: 'length', error: 'Ранения не образуют прямую линию' } } : p,
        )
        return
      }
      applySunkShip(cells)
    } else {
      // Международные: касание разрешено, поэтому спрашиваем длину корабля
      setPopover((p) => (p ? { ...p, data: { stage: 'length' } } : p))
    }
  }

  const pickSunkLength = (i: number, L: number) => {
    const candidates = sunkCandidates(board, i, L)
    if (candidates.length === 0) {
      setPopover((p) =>
        p
          ? {
              ...p,
              data: {
                stage: 'length',
                error: `Нет отрезка длины ${L} из ранений через эту клетку`,
              },
            }
          : p,
      )
    } else if (candidates.length === 1) {
      applySunkShip(candidates[0])
    } else {
      setPopover((p) =>
        p ? { ...p, data: { stage: 'segment', length: L, candidates } } : p,
      )
    }
  }

  const onCellClick = (i: number, e: React.MouseEvent) => {
    setPopover({ cell: i, x: e.clientX, y: e.clientY, data: { stage: 'result' } })
  }

  const remainingLengths = useMemo(
    () => [...new Set(analysis?.remaining ?? [])].sort((a, b) => b - a),
    [analysis],
  )

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-balance font-mono text-2xl font-bold tracking-tight text-foreground lg:text-3xl">
            АДМИРАЛ<span className="text-primary">_</span>
          </h1>
          <p className="mt-1 max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground">
            Вероятностный движок для «Морского боя»: точный перебор в эндшпиле, взвешенное
            Монте-Карло в середине партии — всегда математически лучший выстрел.
          </p>
        </div>
        <dl className="flex gap-5 font-mono text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Выстрелов</dt>
            <dd className="text-lg font-semibold text-foreground">{shots}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Попаданий</dt>
            <dd className="text-lg font-semibold text-primary">{hits}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Точность</dt>
            <dd className="text-lg font-semibold text-foreground">
              {shots > 0 ? Math.round((hits / shots) * 100) : 0}%
            </dd>
          </div>
        </dl>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="font-mono"
              onClick={undo}
              disabled={!canUndo}
              title="Отменить (Ctrl+Z)"
            >
              Отменить
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="font-mono"
              onClick={redo}
              disabled={!canRedo}
              title="Повторить (Ctrl+Shift+Z)"
            >
              Повторить
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              Ход {cursor} · клик по клетке — выбор результата
            </span>
          </div>

          <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
            <Board
              board={board}
              probs={analysis?.probs ?? new Array(CELLS).fill(0)}
              best={analysis?.best ?? null}
              impossible={analysis?.impossible ?? new Array(CELLS).fill(false)}
              showHeat={showHeat}
              showPercent={showPercent}
              exact={analysis?.exact ?? true}
              activeCell={popover?.cell ?? null}
              onCellClick={onCellClick}
              onCellErase={eraseCell}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Клик по клетке — отметить результат выстрела, правый клик — стереть. Пульсирующая
              рамка — лучший выстрел. Ctrl+Z — отмена хода.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-[2px] bg-signal" /> лучший выстрел
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-[2px] bg-primary/70" /> вероятность
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-1.5 rounded-full bg-muted-foreground" /> промах
            </span>
            <span className="flex items-center gap-1.5">
              <span className="flex size-3.5 items-center justify-center rounded-[2px] bg-blood text-[9px] font-bold text-foreground">
                ×
              </span>
              ранен
            </span>
            <span className="flex items-center gap-1.5">
              <span className="flex size-3.5 items-center justify-center rounded-[2px] bg-sunk-black text-[9px] font-bold text-destructive">
                ×
              </span>
              потоплен
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-1 rounded-full bg-muted-foreground/40" /> точно
              пусто
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <RecommendationPanel analysis={analysis} computing={computing} />
          <FleetStatus
            remaining={analysis?.remaining ?? []}
            destroyed={analysis?.destroyed ?? []}
          />

          <section aria-label="Настройки" className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Настройки
            </h2>

            <div className="mt-3">
              <div className="text-xs text-muted-foreground">Правила</div>
              <div className="mt-1.5 grid grid-cols-1 gap-1.5">
                <RuleOption
                  active={rules === 'russian'}
                  onClick={() => setRules('russian')}
                  title="Русские (классика)"
                  subtitle="4·3·3·2·2·2·1·1·1·1, корабли не касаются"
                />
                <RuleOption
                  active={rules === 'international'}
                  onClick={() => setRules('international')}
                  title="Международные"
                  subtitle="5·4·3·3·2, касание разрешено"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <ToggleRow
                label="Тепловая карта"
                checked={showHeat}
                onChange={() => setShowHeat((v) => !v)}
              />
              <ToggleRow
                label="Проценты в клетках"
                checked={showPercent}
                onChange={() => setShowPercent((v) => !v)}
              />
            </div>

            {resetArmed ? (
              <div className="mt-4 flex gap-2">
                <Button variant="destructive" className="flex-1 font-mono" onClick={reset}>
                  Да, сбросить
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 font-mono"
                  onClick={() => setResetArmed(false)}
                >
                  Отмена
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                className="mt-4 w-full font-mono"
                onClick={() => setResetArmed(true)}
              >
                Новая игра
              </Button>
            )}
          </section>

          <section
            aria-label="Как пользоваться"
            className="rounded-lg border border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider">Как пользоваться</h2>
            <ol className="mt-2 list-inside list-decimal space-y-1">
              <li>Стреляйте в клетку с пульсирующей рамкой.</li>
              <li>Кликните по клетке и выберите ответ: «Мимо», «Ранил» или «Убил».</li>
              <li>Дви��ок мгновенно пересчитает вероятности — повторяйте до победы.</li>
            </ol>
          </section>
        </div>
      </div>

      {popover && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`Результат выстрела в ${cellName(popover.cell)}`}
          className="fixed z-50 min-w-40 rounded-lg border border-border bg-popover p-2 shadow-lg"
          style={{
            left: Math.max(
              8,
              Math.min(
                popover.x,
                typeof window !== 'undefined' ? window.innerWidth - 208 : popover.x,
              ),
            ),
            // Прижимаем к нижней границе: fixed-элемент не скроллится,
            // и кнопки за краем вьюпорта иначе недоступны для клика
            top: Math.max(
              8,
              Math.min(
                popover.y + 8,
                typeof window !== 'undefined' ? window.innerHeight - 220 : popover.y + 8,
              ),
            ),
          }}
        >
          <div className="mb-1.5 px-1 font-mono text-xs font-semibold text-muted-foreground">
            {cellName(popover.cell)}
          </div>

          {popover.data.stage === 'result' && (
            <div className="flex flex-col gap-1">
              <PopoverButton onClick={() => setCellState(popover.cell, MISS)}>Мимо</PopoverButton>
              <PopoverButton onClick={() => setCellState(popover.cell, HIT)}>Ранил</PopoverButton>
              <PopoverButton onClick={() => markSunk(popover.cell)}>Убил</PopoverButton>
              {board[popover.cell] !== UNKNOWN && (
                <PopoverButton onClick={() => eraseCell(popover.cell)} muted>
                  Стереть
                </PopoverButton>
              )}
            </div>
          )}

          {popover.data.stage === 'length' && (
            <div className="flex flex-col gap-1">
              <div className="px-1 text-xs text-muted-foreground">Длина потопленного корабля:</div>
              <div className="flex gap-1">
                {remainingLengths.map((L) => (
                  <PopoverButton key={L} onClick={() => pickSunkLength(popover.cell, L)}>
                    {L}
                  </PopoverButton>
                ))}
              </div>
              {popover.data.error && (
                <div className="px-1 text-xs text-destructive">{popover.data.error}</div>
              )}
            </div>
          )}

          {popover.data.stage === 'segment' && (
            <div className="flex flex-col gap-1">
              <div className="px-1 text-xs text-muted-foreground">Где стоял корабль?</div>
              {popover.data.candidates.map((cells) => (
                <PopoverButton key={cells.join('-')} onClick={() => applySunkShip(cells)}>
                  {segmentLabel(cells)}
                </PopoverButton>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PopoverButton({
  children,
  onClick,
  muted,
}: {
  children: React.ReactNode
  onClick: () => void
  muted?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-2.5 py-1.5 text-left font-mono text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
        muted ? 'text-muted-foreground' : 'text-popover-foreground',
      )}
    >
      {children}
    </button>
  )
}

function RuleOption({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean
  onClick: () => void
  title: string
  subtitle: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-3 py-2 text-left transition-colors',
        active ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50',
      )}
    >
      <div className={cn('text-sm font-medium', active ? 'text-primary' : 'text-foreground')}>
        {title}
      </div>
      <div className="text-xs text-muted-foreground">{subtitle}</div>
    </button>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-foreground">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={cn(
          'relative h-5 w-9 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-background transition-transform',
            checked ? 'translate-x-4.5' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  )
}
