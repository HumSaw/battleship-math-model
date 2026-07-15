'use client'

import { cn } from '@/lib/utils'
import {
  CELLS,
  COL_LETTERS,
  HIT,
  MISS,
  SIZE,
  SUNK,
  UNKNOWN,
  cellName,
} from '@/lib/battleship-engine'

interface BoardProps {
  board: number[]
  probs: number[]
  best: number | null
  impossible: boolean[]
  showHeat: boolean
  showPercent: boolean
  exact: boolean
  activeCell: number | null
  onCellClick: (i: number, e: React.MouseEvent) => void
  onCellErase: (i: number) => void
}

const STATE_LABEL: Record<number, string> = {
  [UNKNOWN]: 'не обстреляно',
  [MISS]: 'промах',
  [HIT]: 'попадание',
  [SUNK]: 'потоплен',
}

export function Board({
  board,
  probs,
  best,
  impossible,
  showHeat,
  showPercent,
  exact,
  activeCell,
  onCellClick,
  onCellErase,
}: BoardProps) {
  let maxP = 0
  for (let i = 0; i < CELLS; i++) if (probs[i] > maxP) maxP = probs[i]

  return (
    <div
      className="grid w-full max-w-xl gap-[3px] font-mono text-sm"
      style={{ gridTemplateColumns: `1.5rem repeat(${SIZE}, minmax(0, 1fr))` }}
      role="grid"
      aria-label="Поле противника"
    >
      <div />
      {COL_LETTERS.map((l) => (
        <div
          key={l}
          className="pb-1.5 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
        >
          {l}
        </div>
      ))}

      {Array.from({ length: SIZE }, (_, r) => (
        <RowCells
          key={r}
          row={r}
          board={board}
          probs={probs}
          maxP={maxP}
          best={best}
          impossible={impossible}
          showHeat={showHeat}
          showPercent={showPercent}
          exact={exact}
          activeCell={activeCell}
          onCellClick={onCellClick}
          onCellErase={onCellErase}
        />
      ))}
    </div>
  )
}

function RowCells({
  row,
  board,
  probs,
  maxP,
  best,
  impossible,
  showHeat,
  showPercent,
  exact,
  activeCell,
  onCellClick,
  onCellErase,
}: {
  row: number
  board: number[]
  probs: number[]
  maxP: number
  best: number | null
  impossible: boolean[]
  showHeat: boolean
  showPercent: boolean
  exact: boolean
  activeCell: number | null
  onCellClick: (i: number, e: React.MouseEvent) => void
  onCellErase: (i: number) => void
}) {
  return (
    <>
      <div className="flex items-center justify-center pr-1.5 text-[11px] font-semibold text-muted-foreground/80">
        {row + 1}
      </div>
      {Array.from({ length: SIZE }, (_, c) => {
        const i = row * SIZE + c
        const state = board[i]
        const p = probs[i]
        const isBest = best === i
        const heat = showHeat && state === UNKNOWN && maxP > 0 ? p / maxP : 0

        return (
          <button
            key={i}
            type="button"
            role="gridcell"
            aria-label={`${cellName(i)}: ${STATE_LABEL[state]}${
              state === UNKNOWN && exact ? `, вероятность ${Math.round(p * 100)}%` : ''
            }`}
            onClick={(e) => onCellClick(i, e)}
            onContextMenu={(e) => {
              e.preventDefault()
              onCellErase(i)
            }}
            className={cn(
              'relative flex aspect-square select-none items-center justify-center rounded-[4px] border transition-colors',
              state === UNKNOWN &&
                'border-border/50 bg-foreground/[0.03] hover:border-primary/70 hover:bg-foreground/[0.06]',
              state === MISS && 'border-border/40 bg-background/40',
              state === HIT && 'border-destructive/40 bg-blood',
              state === SUNK && 'border-foreground/15 bg-sunk-black',
              isBest && 'z-10 ring-2 ring-signal',
              activeCell === i && 'z-10 ring-2 ring-foreground/60',
            )}
            style={
              heat > 0 && !isBest
                ? {
                    backgroundColor: `color-mix(in srgb, var(--color-primary) ${Math.round(
                      heat * 70,
                    )}%, transparent)`,
                  }
                : undefined
            }
          >
            {state === MISS && (
              <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground" />
            )}
            {state === HIT && (
              <span aria-hidden className="text-base font-bold leading-none text-foreground">
                {'×'}
              </span>
            )}
            {state === SUNK && (
              <span aria-hidden className="text-base font-bold leading-none text-destructive">
                {'×'}
              </span>
            )}
            {state === UNKNOWN && impossible[i] && (
              <span aria-hidden className="size-1 rounded-full bg-muted-foreground/30" />
            )}
            {state === UNKNOWN && showPercent && p > 0.004 && (
              <span
                aria-hidden
                className={cn(
                  'text-[9px] leading-none',
                  heat > 0.55 ? 'font-semibold text-primary-foreground' : 'text-foreground/70',
                )}
              >
                {Math.round(p * 100)}
              </span>
            )}
            {isBest && (
              <span
                aria-hidden
                className="animate-signal-blink pointer-events-none absolute inset-0 rounded-[4px] border-2 border-signal"
              />
            )}
          </button>
        )
      })}
    </>
  )
}
