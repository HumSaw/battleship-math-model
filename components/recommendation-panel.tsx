'use client'

import { cn } from '@/lib/utils'
import { cellName, type Analysis } from '@/lib/battleship-engine'
import type { Locale, Messages } from '@/lib/i18n'

const MODE_CLASS: Record<Analysis['mode'], string> = {
  hunt: 'border-primary/40 bg-primary/10 text-primary',
  target: 'border-destructive/40 bg-destructive/15 text-destructive',
  won: 'border-primary/40 bg-primary/10 text-primary',
  inconsistent: 'border-destructive/40 bg-destructive/15 text-destructive',
}

export function RecommendationPanel({
  analysis,
  computing,
  messages: t,
  locale,
}: {
  analysis: Analysis | null
  computing: boolean
  messages: Messages
  locale: Locale
}) {
  if (!analysis) {
    return (
      <section aria-label={t.recommendation} className="panel p-4 sm:p-5">
        <h2 className="panel-title font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t.recommendation}
        </h2>
        <p className="mt-4 animate-pulse font-mono text-sm text-muted-foreground">
          {t.calculating}
        </p>
      </section>
    )
  }

  const { best, top, mode, exact, validSamples, method, effectiveSamples, policy, expectedShots } =
    analysis

  const modeLabel: Record<Analysis['mode'], string> = {
    hunt: t.hunt,
    target: t.target,
    won: t.victory,
    inconsistent: t.conflict,
  }
  const methodLabel: Record<Analysis['method'], string> = {
    enumerated: t.exactEnum,
    montecarlo: t.weightedMc,
    heuristic: t.density,
  }
  const policyLabel: Record<Analysis['policy'], string> = {
    expectimax: t.expectimax,
    lookahead: t.lookahead,
    maxprob: t.maxprob,
  }

  return (
    <section
      aria-label={t.recommendation}
      className={cn('panel p-4 transition-opacity sm:p-5', computing && 'opacity-70')}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="panel-title font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t.recommendation}
          {computing && <span className="ms-1 animate-pulse text-primary">·</span>}
        </h2>
        <span
          className={cn(
            'rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest',
            MODE_CLASS[mode],
          )}
        >
          {modeLabel[mode]}
        </span>
      </div>

      {mode === 'won' ? (
        <p className="mt-4 text-lg font-semibold text-primary">{t.wonText}</p>
      ) : mode === 'inconsistent' ? (
        <p className="mt-4 text-sm leading-relaxed text-destructive">{t.conflictText}</p>
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
                  {t.bestShot}
                </div>
                <div className="animate-signal-glow font-mono text-5xl font-bold leading-tight text-signal">
                  {cellName(best)}
                </div>
              </div>
              <div className="pb-1 text-end">
                <div className="font-mono text-2xl font-bold text-foreground">
                  {Math.round(analysis.probs[best] * 100)}%
                </div>
                <div className="text-xs text-muted-foreground">
                  {exact ? t.hitProbability : t.relativeWeight}
                </div>
              </div>
            </div>
          </div>

          {top.length > 1 && (
            <div className="mt-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {t.alternatives}
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

      <div className="mt-4 flex flex-col gap-1 border-t border-border pt-3 font-mono text-xs leading-relaxed text-muted-foreground">
        <div>
          {t.method}: {methodLabel[method]}
          {method === 'enumerated' && (
            <>
              {' '}
              · {t.configurations}: {validSamples.toLocaleString(locale)}
            </>
          )}
          {method === 'montecarlo' && (
            <>
              {' '}
              · {t.samples}: {validSamples.toLocaleString(locale)} ({t.effective}:{' '}
              {effectiveSamples.toLocaleString(locale)})
            </>
          )}
        </div>
        {(mode === 'hunt' || mode === 'target') && (
          <div>
            {t.strategy}: {policyLabel[policy]}
            {policy === 'expectimax' && expectedShots !== null && (
              <>
                {' '}
                · ≈ {expectedShots.toLocaleString(locale, { maximumFractionDigits: 1 })}{' '}
                {t.untilVictory}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
