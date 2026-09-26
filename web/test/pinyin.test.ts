import { describe, expect, it } from 'vitest'
import { initials } from '../src/app/search/pinyin'

describe('initials', () => {
  it('gives the pinyin initial of each Chinese character and keeps other text in lower case', () => {
    expect(initials('01 最短路')).toBe('01 zdl')
    expect(initials('RocketMQ_是如何')).toBe('rocketmq_srh')
  })

  it('places characters near the start of each group, which hand-picked boundaries got wrong', () => {
    expect(initials('路楼龙六流罗论旅律绿零')).toBe('lllllllllll')
    expect(initials('布隆过滤器')).toBe('blglq')
    expect(initials('如入若')).toBe('rrr')
    expect(initials('他喔')).toBe('to')
    expect(initials('啊八擦大饿发嘎哈鸡卡拉妈拿欧怕七然撒他挖西压杂')).toBe('abcdefghjklmnopqrstwxyz')
  })
})
