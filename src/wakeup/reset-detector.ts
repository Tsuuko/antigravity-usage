/**
 * Reset detector for auto wake-up
 *
 * Smart trigger logic:
 * - Triggers ALL available models from quota snapshot
 * - Triggers for ALL valid accounts
 * - Only triggers when model is "unused": 100% remaining AND resetTime has changed since last trigger
 */

import { debug } from '../core/logger.js'
import type { QuotaSnapshot, ModelQuotaInfo } from '../quota/types.js'
import {
  loadWakeupConfig,
  loadResetState,
  updateResetState,
  getResetKey
} from './storage.js'
import { getAccountManager } from '../accounts/manager.js'
import { executeTrigger } from './trigger-service.js'
import type { DetectionResult, ResetState } from './types.js'

// Smart trigger thresholds
const FULL_QUOTA_THRESHOLD = 99        // Consider "full" if >= 99%

// Cooldown between triggers for same model
// Default to 10 minutes (matching default config resetCooldownMinutes)
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000

/**
 * Check if a model is "unused" and should be triggered based on its reset state
 *
 * Unused = 100% quota remaining AND resetTime is different from the last time we triggered it
 */
export function isModelUnused(model: ModelQuotaInfo, resetState: ResetState): boolean {
  // Must have remaining percentage data
  if (model.remainingPercentage === undefined) {
    debug('reset-detector', `${model.modelId}: No remaining percentage data`)
    return false
  }

  // Check if quota is full (100% or very close)
  if (model.remainingPercentage < FULL_QUOTA_THRESHOLD) {
    debug('reset-detector', `${model.modelId}: Not full (${model.remainingPercentage}%)`)
    return false
  }

  // Must have reset time data from API
  if (!model.resetTime) {
    debug('reset-detector', `${model.modelId}: No reset time data from API`)
    return false
  }

  const resetKey = getResetKey(model.modelId)
  const previousState = resetState[resetKey]

  // If we have never triggered this model before, it's considered unused and ready to trigger
  if (!previousState || !previousState.lastResetAt) {
    debug('reset-detector', `${model.modelId}: UNUSED - No previous reset state found`)
    return true
  }

  // Compare the API's resetTime with the one we saved last time we triggered
  if (model.resetTime === previousState.lastResetAt) {
    debug('reset-detector', `${model.modelId}: Reset time unchanged (${model.resetTime})`)
    return false
  }

  debug('reset-detector', `${model.modelId}: UNUSED - Reset time changed (old: ${previousState.lastResetAt}, new: ${model.resetTime})`)
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
 * New smart logic:
 * 1. Check ALL models in the quota snapshot
 * 2. Find models that are "unused" (100% + resetTime changed)
 * 3. Trigger for ALL valid accounts
 */
export async function detectResetAndTrigger(snapshot: QuotaSnapshot): Promise<DetectionResult> {
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

  // Load reset state for deduplication and cooldown
  const resetState = loadResetState()
  const now = Date.now()
  const cooldownMs = (config.resetCooldownMinutes || 10) * 60 * 1000

  // Find ALL unused models (check every model in snapshot)
  const modelsToTrigger: string[] = []

  // Use a map to track which models we're actually triggering to avoid duplicates if
  // multiple modelIds map to the same resetKey
  const triggeredResetKeys = new Set<string>()

  for (const model of snapshot.models) {
    const resetKey = getResetKey(model.modelId)

    // Check if model is unused
    if (!isModelUnused(model, resetState)) {
      continue
    }

    // Skip if we already decided to trigger this reset family in this loop
    if (triggeredResetKeys.has(resetKey)) {
      continue
    }

    // Check cooldown (don't trigger same model too frequently)
    const previousState = resetState[resetKey]
    if (previousState) {
      const lastTriggered = new Date(previousState.lastTriggeredTime).getTime()
      const cooldownRemaining = cooldownMs - (now - lastTriggered)
      if (cooldownRemaining > 0) {
        debug('reset-detector', `${model.modelId}: In cooldown (${Math.round(cooldownRemaining / 60000)}min remaining)`)
        continue
      }
    }

    modelsToTrigger.push(model.modelId)
    triggeredResetKeys.add(resetKey)

    // Update state to prevent re-triggering
    updateResetState(resetKey, model.resetTime || new Date().toISOString())
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
export function findUnusedModels(snapshot: QuotaSnapshot): ModelQuotaInfo[] {
  const resetState = loadResetState()
  return snapshot.models.filter(m => isModelUnused(m, resetState))
}

/**
 * Check if any models need triggering (for status display)
 */
export function hasUnusedModels(snapshot: QuotaSnapshot): boolean {
  const resetState = loadResetState()
  return snapshot.models.some(m => isModelUnused(m, resetState))
}
