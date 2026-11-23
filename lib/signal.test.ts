import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSignal } from './signal.ts'
import { parseIntent } from './intent.ts'

test('compact call', () => {
  const s = parseSignal('ETH long 3,400 / stop 3,320 / target 3,560')!
  assert.equal(s.coin, 'ETH'); assert.equal(s.side, 'long')
  assert.equal(s.entry, 3400); assert.equal(s.stop, 3320); assert.equal(s.target, 3560)
  assert.ok(s.confidence >= 0.9)
})

test('channel template with range and leverage', () => {
  const s = parseSignal('🚀 #BTC LONG\nEntry: 97,200 - 97,500\nSL: 95,800\nTP1: 99,000\nTP2: 101,000\nLeverage: 5x')!
  assert.equal(s.coin, 'BTC'); assert.equal(s.entry, 97200); assert.equal(s.entryHigh, 97500)
  assert.equal(s.stop, 95800); assert.equal(s.target, 99000); assert.equal(s.leverage, 5)
})

test('short with @', () => {
  const s = parseSignal('Short SOL @ 184.2 sl 190 tp 175')!
  assert.equal(s.side, 'short'); assert.equal(s.entry, 184.2); assert.equal(s.stop, 190); assert.equal(s.target, 175)
})

test('indonesian', () => {
  const s = parseSignal('$HYPE beli 39.1 sl 37 tp 44')!
  assert.equal(s.coin, 'HYPE'); assert.equal(s.side, 'long'); assert.equal(s.entry, 39.1)
})

test('k suffix', () => {
  const s = parseSignal('BTC short 98k, stop 99.5k, target 95k')!
  assert.equal(s.entry, 98000); assert.equal(s.stop, 99500); assert.equal(s.target, 95000)
})

test('chatter is ignored', () => {
  assert.equal(parseSignal('gm everyone, what a day'), null)
  assert.equal(parseSignal('long and short of it is we wait'), null)
  const recap = parseSignal('ETH long closed, TP hit +12%')
  assert.ok(!recap || recap.confidence < 0.5)
})

test('wrong-side stop lowers confidence', () => {
  const s = parseSignal('ETH long 3400 stop 3500 target 3600')!
  assert.ok(s.confidence < 0.7)
})

test('intents', () => {
  assert.deepEqual(parseIntent('Skip.'), { action: 'skip' })
  assert.deepEqual(parseIntent('buy fifty'), { action: 'buy', amountUsd: undefined })
  assert.deepEqual(parseIntent('Buy 100 dollars'), { action: 'buy', amountUsd: 100 })
  assert.deepEqual(parseIntent('close half'), { action: 'close', fraction: 0.5 })
  assert.deepEqual(parseIntent('tutup setengah'), { action: 'close', fraction: 0.5 })
  assert.deepEqual(parseIntent('yes'), { action: 'yes' })
  assert.deepEqual(parseIntent('lewati'), { action: 'skip' })
  assert.deepEqual(parseIntent('hmm'), { action: 'unknown' })
})

test('unlabeled entry range', () => {
  const s = parseSignal('SOL long 182-184, sl 176, tp 196')!
  assert.equal(s.entry, 182)
  assert.equal(s.entryHigh, 184)
  assert.equal(s.stop, 176)
  assert.equal(s.target, 196)
})
