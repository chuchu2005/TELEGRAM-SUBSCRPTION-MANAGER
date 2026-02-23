/**
 * MetaCopier.io API Client
 * Handles all interactions with MetaCopier REST API
 * Supports multiple API keys with automatic fallback when account limit is reached
 */

const API_BASE = process.env.METACOPIER_API_BASE_URL!

// Primary MetaCopier Account
const PRIMARY_API_KEY = process.env.METACOPIER_API_KEY!
const PRIMARY_MASTER_ACCOUNT_ID = process.env.METACOPIER_MASTER_ACCOUNT_ID!

// Secondary MetaCopier Account (fallback when primary reaches account limit)
const SECONDARY_API_KEY = process.env.METACOPIER_API_KEY_2!
const SECONDARY_MASTER_ACCOUNT_ID = process.env.METACOPIER_MASTER_ACCOUNT_ID_2!

const DEFAULT_REGION = process.env.METACOPIER_REGION || 'London'

export interface CreateAccountParams {
  loginAccountNumber: string
  loginAccountPassword: string
  loginServer: string
  region?: { id: number }
  type?: { id: number }
}

export interface CreateCopierParams {
  toAccountId: string
  multiplier?: number
  maxLotSize?: number
  maxOpenPositions?: number
  copyStopLoss?: boolean
  copyTakeProfit?: boolean
}

export interface UpdateCopierParams {
  accountId: string
  copierId: string
  multiplier?: number
  maxLotSize?: number
  maximumLot?: number
  maxOpenPositions?: number
  copyStopLoss?: boolean
  copyTakeProfit?: boolean
}

export interface MetaCopierAccount {
  accountId: string
  copierId: string
}

export interface MetaCopierConfig {
  apiKey: string
  masterAccountId: string
  accountIndex: number // 0 or 1
}

/**
 * Get MetaCopier configuration for a given account index
 */
export function getMetacopierConfig(accountIndex: number = 0): MetaCopierConfig {
  if (accountIndex === 1 && SECONDARY_API_KEY && SECONDARY_MASTER_ACCOUNT_ID) {
    console.log(`[MetaCopier] Using secondary account (index: ${accountIndex})`)
    return {
      apiKey: SECONDARY_API_KEY,
      masterAccountId: SECONDARY_MASTER_ACCOUNT_ID,
      accountIndex: 1
    }
  }

  console.log(`[MetaCopier] Using primary account (index: ${accountIndex})`)
  return {
    apiKey: PRIMARY_API_KEY,
    masterAccountId: PRIMARY_MASTER_ACCOUNT_ID,
    accountIndex: 0
  }
}

/**
 * Create MT5 account in MetaCopier and link to master account
 * Automatically tries secondary account if primary reaches account limit
 */
