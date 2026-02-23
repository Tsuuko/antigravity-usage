/**
 * Tests for smart reset detector module
 */

import { describe, it, expect, vi } from 'vitest'
import type { ModelQuotaInfo, QuotaSnapshot } from '../../src/quota/types.js'
import type { WakeupState } from '../../src/wakeup/types.js'
import { isModelUnused, findUnusedModels, hasUnusedModels } from '../../src/wakeup/reset-detector.js'

// Helper to create model info with specified values
function createModelInfo(overrides: Partial<ModelQuotaInfo> = {}): ModelQuotaInfo {
  return {
    label: 'Test Model',
    modelId: 'test-model',
    remainingPercentage: 1,
    isExhausted: false,
    resetTime: '2026-02-23T20:00:00Z',
    timeUntilResetMs: 5 * 60 * 60 * 1000,
    ...overrides
  }
}

function createSnapshot(models: ModelQuotaInfo[]): QuotaSnapshot {
  return {
    timestamp: new Date().toISOString(),
    method: 'google',
    models
  }
}

function createWakeupState(models: ModelQuotaInfo[]): WakeupState {
  const state: WakeupState = {}
  for (const model of models) {
    if (model.resetTime) {
      state[model.modelId] = model.resetTime
    }
  }
  return state
}

describe('Smart Reset Detector', () => {
  describe('isModelUnused', () => {
    it('should return true for unused model (100% remaining, no previous snapshot)', () => {
      const model = createModelInfo({ remainingPercentage: 1 })
      expect(isModelUnused(model, null)).toBe(true)
    })

    it('should return true if resetTime changed from previous snapshot', () => {
      const model = createModelInfo({
        remainingPercentage: 1,
        modelId: 'test-model',
        resetTime: '2026-02-24T20:00:00Z'
      })

      const previousState = createWakeupState([
        createModelInfo({
          modelId: 'test-model',
          resetTime: '2026-02-23T20:00:00Z'
        })
      ])

      expect(isModelUnused(model, previousState)).toBe(true)
    })

    it('should return false if resetTime is exactly the same (deduplication)', () => {
      const model = createModelInfo({
        remainingPercentage: 1,
        modelId: 'test-model',
        resetTime: '2026-02-23T20:00:00Z'
      })

      const previousState = createWakeupState([
        createModelInfo({
          modelId: 'test-model',
          resetTime: '2026-02-23T20:00:00Z'
        })
      ])

      expect(isModelUnused(model, previousState)).toBe(false)
    })

    it('should return true for model not in previous snapshot (new model)', () => {
      const model = createModelInfo({
        remainingPercentage: 1,
        modelId: 'new-model',
        resetTime: '2026-02-24T20:00:00Z'
      })

      const previousState = createWakeupState([
        createModelInfo({
          modelId: 'other-model',
          resetTime: '2026-02-23T20:00:00Z'
        })
      ])

      expect(isModelUnused(model, previousState)).toBe(true)
    })

    it('should return false if test-model is NOT fully unused (only 50% left) even if resetTime changed', () => {
      const model = createModelInfo({
        remainingPercentage: 0.5, // Not fully unused
        modelId: 'test-model',
        resetTime: '2026-02-24T20:00:00Z'
      })

      const previousState = createWakeupState([
        createModelInfo({
          modelId: 'test-model',
          resetTime: '2026-02-23T20:00:00Z'
        })
      ])

      expect(isModelUnused(model, previousState)).toBe(false)
    })

    it('should return true for 99% remaining (within threshold)', () => {
      const model = createModelInfo({ remainingPercentage: 0.99 })
      expect(isModelUnused(model, null)).toBe(true)
    })

    it('should return false for used model (less than 99%)', () => {
      const model = createModelInfo({ remainingPercentage: 0.98 })
      expect(isModelUnused(model, null)).toBe(false)
    })

    it('should return false for exhausted model', () => {
      const model = createModelInfo({
        remainingPercentage: 0,
        isExhausted: true,
      })
      expect(isModelUnused(model, null)).toBe(false)
    })

    it('should return false if no remaining percentage', () => {
      const model = createModelInfo({ remainingPercentage: undefined })
      expect(isModelUnused(model, null)).toBe(false)
    })

    it('should return false if no reset time from API', () => {
      const model = createModelInfo({
        remainingPercentage: 1,
        resetTime: undefined
      })
      expect(isModelUnused(model, null)).toBe(false)
    })
  })

  describe('findUnusedModels', () => {
    it('should return empty array when no models are unused (either used or same resetTime)', () => {
      const previousState = createWakeupState([
        createModelInfo({
          modelId: 'model-2',
          resetTime: '2026-02-23T20:00:00Z'
        })
      ])

      const snapshot = createSnapshot([
        createModelInfo({
          modelId: 'model-1',
          remainingPercentage: 0.5, // Used
        }),
        createModelInfo({
          modelId: 'model-2',
          remainingPercentage: 1,
          resetTime: '2026-02-23T20:00:00Z' // Same reset time (deduplicated)
        })
      ])

      expect(findUnusedModels(snapshot, previousState)).toEqual([])
    })

    it('should return only unused models that have changed resetTimes', () => {
      const previousState = createWakeupState([
        createModelInfo({
          modelId: 'used-model',
          resetTime: '2026-02-23T20:00:00Z'
        }),
        createModelInfo({
          modelId: 'unchanged-model',
          resetTime: '2026-02-23T20:00:00Z'
        }),
        createModelInfo({
          modelId: 'changed-model',
          resetTime: '2026-02-21T20:00:00Z'
        })
      ])

      const snapshot = createSnapshot([
        createModelInfo({
          modelId: 'used-model',
          remainingPercentage: 0.5,
          resetTime: '2026-02-24T20:00:00Z'
        }),
        createModelInfo({
          modelId: 'unchanged-model',
          remainingPercentage: 1,
          resetTime: '2026-02-23T20:00:00Z'
        }),
        createModelInfo({
          modelId: 'changed-model',
          remainingPercentage: 1,
          resetTime: '2026-02-24T20:00:00Z'
        }),
        createModelInfo({
          modelId: 'new-model',
          remainingPercentage: 1,
          resetTime: '2026-02-24T20:00:00Z'
        })
      ])

      const unused = findUnusedModels(snapshot, previousState)

      expect(unused).toHaveLength(2)
      expect(unused.map(m => m.modelId)).toContain('changed-model')
      expect(unused.map(m => m.modelId)).toContain('new-model')
    })
  })

  describe('hasUnusedModels', () => {
    it('should return false when no models are unused', () => {
      const snapshot = createSnapshot([
        createModelInfo({ remainingPercentage: 0.5 })
      ])

      expect(hasUnusedModels(snapshot, null)).toBe(false)
    })

    it('should return true when at least one model is unused (first run)', () => {
      const snapshot = createSnapshot([
        createModelInfo({
          modelId: 'used',
          remainingPercentage: 0.5,
        }),
        createModelInfo({
          modelId: 'unused',
          remainingPercentage: 1,
          resetTime: '2026-02-24T20:00:00Z'
        })
      ])

      expect(hasUnusedModels(snapshot, null)).toBe(true)
    })
  })
})
