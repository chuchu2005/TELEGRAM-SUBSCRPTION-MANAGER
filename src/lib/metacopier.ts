/**
 * MetaCopier.io API Client
 * Handles all interactions with the MetaCopier REST API
 */

const API_BASE = process.env.METACOPIER_API_BASE_URL!
const API_KEY = process.env.METACOPIER_API_KEY!
const MASTER_ACCOUNT_ID = process.env.METACOPIER_MASTER_ACCOUNT_ID!
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

/**
 * Create MT5 account in MetaCopier and link to master account
 */
export async function createMt5Account(params: CreateAccountParams): Promise<MetaCopierAccount> {
  try {
    // Step 1: Create the slave account
    const accountResponse = await fetch(`${API_BASE}/rest/api/v1/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': API_KEY
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
      console.error('MetaCopier account creation failed:', errorText)
      throw new Error(`Failed to create MetaCopier account: ${errorText}`)
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
        'X-API-KEY': API_KEY
      },
      body: JSON.stringify({
        fromAccountId: MASTER_ACCOUNT_ID,
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
      console.error('Copier creation failed:', errorText)
      // Attempt to clean up the account if copier creation fails
      await deleteMt5Account(accountId).catch(e => console.error('Cleanup failed:', e))
      throw new Error(`Failed to create copier: ${errorText}`)
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
  } catch (error) {
    console.error('Error in createMt5Account:', error)
    throw error
  }
}

/**
 * Update copier settings for an existing account
 */
export async function updateCopierSettings(params: UpdateCopierParams): Promise<void> {
  try {
    const response = await fetch(
      `${API_BASE}/rest/api/v1/accounts/${params.accountId}/copiers/${params.copierId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': API_KEY
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
  } catch (error) {
    console.error('Error in updateCopierSettings:', error)
    throw error
  }
}

/**
 * Disable the copier (sets state to DISABLED to stop copying)
 * Copier states: ACTIVE, MONITOR (pause new trades but manage existing), DISABLED (completely off)
 */
export async function disableCopier(accountId: string, copierId: string): Promise<void> {
  try {
    console.log(`[disableCopier] Disabling copier ${copierId}...`)
    const response = await fetch(
      `${API_BASE}/rest/api/v1/accounts/${accountId}/copiers/${copierId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': API_KEY
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
 * Delete the copier
 * Note: Deleting the account will cascade to delete the copier, so this is optional
 */
export async function deleteCopier(accountId: string, copierId: string): Promise<void> {
  try {
    // Step 1: Disable the copier first to stop copying
    await disableCopier(accountId, copierId)

    // Step 2: Delete the copier
    console.log(`[deleteCopier] Attempting to delete copier ${copierId}...`)
    const response = await fetch(
      `${API_BASE}/rest/api/v1/accounts/${accountId}/copiers/${copierId}`,
      {
        method: 'DELETE',
        headers: {
          'X-API-KEY': API_KEY
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
export async function stopAccount(accountId: string): Promise<void> {
  try {
    console.log(`[stopAccount] Stopping account ${accountId}...`)

    const response = await fetch(
      `${API_BASE}/rest/api/v1/accounts/${accountId}`,
      {
        method: 'PATCH',
        headers: {
          'X-API-KEY': API_KEY,
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
  copierId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[removeUserMt5Account] Starting removal for account ${accountId}`)

    // Step 1: Disable copier (safer than immediate deletion)
    if (copierId) {
      try {
        console.log('[Step 1/5] Disabling copier...')
        await disableCopier(accountId, copierId)
      } catch (error) {
        console.error('[Step 1/5] Failed to disable copier:', error)
        // Continue - copier might not exist
      }
    }

    // Step 2: Stop the account (REQUIRED before deletion)
    try {
      console.log('[Step 2/5] Stopping account...')
      await stopAccount(accountId)
    } catch (error) {
      console.error('[Step 2/5] Failed to stop account:', error)
      return { success: false, error: 'Failed to stop account' }
    }

    // Step 3: Wait for MetaCopier to process the stop
    console.log('[Step 3/5] Waiting 3 seconds for MetaCopier to process...')
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Step 4: Delete the copier
    if (copierId) {
      try {
        console.log('[Step 4/5] Deleting copier...')
        await deleteCopier(accountId, copierId)
      } catch (error) {
        console.error('[Step 4/5] Failed to delete copier:', error)
        // Continue - account deletion will handle cleanup
      }
    }

    // Step 5: Delete the account
    try {
      console.log('[Step 5/5] Deleting account...')
      await deleteMt5Account(accountId)
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
export async function deleteMt5Account(accountId: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/rest/api/v1/accounts/${accountId}`, {
      method: 'DELETE',
      headers: {
        'X-API-KEY': API_KEY
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
export async function getAccountInfo(accountId: string): Promise<any> {
  try {
    const response = await fetch(`${API_BASE}/rest/api/v1/accounts/${accountId}/information`, {
      headers: {
        'X-API-KEY': API_KEY
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