export async function createMt5Account(
  params: CreateAccountParams,
  preferredAccountIndex: number = 0
): Promise<{ account: MetaCopierAccount; accountIndex: number }> {
  const configs: MetaCopierConfig[] = []

  // Try preferred account first
  if (preferredAccountIndex === 0 || SECONDARY_API_KEY) {
    configs.push(getMetacopierConfig(0))
  }

  // Add secondary as fallback if available
  if (SECONDARY_API_KEY && SECONDARY_MASTER_ACCOUNT_ID) {
    configs.push(getMetacopierConfig(1))
  }

  for (const config of configs) {
    try {
      console.log(`[MetaCopier] Attempting to create account with account index: ${config.accountIndex}`)
      const result = await createMt5AccountWithConfig(params, config)
      console.log(`[MetaCopier] ✅ Successfully created account with index: ${config.accountIndex}`)
      return { account: result, accountIndex: config.accountIndex }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[MetaCopier] Failed with account index ${config.accountIndex}:`, errorMessage)

      // Check if error is account limit reached - try next account
      if (errorMessage.includes('ACCOUNT_LIMIT') || errorMessage.includes('TRIAL')) {
        console.log(`[MetaCopier] Account limit reached for index ${config.accountIndex}, trying next account...`)
        continue // Try next config
      }

      // For other errors, throw immediately
      throw error
    }
  }

  // If we get here, all accounts failed
  throw new Error('Failed to create MetaCopier account. All available accounts reached account limit.')
}

/**
 * Create MT5 account with specific configuration
 */
async function createMt5AccountWithConfig(
  params: CreateAccountParams,
  config: MetaCopierConfig
): Promise<MetaCopierAccount> {
  // Step 1: Create slave account
  const accountResponse = await fetch(`${API_BASE}/rest/api/v1/accounts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': config.apiKey
    },
    body: JSON.stringify({
      loginAccountNumber: params.loginAccountNumber,
      loginAccountPassword: params.loginAccountPassword,
      loginServer: params.loginServer,
      region: params.region || { id: 2 },  // Default to London (id: 2)
      type: params.type || { id: 1 },     // Default to MT5 (id: 1)
      magicNumber: 123456  // Magic number for trade identification
    })
  })

  if (!accountResponse.ok) {
    const errorText = await accountResponse.text()
    console.error(`[MetaCopier] Account creation failed. Status: ${accountResponse.status}, Error: ${errorText || 'Empty response'}`)
    throw new Error(`Failed to create MetaCopier account: ${errorText || 'Empty response (Status ' + accountResponse.status + ')'}`)
  }

  const accountData: any = await accountResponse.json()
  const accountId = accountData.id || accountData.accountId

  if (!accountId) {
    throw new Error('MetaCopier API did not return an account ID')
  }

  // Step 2: Create copier linking slave to master
  const copierResponse = await fetch(`${API_BASE}/rest/api/v1/accounts/${accountId}/copiers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': config.apiKey
    },
    body: JSON.stringify({
      fromAccountId: config.masterAccountId,
      toAccountId: accountId,
      multiplier: 1.0,
      maxLotSize: 0.02,  // Maximum lot size per position
      maximumLot: 0.2,   // Maximum total exposure
      maxOpenPositions: 10,  // Maximum number of open trades
      copyStopLoss: true,
      copyTakeProfit: true,
      scaleType: { id: 1 },  // "No scaling" - copy exact lot sizes
      skipPendingOrders: false,  // Copy pending orders as well
      maxSlippage: 0,  // Maximum allowed price slippage
      forceMinTrade: true,  // Ensure minimum trade size
      fixedLotSize: 0.01,  // Minimum lot size
      martingaleStrategy: false,  // No martingale
      openRetry: true,  // Retry failed trades
      openRetryTimeoutInMinutes: 10,  // Retry timeout
      reverse: false,  // Don't reverse trades
      copyOpenPositions: false,  // Don't copy existing open positions
      copyMagicNumber: true,  // Copy magic numbers from master
      copyOriginalComment: false,  // Don't copy original comments
      customMagicNumber: 123456  // Magic number for copied trades
    })
  })

  if (!copierResponse.ok) {
    const errorText = await copierResponse.text()
    console.error(`[MetaCopier] Copier creation failed. Status: ${copierResponse.status}, Error: ${errorText || 'Empty response'}`)
    // Attempt to clean up account if copier creation fails
    await deleteMt5Account(accountId, config.accountIndex).catch(e => console.error('[MetaCopier] Cleanup failed:', e))
    throw new Error(`Failed to create copier: ${errorText || 'Empty response (Status ' + copierResponse.status + ')'}`)
  }

  const copierData: any = await copierResponse.json()
  const copierId = copierData.id || copierData.copierId

  if (!copierId) {
    throw new Error('MetaCopier API did not return a copier ID')
  }

  return {
    accountId,
    copierId
  }
}

/**
 * Update copier settings for an existing account
 * Uses the correct API key based on account index
 */
export async function updateCopierSettings(
  params: UpdateCopierParams & { metacopierAccountIndex?: number }
): Promise<void> {
  const config = getMetacopierConfig(params.metacopierAccountIndex || 0)

  try {
    const response = await fetch(
      `${API_BASE}/rest/api/v1/accounts/${params.accountId}/copiers/${params.copierId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': config.apiKey
        },
        body: JSON.stringify({
          multiplier: params.multiplier,
          maxLotSize: params.maxLotSize,
          maximumLot: params.maximumLot,
          maxOpenPositions: params.maxOpenPositions,
          copyStopLoss: params.copyStopLoss,
          copyTakeProfit: params.copyTakeProfit
        })
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to update copier settings: ${errorText}`)
    }

    console.log(`[MetaCopier] ✅ Updated copier settings for account index: ${config.accountIndex}`)
  } catch (error) {
    console.error('Error in updateCopierSettings:', error)
    throw error
  }
}

/**
 * Disable copier (sets state to DISABLED to stop copying)
 * Copier states: ACTIVE, MONITOR (pause new trades but manage existing), DISABLED (completely off)
 */
export async function disableCopier(
  accountId: string,
  copierId: string,
  metacopierAccountIndex: number = 0
): Promise<void> {
  const config = getMetacopierConfig(metacopierAccountIndex)

  try {
    console.log(`[disableCopier] Disabling copier ${copierId} with account index: ${config.accountIndex}...`)
    const response = await fetch(
      `${API_BASE}/rest/api/v1/accounts/${accountId}/copiers/${copierId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': config.apiKey
        },
        body: JSON.stringify({
          state: 'DISABLED'
        })
      }
    )

    if (response.ok) {
      console.log(`[disableCopier] Successfully disabled copier ${copierId}`)
      return
    }

    const statusText = response.statusText
    const errorText = await response.text()
    console.error(`[disableCopier] Failed to disable copier. Status: ${response.status}, Error: ${errorText || statusText}`)
    // Don't throw - continue with deletion attempt
  } catch (error) {
    console.error('[disableCopier] Error:', error)
    // Don't throw - continue with deletion attempt
  }
}

