'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  CELLS,
  HIT,
  MISS,
  SUNK,
  UNKNOWN,
  analyze,
  orthoNeighbors,
  type RulesMode,
} from '@/lib/battleship-engine'
import { Board } from '@/components/board'
import { RecommendationPanel } from '@/components/recommendation-panel'
import { FleetStatus } from '@/components/fleet-status'

type Tool = 'miss' | 'hit' | 'sunk' | 'erase'

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'miss', label: 'Мимо', hint: 'противник сказал «мимо»' },
  { id: 'hit', label: 'Ранил', hint: 'попадание, корабль ещё жив' },
  { id: 'sunk', label: 'Убил', hint: 'корабль потоплен целиком' },
  { id: 'erase', label: 'Стереть', hint: 'убрать отметку' },
]

const emptyBoard = () => new Array<number>(CELLS).fill(UNKNOWN)

export function Advisor() {
  const [board, setBoard] = useState<number[]>(emptyBoard)
  const [rules, setRules] = useState<RulesMode>('russian')
  const [tool, setTool] = useState<Tool>('miss')
  const [showHeat, setShowHeat] = useState(true)
  const [showPercent, setShowPercent] = useState(true)

  const analysis = useMemo(() => analyze(board, rules), [board, rules])

  const shots = board.filter((s) => s !== UNKNOWN).length
  const hits = board.filter((s) => s === HIT || s === SUNK).length

  const applyCell = (i: number) => {
    setBoard((prev) => {
      const b = [...prev]
      if (tool === 'erase') {
        b[i] = UNKNOWN
      } else if (tool === 'miss') {
        b[i] = b[i] === MISS ? UNKNOWN : MISS
      } else if (tool === 'hit') {
        b[i] = b[i] === HIT ? UNKNOWN : HIT
      } else {
        // «Убил»: клетка + все смежные попадания становятся потопленным кораблём
        if (b[i] === SUNK) {
          b[i] = UNKNOWN
        } else {
          b[i] = SUNK
          const stack = [i]
          while (stack.length) {
            const cur = stack.pop() as number
            for (const n of orthoNeighbors(cur)) {
              if (b[n] === HIT) {
                b[n] = SUNK
                stack.push(n)
              }
            }
          }
        }
      }
      return b
    })
  }

  const eraseCell = (i: number) => {
    setBoard((prev) => {
      const b = [...prev]
      b[i] = UNKNOWN
      return b
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-balance font-mono text-2xl font-bold tracking-tight text-foreground lg:text-3xl">
            АДМИРАЛ<span className="text-primary">_</span>
          </h1>
          <p className="mt-1 max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground">
            Вероятностный движок для «Морского боя»: моделирует тысячи допустимых расстановок
            флота противника и всегда предлагает математически лучший выстрел.
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
          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Результат выстрела">
            <span className="mr-1 text-xs uppercase tracking-wider text-muted-foreground">
              Отметить:
            </span>
            {TOOLS.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={tool === t.id ? 'default' : 'outline'}
                onClick={() => setTool(t.id)}
                title={t.hint}
                aria-pressed={tool === t.id}
                className="font-mono"
              >
                {t.label}
              </Button>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
            <Board
              board={board}
              probs={analysis.probs}
              best={analysis.best}
              impossible={analysis.impossible}
              showHeat={showHeat}
              showPercent={showPercent}
              exact={analysis.exact}
              onCellAction={applyCell}
              onCellErase={eraseCell}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Клик — поставить отметку выбранным инструментом, правый клик — стереть. Числа в
              клетках — вероятность корабля (%), пульсирующая рамка — лучший выстрел.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-[2px] bg-primary/70" /> вероятность
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-1.5 rounded-full bg-muted-foreground" /> промах
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-bold text-destructive">✕</span> ранен
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block flex size-3.5 items-center justify-center rounded-[2px] bg-destructive/25 text-[9px] font-bold text-destructive/80">
                ✕
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
          <RecommendationPanel analysis={analysis} />
          <FleetStatus remaining={analysis.remaining} destroyed={analysis.destroyed} />

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

            <Button
              variant="outline"
              className="mt-4 w-full font-mono"
              onClick={() => setBoard(emptyBoard())}
            >
              Новая игра
            </Button>
          </section>

          <section
            aria-label="Как пользоваться"
            className="rounded-lg border border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider">Как пользоваться</h2>
            <ol className="mt-2 list-inside list-decimal space-y-1">
              <li>Стреляйте в клетку с пульсирующей рамкой.</li>
              <li>Отметьте ответ противника: «Мимо», «Ранил» или «Убил».</li>
              <li>Движок мгновенно пересчитает вероятности — повторяйте до победы.</li>
            </ol>
          </section>
        </div>
      </div>
    </div>
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
        active
          ? 'border-primary bg-primary/10'
          : 'border-border hover:border-primary/50',
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
