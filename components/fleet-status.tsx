'use client'

import { cn } from '@/lib/utils'
import type { Messages } from '@/lib/i18n'

function ShipRow({ length, destroyed }: { length: number; destroyed?: boolean }) {
  return (
    <div className="flex items-center gap-[3px]" aria-hidden>
      {Array.from({ length }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-3.5 w-4 rounded-[3px] transition-colors',
            i === 0 && 'rounded-l-full',
            i === length - 1 && 'rounded-r-full',
            destroyed
              ? 'bg-destructive/35'
              : 'bg-primary/75 shadow-[0_0_6px_-1px] shadow-primary/50',
          )}
        />
      ))}
    </div>
  )
}

export function FleetStatus({
  remaining,
  destroyed,
  messages,
}: {
  remaining: number[]
  destroyed: number[]
  messages: Messages
}) {
  const total = remaining.length + destroyed.length

  return (
    <section aria-label={messages.enemyFleet} className="panel p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="panel-title font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {messages.enemyFleet}
        </h2>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {remaining.length}/{total > 0 ? total : '—'}
        </span>
      </div>
      <p className="sr-only">
        {messages.afloat}: {remaining.length}, {messages.fleetSunk}: {destroyed.length}
      </p>
      <div className="mt-3.5 flex flex-col gap-2">
        {remaining.length === 0 && destroyed.length === 0 && (
          <p className="text-sm text-muted-foreground">{messages.fleetUnknown}</p>
        )}
        {remaining.map((len, i) => (
          <div key={`r-${i}`} className="flex items-center justify-between gap-3">
            <ShipRow length={len} />
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {messages.afloat}
            </span>
          </div>
        ))}
        {destroyed.map((len, i) => (
          <div key={`d-${i}`} className="flex items-center justify-between gap-3 opacity-60">
            <ShipRow length={len} destroyed />
            <span className="font-mono text-[10px] uppercase tracking-widest text-destructive/80">
              {messages.fleetSunk}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