/**
 * Delete copier
 * Note: Deleting account will cascade to delete copier, so this is optional
 */
export async function deleteCopier(
  accountId: string,
  copierId: string,
  metacopierAccountIndex: number = 0
): Promise<void> {
  const config = getMetacopierConfig(metacopierAccountIndex)

  try {
    // Step 1: Disable the copier first to stop copying
    await disableCopier(accountId, copierId, metacopierAccountIndex)

    // Step 2: Delete the copier
    console.log(`[deleteCopier] Attempting to delete copier ${copierId} with account index: ${config.accountIndex}...`)
    const response = await fetch(
      `${API_BASE}/rest/api/v1/accounts/${accountId}/copiers/${copierId}`,
      {
        method: 'DELETE',
        headers: {
          'X-API-KEY': config.apiKey
        }
      }
    )

    if (response.ok || response.status === 404) {
      console.log(`[deleteCopier] Successfully deleted copier ${copierId}`)
      return
    }

    const statusText = response.statusText
    const errorText = await response.text()
    console.error(`[deleteCopier] Failed to delete copier. Status: ${response.status}, Error: ${errorText || statusText}`)
    // Don't throw - account deletion will handle cleanup
  } catch (error) {
    console.error('[deleteCopier] Error:', error)
    // Don't throw - account deletion will handle cleanup
  }
}

/**
 * Stop an account before deletion
 * MUST be called before deleteMt5Account() to avoid [ACCOUNT_IS_ACTIVE] error
 */
