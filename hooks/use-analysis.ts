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
  const workerFailed = useRef(false)
  const requestId = useRef(0)
  /** id последнего запроса, на который воркер уже ответил */
  const answeredId = useRef(0)

  useEffect(() => {
    try {
      const worker = new Worker(new URL('../lib/engine.worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.id === requestId.current) {
          answeredId.current = e.data.id
          setAnalysis(e.data.result)
          setComputing(false)
        }
      }
      worker.onerror = () => {
        workerFailed.current = true
      }
      workerRef.current = worker
      return () => worker.terminate()
    } catch {
      workerFailed.current = true
    }
  }, [])

  useEffect(() => {
    const id = ++requestId.current
    const worker = workerRef.current

    if (worker && !workerFailed.current) {
      setComputing(true)
      worker.postMessage({ id, board, rules, ships })
      // Страховка: если воркер молчит (первый запуск = компиляция модуля),
      // показываем быстрый синхронный результат, но воркер НЕ отключаем:
      // его более точный ответ применится, когда придёт. Если воркер уже
      // ответил на этот запрос — fallback не нужен и результат не трогаем.
      const timer = setTimeout(() => {
        if (requestId.current === id && answeredId.current !== id) {
          setAnalysis(analyze(board, rules, ships, SYNC_FALLBACK_OPTIONS))
        }
      }, 1200)
      return () => clearTimeout(timer)
    }

    setAnalysis(analyze(board, rules, ships, SYNC_FALLBACK_OPTIONS))
    setComputing(false)
  }, [board, rules, ships])

  return { analysis, computing }
}
