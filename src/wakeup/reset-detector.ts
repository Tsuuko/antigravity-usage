/**
 * Reset detector for auto wake-up
 *
 * Smart trigger logic:
 * - Triggers ALL available models from quota snapshot
 * - Triggers for ALL valid accounts
 * - Only triggers when model is "unused": 100% remaining AND resetTime has changed since last cached snapshot
 */

import { debug } from '../core/logger.js'
import type { QuotaSnapshot, ModelQuotaInfo } from '../quota/types.js'
import { loadWakeupConfig } from './storage.js'
import { getAccountManager } from '../accounts/manager.js'
import { executeTrigger } from './trigger-service.js'
import type { DetectionResult } from './types.js'

// Smart trigger thresholds
// Note: remainingPercentage is actually a fraction (0-1), not a percentage (0-100)
const FULL_QUOTA_THRESHOLD = 0.99        // Consider "full" if >= 99%

/**
 * Check if a model is "unused" and should be triggered based on previous cache data
 *
 * Unused = 100% quota remaining AND resetTime is different from the previous cached snapshot
 */
export function isModelUnused(model: ModelQuotaInfo, previousSnapshot: QuotaSnapshot | null): boolean {
  // Must have remaining percentage data
  if (model.remainingPercentage === undefined) {
    debug('reset-detector', `${model.modelId}: No remaining percentage data`)
    return false
  }

  // Check if quota is full (100% or very close)
  if (model.remainingPercentage < FULL_QUOTA_THRESHOLD) {
    debug('reset-detector', `${model.modelId}: Not full (${model.remainingPercentage})`)
    return false
  }

  // Must have reset time data from API
  if (!model.resetTime) {
    debug('reset-detector', `${model.modelId}: No reset time data from API`)
    return false
  }

  // If no previous snapshot exists, this is the first run - trigger
  if (!previousSnapshot) {
    debug('reset-detector', `${model.modelId}: UNUSED - No previous snapshot (first run)`)
    return true
  }

  // Find the same model in the previous snapshot
  const previousModel = previousSnapshot.models.find(m => m.modelId === model.modelId)

  // If model wasn't in previous snapshot, it's new - trigger
  if (!previousModel) {
    debug('reset-detector', `${model.modelId}: UNUSED - Model not in previous snapshot`)
    return true
  }

  // Compare resetTime: if changed, the quota cycle has reset
  if (model.resetTime === previousModel.resetTime) {
    debug('reset-detector', `${model.modelId}: Reset time unchanged (${model.resetTime})`)
    return false
  }

  debug('reset-detector', `${model.modelId}: UNUSED - Reset time changed (old: ${previousModel.resetTime}, new: ${model.resetTime})`)
  return true
}

/**
 * Get all valid account emails
 */
function getAllValidAccounts(): string[] {
  const accountManager = getAccountManager()
  const allEmails = accountManager.getAccountEmails()

  return allEmails.filter(email => {
    const status = accountManager.getAccountStatus(email)
    return status === 'valid' || status === 'expired' // Expired can be refreshed
  })
}

/**
 * Detect unused models and trigger wake-up for all accounts
 *
 * Compares the new snapshot against the previous cached snapshot to detect resets.
 * @param snapshot - The newly fetched quota snapshot
 * @param previousSnapshot - The previous cached snapshot (from cache.json), or null if first run
 */
export async function detectResetAndTrigger(
  snapshot: QuotaSnapshot,
  previousSnapshot: QuotaSnapshot | null
): Promise<DetectionResult> {
  debug('reset-detector', 'Checking for unused models (smart trigger)')

  // Load config
  const config = loadWakeupConfig()

  // Must be enabled
  if (!config || !config.enabled) {
    debug('reset-detector', 'Wakeup is not enabled')
    return { triggered: false, triggeredModels: [] }
  }

  // Get ALL valid accounts
  const accounts = getAllValidAccounts()
  if (accounts.length === 0) {
    debug('reset-detector', 'No valid accounts available')
    return { triggered: false, triggeredModels: [] }
  }

  debug('reset-detector', `Found ${accounts.length} valid accounts`)

  // Filter to only selected models
  const selectedSet = new Set(config.selectedModels)
  const targetModels = snapshot.models.filter(m => selectedSet.has(m.modelId))

  debug('reset-detector', `Checking ${targetModels.length} selected models out of ${snapshot.models.length} total`)

  // Find unused models by comparing with previous snapshot
  const modelsToTrigger: string[] = []
  const seenModelIds = new Set<string>()

  for (const model of targetModels) {
    // Skip duplicates
    if (seenModelIds.has(model.modelId)) {
      continue
    }

    // Check if model is unused (resetTime changed from cached version)
    if (!isModelUnused(model, previousSnapshot)) {
      continue
    }

    modelsToTrigger.push(model.modelId)
    seenModelIds.add(model.modelId)
  }

  if (modelsToTrigger.length === 0) {
    debug('reset-detector', 'No unused models to trigger')
    return { triggered: false, triggeredModels: [] }
  }

  console.log(`\n🔄 Found ${modelsToTrigger.length} unused model(s): ${modelsToTrigger.join(', ')}`)
  console.log(`   Triggering for ${accounts.length} account(s)...`)

  // Trigger for ALL accounts
  let successCount = 0
  for (const accountEmail of accounts) {
    try {
      const result = await executeTrigger({
        models: modelsToTrigger,
        accountEmail,
        triggerType: 'auto',
        triggerSource: 'quota_reset',
        customPrompt: config.customPrompt,
        maxOutputTokens: config.maxOutputTokens
      })

      const modelSuccess = result.results.filter(r => r.success).length
      console.log(`   ✅ ${accountEmail}: ${modelSuccess}/${modelsToTrigger.length} succeeded`)
      if (modelSuccess > 0) successCount++
    } catch (err) {
      console.log(`   ❌ ${accountEmail}: ${err instanceof Error ? err.message : err}`)
      debug('reset-detector', `Trigger failed for ${accountEmail}:`, err)
    }
  }

  console.log(`\n📊 Wake-up complete: ${successCount}/${accounts.length} accounts triggered\n`)

  return {
    triggered: true,
    triggeredModels: modelsToTrigger
  }
}

/**
 * Get list of unused models for display/testing
 */
export function findUnusedModels(snapshot: QuotaSnapshot, previousSnapshot: QuotaSnapshot | null = null): ModelQuotaInfo[] {
  return snapshot.models.filter(m => isModelUnused(m, previousSnapshot))
}

/**
 * Check if any models need triggering (for status display)
 */
export function hasUnusedModels(snapshot: QuotaSnapshot, previousSnapshot: QuotaSnapshot | null = null): boolean {
  return snapshot.models.some(m => isModelUnused(m, previousSnapshot))
}
