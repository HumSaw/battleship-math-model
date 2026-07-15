'use client'

import { cn } from '@/lib/utils'
import { cellName, type Analysis } from '@/lib/battleship-engine'

const MODE_INFO: Record<
  Analysis['mode'],
  { label: string; className: string }
> = {
  hunt: { label: 'Режим: поиск', className: 'bg-primary/15 text-primary' },
  target: { label: 'Режим: добивание', className: 'bg-destructive/20 text-destructive' },
  won: { label: 'Все корабли потоплены', className: 'bg-primary/15 text-primary' },
  inconsistent: {
    label: 'Позиция противоречива',
    className: 'bg-destructive/20 text-destructive',
  },
}

export function RecommendationPanel({ analysis }: { analysis: Analysis }) {
  const { best, top, mode, exact, validSamples, attempts } = analysis
  const info = MODE_INFO[mode]

  return (
    <section
      aria-label="Рекомендация движка"
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Рекомендация
        </h2>
        <span className={cn('rounded px-2 py-0.5 font-mono text-xs', info.className)}>
          {info.label}
        </span>
      </div>

      {mode === 'won' ? (
        <p className="mt-4 text-lg font-semibold text-primary">Победа! Флот противника уничтожен.</p>
      ) : mode === 'inconsistent' ? (
        <p className="mt-4 text-sm leading-relaxed text-destructive">
          Отметки на поле противоречат правилам. Проверьте попадания и потопленные корабли (или
          переключите набор правил в настройках).
        </p>
      ) : best !== null ? (
        <>
          <div className="mt-3 flex items-end gap-4">
            <div className="font-mono text-5xl font-bold text-primary">{cellName(best)}</div>
            <div className="pb-1">
              <div className="font-mono text-xl font-semibold text-foreground">
                {Math.round(analysis.probs[best] * 100)}%
              </div>
              <div className="text-xs text-muted-foreground">
                {exact ? 'вероятность попадания' : 'относительный вес (эвристика)'}
              </div>
            </div>
          </div>

          {top.length > 1 && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Альтернативы
              </div>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {top.slice(1).map(({ idx, p }) => (
                  <li
                    key={idx}
                    className="rounded border border-border px-2 py-1 font-mono text-xs text-foreground/90"
                  >
                    {cellName(idx)} · {Math.round(p * 100)}%
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : null}

      <div className="mt-4 border-t border-border pt-3 font-mono text-xs text-muted-foreground">
        {exact ? (
          <>
            Смоделировано расстановок: {validSamples.toLocaleString('ru-RU')} (попыток:{' '}
            {attempts.toLocaleString('ru-RU')})
          </>
        ) : (
          <>Монте-Карло недоступно — используется плотность размещений</>
        )}
      </div>
    </section>
  )
}
