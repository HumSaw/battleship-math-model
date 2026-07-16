'use client'

import { cn } from '@/lib/utils'
import { cellName, type Analysis } from '@/lib/battleship-engine'
import type { Locale, Messages } from '@/lib/i18n'

const MODE_INFO: Record<Analysis['mode'], { label: string; className: string }> = {
  hunt: { label: 'Поиск', className: 'border-primary/40 bg-primary/10 text-primary' },
  target: {
    label: 'Добивание',
    className: 'border-destructive/40 bg-destructive/15 text-destructive',
  },
  won: { label: 'Победа', className: 'border-primary/40 bg-primary/10 text-primary' },
  inconsistent: {
    label: 'Противоречие',
    className: 'border-destructive/40 bg-destructive/15 text-destructive',
  },
}

const METHOD_LABEL: Record<Analysis['method'], string> = {
  enumerated: 'точный перебор всех расстановок',
  montecarlo: 'взвешенное Монте-Карло',
  heuristic: 'эвристика плотности',
}

const POLICY_LABEL: Record<Analysis['policy'], string> = {
  expectimax: 'expectimax (минимум матожидания ходов)',
  lookahead: 'вероятность + двухходовый разбор',
  maxprob: 'максимум вероятности',
}

export function RecommendationPanel({
  analysis,
  computing,
}: {
  analysis: Analysis | null
  computing: boolean
}) {
  if (!analysis) {
    return (
      <section aria-label="Рекомендация движка" className="panel p-4 sm:p-5">
        <h2 className="panel-title font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Рекомендация
        </h2>
        <p className="mt-4 animate-pulse font-mono text-sm text-muted-foreground">Расчёт…</p>
      </section>
    )
  }

  const { best, top, mode, exact, validSamples, method, effectiveSamples, policy, expectedShots } =
    analysis
  const info = MODE_INFO[mode]

  return (
    <section
      aria-label="Рекомендация движка"
      className={cn('panel p-4 transition-opacity sm:p-5', computing && 'opacity-70')}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="panel-title font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Рекомендация
          {computing && <span className="ml-1 animate-pulse text-primary">·</span>}
        </h2>
        <span
          className={cn(
            'rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest',
            info.className,
          )}
        >
          {info.label}
        </span>
      </div>

      {mode === 'won' ? (
        <p className="mt-4 text-lg font-semibold text-primary">
          Победа! Флот противника уничтожен.
        </p>
      ) : mode === 'inconsistent' ? (
        <p className="mt-4 text-sm leading-relaxed text-destructive">
          Отметки на поле противоречат правилам. Проверьте попадания и потопленные корабли (или
          переключите набор правил в настройках).
        </p>
      ) : best !== null ? (
        <>
          <div className="relative mt-4 overflow-hidden rounded-lg border border-signal/30 bg-signal/[0.07] p-4">
            <span
              aria-hidden
              className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full bg-signal/15 blur-2xl"
            />
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-signal">
                  Лучший выстрел
                </div>
                <div className="animate-signal-glow font-mono text-5xl font-bold leading-tight text-signal">
                  {cellName(best)}
                </div>
              </div>
              <div className="pb-1 text-right">
                <div className="font-mono text-2xl font-bold text-foreground">
                  {Math.round(analysis.probs[best] * 100)}%
                </div>
                <div className="text-xs text-muted-foreground">
                  {exact ? 'вероятность попадания' : 'относительный вес'}
                </div>
              </div>
            </div>
          </div>

          {top.length > 1 && (
            <div className="mt-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Альтернативы
              </div>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {top.slice(1).map(({ idx, p }) => (
                  <li
                    key={idx}
                    className="rounded-md border border-border bg-secondary/50 px-2 py-1 font-mono text-xs text-foreground/90"
                  >
                    {cellName(idx)} <span className="text-muted-foreground">·</span>{' '}
                    {Math.round(p * 100)}%
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : null}

      <div className="mt-4 space-y-1 border-t border-border pt-3 font-mono text-xs leading-relaxed text-muted-foreground">
        <div>
          Метод: {METHOD_LABEL[method]}
          {method === 'enumerated' && <> · конфигураций: {validSamples.toLocaleString('ru-RU')}</>}
          {method === 'montecarlo' && (
            <>
              {' '}
              · сэмплов: {validSamples.toLocaleString('ru-RU')} (эфф.:{' '}
              {effectiveSamples.toLocaleString('ru-RU')})
            </>
          )}
        </div>
        {(mode === 'hunt' || mode === 'target') && (
          <div>
            Стратегия: {POLICY_LABEL[policy]}
            {policy === 'expectimax' && expectedShots !== null && (
              <>
                {' '}
                · до победы ≈ {expectedShots.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}{' '}
                выстр.
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
