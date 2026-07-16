import { describe, expect, it } from 'vitest'

import {
  CELLS,
  FLEETS,
  HIT,
  MISS,
  SIZE,
  SUNK,
  UNKNOWN,
  analyze,
  cellName,
  floodClusters,
  isStraightLine,
  neighbors8,
  orthoNeighbors,
} from './battleship-engine'

const emptyBoard = () => new Array<number>(CELLS).fill(UNKNOWN)
const fast = { targetSamples: 300, maxAttempts: 8_000, timeBudgetMs: 200, enumLimit: 20_000 }
const deterministic = {
  targetSamples: 80,
  maxAttempts: 20_000,
  timeBudgetMs: 2_000,
  enumLimit: 20_000,
}

describe('coordinate helpers', () => {
  it('uses Latin row letters and numeric columns', () => {
    expect(cellName(0)).toBe('A1')
    expect(cellName(49)).toBe('E10')
    expect(cellName(99)).toBe('J10')
  })

  it('does not wrap orthogonal neighbors across rows', () => {
    expect(orthoNeighbors(9).sort((a, b) => a - b)).toEqual([8, 19])
    expect(orthoNeighbors(10).sort((a, b) => a - b)).toEqual([0, 11, 20])
  })

  it('returns the correct eight-neighborhood at corners and center', () => {
    expect(neighbors8(0).sort((a, b) => a - b)).toEqual([1, 10, 11])
    expect(neighbors8(44)).toHaveLength(8)
  })
})

describe('board geometry', () => {
  it('accepts contiguous straight ships only', () => {
    expect(isStraightLine([11, 12, 13])).toBe(true)
    expect(isStraightLine([11, 21, 31])).toBe(true)
    expect(isStraightLine([11, 13])).toBe(false)
    expect(isStraightLine([11, 22])).toBe(false)
  })

  it('groups only orthogonally connected cells', () => {
    const board = emptyBoard()
    board[0] = HIT
    board[1] = HIT
    board[11] = HIT
    board[99] = HIT
    expect(floodClusters(board, HIT).map((cluster) => cluster.sort((a, b) => a - b))).toEqual([
      [0, 1, 11],
      [99],
    ])
  })
})

describe('analysis invariants', () => {
  it('returns a legal deterministic recommendation on an empty Russian board', () => {
    const board = emptyBoard()
    const first = analyze(board, 'russian', null, deterministic)
    const second = analyze(board, 'russian', null, deterministic)

    expect(first.best).not.toBeNull()
    expect(first.best).toBe(second.best)
    expect(first.probs).toEqual(second.probs)
    expect(first.remaining).toEqual(FLEETS.russian)
    expect(first.mode).toBe('hunt')
    expect(first.best === null ? -1 : board[first.best]).toBe(UNKNOWN)
  })

  it('never recommends a known miss', () => {
    const board = emptyBoard()
    for (let i = 0; i < SIZE; i++) board[i] = MISS
    const result = analyze(board, 'russian', null, fast)

    expect(result.best).not.toBeNull()
    expect(result.best === null ? MISS : board[result.best]).toBe(UNKNOWN)
    expect(result.probs.slice(0, SIZE)).toEqual(new Array(SIZE).fill(0))
  })

  it('enters target mode and recommends an orthogonal continuation after a hit', () => {
    const board = emptyBoard()
    const hit = 44
    board[hit] = HIT
    const result = analyze(board, 'russian', null, fast)

    expect(result.mode).toBe('target')
    expect(result.best).not.toBeNull()
    expect(orthoNeighbors(hit)).toContain(result.best)
  })

  it('marks diagonals around a Russian sunk ship as impossible', () => {
    const board = emptyBoard()
    const ship = [44, 45]
    for (const cell of ship) board[cell] = SUNK
    const result = analyze(board, 'russian', [ship], fast)

    expect(result.destroyed).toEqual([2])
    for (const cell of [33, 34, 35, 36, 43, 46, 53, 54, 55, 56]) {
      expect(result.impossible[cell]).toBe(true)
    }
  })

  it('rejects malformed and overlapping sunk-ship declarations', () => {
    const board = emptyBoard()
    for (const cell of [0, 1, 11]) board[cell] = SUNK
    const result = analyze(board, 'international', [[0, 1], [1, 11]], fast)
    expect(result.mode).toBe('inconsistent')
    expect(result.best).toBeNull()
  })

  it('recognizes a completed fleet', () => {
    const board = emptyBoard()
    const ships = [
      [0, 1, 2, 3],
      [20, 21, 22],
      [26, 27, 28],
      [40, 41],
      [44, 45],
      [48, 49],
      [60],
      [63],
      [66],
      [69],
    ]
    for (const ship of ships) for (const cell of ship) board[cell] = SUNK
    const result = analyze(board, 'russian', ships, fast)
    expect(result.mode).toBe('won')
    expect(result.remaining).toEqual([])
  })
})
