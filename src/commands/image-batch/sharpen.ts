import { ImageBatchUsageError } from './errors.js'

export const SHARPEN_TARGETS = ['screen', 'matte', 'glossy'] as const
export const SHARPEN_AMOUNTS = ['low', 'standard', 'high'] as const

export type SharpenTarget = (typeof SHARPEN_TARGETS)[number]
export type SharpenAmount = (typeof SHARPEN_AMOUNTS)[number]

export interface SharpenSpec {
  for: SharpenTarget
  amount: SharpenAmount
}

export interface SharpenParams {
  sigma: number
  m1: number
  m2: number
}

const RADIUS: Record<SharpenTarget, number> = { screen: 0.6, matte: 1, glossy: 1.4 }
const STRENGTH: Record<SharpenAmount, { m1: number; m2: number }> = {
  low: { m1: 0.5, m2: 1.5 },
  standard: { m1: 1, m2: 3 },
  high: { m1: 1.8, m2: 5 },
}

export function sharpenParams(spec: SharpenSpec): SharpenParams {
  return { sigma: RADIUS[spec.for], ...STRENGTH[spec.amount] }
}

export function completeSharpen(partial: Partial<SharpenSpec>): SharpenSpec {
  return { for: partial.for ?? 'screen', amount: partial.amount ?? 'standard' }
}

export function parseSharpenFlags(
  target: string | undefined,
  amount: string | undefined,
): Partial<SharpenSpec> | undefined {
  const spec: Partial<SharpenSpec> = {}
  if (target !== undefined) {
    if (!(SHARPEN_TARGETS as readonly string[]).includes(target)) {
      throw new ImageBatchUsageError(`--sharpen-for must be one of ${SHARPEN_TARGETS.join(', ')}`)
    }
    spec.for = target as SharpenTarget
  }
  if (amount !== undefined) {
    if (!(SHARPEN_AMOUNTS as readonly string[]).includes(amount)) {
      throw new ImageBatchUsageError(
        `--sharpen-amount must be one of ${SHARPEN_AMOUNTS.join(', ')}`,
      )
    }
    spec.amount = amount as SharpenAmount
  }
  return Object.keys(spec).length > 0 ? spec : undefined
}
