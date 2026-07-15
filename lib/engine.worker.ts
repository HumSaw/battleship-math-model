// Web Worker: тяжёлый анализ выполняется вне главного потока,
// поэтому здесь можно позволить себе большой бюджет сэмплов.

import { analyze, type RulesMode } from './battleship-engine'

interface Request {
  id: number
  board: number[]
  rules: RulesMode
  ships: number[][]
}

const WORKER_OPTIONS = {
  targetSamples: 30000,
  maxAttempts: 500000,
  timeBudgetMs: 700,
  enumLimit: 200000,
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, board, rules, ships } = e.data
  const result = analyze(board, rules, ships, WORKER_OPTIONS)
  self.postMessage({ id, result })
}
