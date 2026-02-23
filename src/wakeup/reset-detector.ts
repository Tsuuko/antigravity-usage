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
import { fetchQuota } from '../quota/service.js'
import { loadWakeupConfig, loadWakeupState, saveWakeupState } from './storage.js'
import { resolveAccounts } from './account-resolver.js'
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
 * Detect unused models and trigger wake-up for all configured accounts.
 *
 * Iterates through selected accounts, fetches quota for each,
 * compares against its previous cached snapshot, and triggers if needed.
 */
export async function detectResetAndTrigger(): Promise<DetectionResult> {
  debug('reset-detector', 'Checking for unused models (smart trigger)')

  // Load config
  const config = loadWakeupConfig()

  // Must be enabled
  if (!config || !config.enabled) {
    debug('reset-detector', 'Wakeup is not enabled')
    return { triggered: false, triggeredModels: [] }
  }

  // Respect selectedAccounts from config
  const accounts = resolveAccounts(config.selectedAccounts)
  if (accounts.length === 0) {
    debug('reset-detector', 'No valid accounts available')
    return { triggered: false, triggeredModels: [] }
  }

  debug('reset-detector', `Found ${accounts.length} account(s) (from selectedAccounts config)`)

  const accountManager = getAccountManager()
  const originalActiveEmail = accountManager.getActiveEmail()
  let anyTriggered = false
  const allTriggeredModels = new Set<string>()
  let successCount = 0

  const selectedSet = new Set(config.selectedModels)

  for (const accountEmail of accounts) {
    try {
      debug('reset-detector', `\n--- Processing account: ${accountEmail} ---`)

      // Temporarily set active account to fetch its specific quota
      accountManager.setActiveAccount(accountEmail)

      // Load previous cache for this specific account
      const previousSnapshot = loadWakeupState(accountEmail)

      // Fetch fresh quota
      debug('reset-detector', `Fetching quota for ${accountEmail}...`)
      const snapshot = await fetchQuota('google')

      // Save new cache right away
      saveWakeupState(accountEmail, snapshot)

      const targetModels = snapshot.models.filter(m => selectedSet.has(m.modelId))
      debug('reset-detector', `${accountEmail}: Checking ${targetModels.length} selected models out of ${snapshot.models.length} total`)

      const modelsToTrigger: string[] = []
      const seenModelIds = new Set<string>()

      for (const model of targetModels) {
        if (seenModelIds.has(model.modelId)) continue

        if (isModelUnused(model, previousSnapshot)) {
          modelsToTrigger.push(model.modelId)
        }
        seenModelIds.add(model.modelId)
      }

      if (modelsToTrigger.length === 0) {
        debug('reset-detector', `${accountEmail}: No unused models to trigger`)
        continue
      }

      console.log(`\n🔄 ${accountEmail}: Found ${modelsToTrigger.length} unused model(s): ${modelsToTrigger.join(', ')}`)
      anyTriggered = true
      modelsToTrigger.forEach((m: string) => allTriggeredModels.add(m))

      // Trigger for this account
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

  // Restore original active account
  if (originalActiveEmail) {
    debug('reset-detector', `Restoring active account to ${originalActiveEmail}`)
    accountManager.setActiveAccount(originalActiveEmail)
  }

  if (anyTriggered) {
    console.log(`\n📊 Wake-up complete: ${successCount}/${accounts.length} accounts triggered successfully\n`)
  }

  return {
    triggered: anyTriggered,
    triggeredModels: Array.from(allTriggeredModels)
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
