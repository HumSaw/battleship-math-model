'use client'

import { cn } from '@/lib/utils'

function ShipRow({ length, destroyed }: { length: number; destroyed?: boolean }) {
  return (
    <div className="flex items-center gap-0.5" aria-hidden>
      {Array.from({ length }, (_, i) => (
        <span
          key={i}
          className={cn(
            'size-3.5 rounded-[2px]',
            destroyed ? 'bg-destructive/40' : 'bg-primary/80',
          )}
        />
      ))}
    </div>
  )
}

export function FleetStatus({
  remaining,
  destroyed,
}: {
  remaining: number[]
  destroyed: number[]
}) {
  return (
    <section aria-label="Флот противника" className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Флот противника
      </h2>
      <p className="sr-only">
        В строю кораблей: {remaining.length}, потоплено: {destroyed.length}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {remaining.length === 0 && destroyed.length === 0 && (
          <p className="text-sm text-muted-foreground">Флот не определён</p>
        )}
        {remaining.map((len, i) => (
          <div key={`r-${i}`} className="flex items-center justify-between gap-3">
            <ShipRow length={len} />
            <span className="font-mono text-xs text-muted-foreground">в строю</span>
          </div>
        ))}
        {destroyed.map((len, i) => (
          <div key={`d-${i}`} className="flex items-center justify-between gap-3 opacity-70">
            <ShipRow length={len} destroyed />
            <span className="font-mono text-xs text-destructive/80">потоплен</span>
          </div>
        ))}
      </div>
    </section>
  )
}