export async function stopAccount(
  accountId: string,
  metacopierAccountIndex: number = 0
): Promise<void> {
  const config = getMetacopierConfig(metacopierAccountIndex)

  try {
    console.log(`[stopAccount] Stopping account ${accountId} with account index: ${config.accountIndex}...`)

    const response = await fetch(
      `${API_BASE}/rest/api/v1/accounts/${accountId}`,
      {
        method: 'PATCH',
        headers: {
          'X-API-KEY': config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          active: false
        })
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[stopAccount] Failed to stop account. Status: ${response.status}, Error: ${errorText}`)
      throw new Error(`Failed to stop account: ${errorText}`)
    }

    console.log(`[stopAccount] ✅ Account stopped successfully`)
  } catch (error) {
    console.error('[stopAccount] Error:', error)
    throw error
  }
}

/**
 * Complete removal workflow for MT5 account
 * 5-step process with proper delays and error handling
 */
export async function removeUserMt5Account(
  accountId: string,
  copierId: string,
  metacopierAccountIndex: number = 0
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[removeUserMt5Account] Starting removal for account ${accountId} with index: ${metacopierAccountIndex}`)

    // Step 1: Disable copier (safer than immediate deletion)
    if (copierId) {
      try {
        console.log('[Step 1/5] Disabling copier...')
        await disableCopier(accountId, copierId, metacopierAccountIndex)
      } catch (error) {
        console.error('[Step 1/5] Failed to disable copier:', error)
        // Continue - copier might not exist
      }
    }

    // Step 2: Stop the account (REQUIRED before deletion)
    try {
      console.log('[Step 2/5] Stopping account...')
      await stopAccount(accountId, metacopierAccountIndex)
    } catch (error) {
      console.error('[Step 2/5] Failed to stop account:', error)
      return { success: false, error: 'Failed to stop account' }
    }

    // Step 3: Wait for MetaCopier to process stop
    console.log('[Step 3/5] Waiting 3 seconds for MetaCopier to process...')
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Step 4: Delete copier
    if (copierId) {
      try {
        console.log('[Step 4/5] Deleting copier...')
        await deleteCopier(accountId, copierId, metacopierAccountIndex)
      } catch (error) {
        console.error('[Step 4/5] Failed to delete copier:', error)
        // Continue - account deletion will handle cleanup
      }
    }

    // Step 5: Delete account
    try {
      console.log('[Step 5/5] Deleting account...')
      await deleteMt5Account(accountId, metacopierAccountIndex)
    } catch (error) {
      console.error('[Step 5/5] Failed to delete account:', error)
      return { success: false, error: 'Failed to delete account' }
    }

    console.log(`[removeUserMt5Account] ✅ Successfully removed account ${accountId}`)
    return { success: true }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[removeUserMt5Account] ❌ Failed:`, errorMessage)
    return { success: false, error: errorMessage }
  }
}

/**
 * Delete MT5 account from MetaCopier
 * This cascades to delete associated copiers
 */
export async function deleteMt5Account(
  accountId: string,
  metacopierAccountIndex: number = 0
): Promise<void> {
  const config = getMetacopierConfig(metacopierAccountIndex)

  try {
    const response = await fetch(`${API_BASE}/rest/api/v1/accounts/${accountId}`, {
      method: 'DELETE',
      headers: {
        'X-API-KEY': config.apiKey
      }
    })

    // Don't throw on 404 - account might already be deleted
    if (!response.ok && response.status !== 404) {
      const errorText = await response.text()
      throw new Error(`Failed to delete account: ${errorText}`)
    }
  } catch (error) {
    console.error('Error in deleteMt5Account:', error)
    throw error
  }
}

/**
 * Get account information from MetaCopier
 */
export async function getAccountInfo(
  accountId: string,
  metacopierAccountIndex: number = 0
): Promise<any> {
  const config = getMetacopierConfig(metacopierAccountIndex)

  try {
    const response = await fetch(`${API_BASE}/rest/api/v1/accounts/${accountId}/information`, {
      headers: {
        'X-API-KEY': config.apiKey
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to get account info: ${errorText}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error in getAccountInfo:', error)
    throw error
  }
}
