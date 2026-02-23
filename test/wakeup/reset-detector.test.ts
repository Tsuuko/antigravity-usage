/**
 * Tests for smart reset detector module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ModelQuotaInfo, QuotaSnapshot } from '../../src/quota/types.js'
import { isModelUnused, findUnusedModels, hasUnusedModels } from '../../src/wakeup/reset-detector.js'
import * as storage from '../../src/wakeup/storage.js'
import type { ResetState } from '../../src/wakeup/types.js'

// Mock the storage module to control reset state
vi.mock('../../src/wakeup/storage.js', async () => {
  const actual = await vi.importActual('../../src/wakeup/storage.js')
  return {
    ...actual,
    loadResetState: vi.fn(),
    getResetKey: vi.fn((id: string) => id)
  }
})

// Helper to create model info with specified values
function createModelInfo(overrides: Partial<ModelQuotaInfo> = {}): ModelQuotaInfo {
  return {
    label: 'Test Model',
    modelId: 'test-model',
    remainingPercentage: 100,
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

describe('Smart Reset Detector', () => {
  let mockResetState: ResetState

  beforeEach(() => {
    vi.clearAllMocks()
    mockResetState = {}
    vi.mocked(storage.loadResetState).mockReturnValue(mockResetState)
    vi.mocked(storage.getResetKey).mockImplementation((id: string) => id)
  })

  describe('isModelUnused', () => {
    it('should return true for unused model (100% remaining, no previous reset state)', () => {
      const model = createModelInfo({
        remainingPercentage: 100,
      })

      expect(isModelUnused(model, mockResetState)).toBe(true)
    })

    it('should return true if resetTime changed from previous state', () => {
      const model = createModelInfo({
        remainingPercentage: 100,
        modelId: 'test-model',
        resetTime: '2026-02-24T20:00:00Z'
      })

      mockResetState['test-model'] = {
        lastResetAt: '2026-02-23T20:00:00Z',
        lastTriggeredTime: new Date().toISOString()
      }

      expect(isModelUnused(model, mockResetState)).toBe(true)
    })

    it('should return false if resetTime is exactly the same (deduplication)', () => {
      const model = createModelInfo({
        remainingPercentage: 100,
        modelId: 'test-model',
        resetTime: '2026-02-23T20:00:00Z'
      })

      mockResetState['test-model'] = {
        lastResetAt: '2026-02-23T20:00:00Z',
        lastTriggeredTime: new Date().toISOString()
      }

      expect(isModelUnused(model, mockResetState)).toBe(false)
    })

    it('should return true for 99% remaining (within threshold)', () => {
      const model = createModelInfo({
        remainingPercentage: 99,
      })

      expect(isModelUnused(model, mockResetState)).toBe(true)
    })

    it('should return false for used model (less than 99%)', () => {
      const model = createModelInfo({
        remainingPercentage: 98,
      })

      expect(isModelUnused(model, mockResetState)).toBe(false)
    })

    it('should return false for exhausted model', () => {
      const model = createModelInfo({
        remainingPercentage: 0,
        isExhausted: true,
      })

      expect(isModelUnused(model, mockResetState)).toBe(false)
    })

    it('should return false if no remaining percentage', () => {
      const model = createModelInfo({
        remainingPercentage: undefined,
      })

      expect(isModelUnused(model, mockResetState)).toBe(false)
    })

    it('should return false if no reset time from API', () => {
      const model = createModelInfo({
        remainingPercentage: 100,
        resetTime: undefined
      })

      expect(isModelUnused(model, mockResetState)).toBe(false)
    })
  })

  describe('findUnusedModels', () => {
    it('should return empty array when no models are unused (either used or same resetState)', () => {
      mockResetState['model-2'] = {
        lastResetAt: '2026-02-23T20:00:00Z',
        lastTriggeredTime: new Date().toISOString()
      }

      const snapshot = createSnapshot([
        createModelInfo({
          modelId: 'model-1',
          remainingPercentage: 50, // Used
        }),
        createModelInfo({
          modelId: 'model-2',
          remainingPercentage: 100,
          resetTime: '2026-02-23T20:00:00Z' // Same reset time (deduplicated)
        })
      ])

      expect(findUnusedModels(snapshot)).toEqual([])
    })

    it('should return only unused models that have changed resetTimes', () => {
      mockResetState['used-model'] = { lastResetAt: '2026-02-23T20:00:00Z', lastTriggeredTime: new Date().toISOString() }
      mockResetState['unchanged-model'] = { lastResetAt: '2026-02-23T20:00:00Z', lastTriggeredTime: new Date().toISOString() }
      mockResetState['changed-model'] = { lastResetAt: '2026-02-21T20:00:00Z', lastTriggeredTime: new Date().toISOString() }

      const snapshot = createSnapshot([
        createModelInfo({
          modelId: 'used-model',
          remainingPercentage: 50,
          resetTime: '2026-02-24T20:00:00Z'
        }),
        createModelInfo({
          modelId: 'unchanged-model',
          remainingPercentage: 100,
          resetTime: '2026-02-23T20:00:00Z'
        }),
        createModelInfo({
          modelId: 'changed-model',
          remainingPercentage: 100,
          resetTime: '2026-02-24T20:00:00Z'
        }),
        createModelInfo({
          modelId: 'new-model',
          remainingPercentage: 100,
          resetTime: '2026-02-24T20:00:00Z'
        })
      ])

      const unused = findUnusedModels(snapshot)

      expect(unused).toHaveLength(2)
      expect(unused.map(m => m.modelId)).toContain('changed-model')
      expect(unused.map(m => m.modelId)).toContain('new-model')
    })
  })

  describe('hasUnusedModels', () => {
    it('should return false when no models are unused', () => {
      const snapshot = createSnapshot([
        createModelInfo({ remainingPercentage: 50 })
      ])

      expect(hasUnusedModels(snapshot)).toBe(false)
    })

    it('should return true when at least one model is unused', () => {
      const snapshot = createSnapshot([
        createModelInfo({
          modelId: 'used',
          remainingPercentage: 50,
        }),
        createModelInfo({
          modelId: 'unused',
          remainingPercentage: 100,
          resetTime: '2026-02-24T20:00:00Z'
        })
      ])

      expect(hasUnusedModels(snapshot)).toBe(true)
    })
  })
})
