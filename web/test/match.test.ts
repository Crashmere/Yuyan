import { describe, expect, it } from 'vitest'
import { pinyinMatch, pinyinQuery, score, units } from '../src/app/search/match'

// Spellings as the server gives them (internal/server/pinyin.go).
const shortestPath = units('01 zui/cuo duan lu/luo')
const bloomFilter = units('bu long guo lv/lu qi')
const decorator = units('zhuang shi decorator')

describe('pinyinMatch', () => {
  it('matches pinyin typed in full, by initials or mixed, from any character', () => {
    for (const q of ['zuiduanlu', 'zdl', 'zuidl', 'zuiduanl', '01zdl', 'duanlu', 'dl']) {
      expect(pinyinMatch(shortestPath, q), q).toBeGreaterThanOrEqual(0)
    }
    expect(pinyinMatch(shortestPath, 'zuiduanlu')).toBe(1)
    expect(pinyinMatch(shortestPath, 'duanlu')).toBe(2)
    expect(pinyinMatch(decorator, 'zsdeco')).toBe(0)
    expect(pinyinMatch(bloomFilter, 'blglq')).toBe(0)
  })

  it('accepts every reading of a character and both spellings of ü', () => {
    expect(pinyinMatch(shortestPath, 'cuoduan')).toBe(1)
    expect(pinyinMatch(bloomFilter, 'guolvqi')).toBe(2)
    expect(pinyinMatch(bloomFilter, 'guoluqi')).toBe(2)
  })

  it('does not match syllables out of order or letters that are not there', () => {
    expect(pinyinMatch(shortestPath, 'duanzui')).toBe(-1)
    expect(pinyinMatch(shortestPath, 'zuix')).toBe(-1)
    expect(pinyinMatch(decorator, 'corator')).toBe(-1)
  })
})

describe('pinyinQuery and score', () => {
  it('ignores spaces and apostrophes between syllables and leaves other text to plain matching', () => {
    expect(pinyinQuery("Zui Duan'Lu")).toBe('zuiduanlu')
    expect(pinyinQuery('最短')).toBeNull()
  })

  it('ranks containing the text above matching its pinyin, and starting above matching later', () => {
    expect(score('01 最短路', shortestPath, '01')).toBe(4)
    expect(score('01 最短路', shortestPath, '最短')).toBe(3)
    expect(score('01 最短路', shortestPath, '01zuiduan')).toBe(2)
    expect(score('01 最短路', shortestPath, 'zuiduan')).toBe(1)
    expect(score('01 最短路', shortestPath, 'xyz')).toBe(0)
  })
})
