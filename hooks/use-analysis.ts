'use client'

import { useEffect, useRef, useState } from 'react'
import { analyze, type Analysis, type RulesMode } from '@/lib/battleship-engine'

// Лёгкие параметры для синхронного запасного пути (если воркер недоступен)
const SYNC_FALLBACK_OPTIONS = {
  targetSamples: 4000,
  maxAttempts: 60000,
  timeBudgetMs: 200,
  enumLimit: 100000,
}

interface WorkerResponse {
  id: number
  result: Analysis
}

/**
 * Анализ позиции в Web Worker: интерфейс не блокируется, бюджет сэмплов большой.
 * Пока считается новый результат, возвращается предыдущий + флаг computing.
 */
export function useAnalysis(
  board: number[],
  rules: RulesMode,
  ships: number[][],
): { analysis: Analysis | null; computing: boolean } {
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [computing, setComputing] = useState(true)
  const workerRef = useRef<Worker | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    const id = ++requestId.current
    // analyze() синхронен внутри воркера и не умеет отменяться. Уничтожаем старый
    // воркер, иначе быстрые клики образуют очередь устаревших расчётов до 900 мс каждый.
    workerRef.current?.terminate()
    setComputing(true)

    let worker: Worker
    let answered = false
    try {
      worker = new Worker(new URL('../lib/engine.worker.ts', import.meta.url), {
        type: 'module',
      })
      workerRef.current = worker
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.id !== requestId.current) return
        answered = true
        setAnalysis(e.data.result)
        setComputing(false)
      }
      worker.onerror = () => {
        if (id !== requestId.current) return
        setAnalysis(analyze(board, rules, ships, SYNC_FALLBACK_OPTIONS))
        setComputing(false)
      }
      worker.postMessage({ id, board, rules, ships })
    } catch {
      setAnalysis(analyze(board, rules, ships, SYNC_FALLBACK_OPTIONS))
      setComputing(false)
      return
    }

    // Быстрый предварительный ответ, пока точный воркер продолжает считать.
    const timer = window.setTimeout(() => {
      if (requestId.current === id && !answered) {
        setAnalysis(analyze(board, rules, ships, SYNC_FALLBACK_OPTIONS))
      }
    }, 1200)

    return () => {
      window.clearTimeout(timer)
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
  }, [board, rules, ships])

  return { analysis, computing }
}
