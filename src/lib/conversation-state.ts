/**
 * Conversation State Manager
 * Tracks multi-step conversation flows for the Telegram bot using MongoDB
 * This provides persistent storage that survives server restarts
 */

import { prisma } from '@/lib/prisma'
import { encryptPassword, decryptPassword } from './encryption'

export type Mt5SetupStep = 'account_number' | 'password' | 'confirming'
export type PromoStep = 'promo_code' | 'promo_name' | 'plan_type' | 'duration' | 'is_free' | 'has_copier' | 'amount' | 'expiry'
export type ConversationStep = Mt5SetupStep | PromoStep

export interface ConversationStateData {
  step: ConversationStep
  data: {
    // MT5 Setup Data
    accountNumber?: string
    password?: string
    server?: string
    // Promo Creation Data
    code?: string
    name?: string | null
    planType?: string
    durationDays?: number
    isFree?: boolean
    amountKobo?: number
    hasCopierAccess?: boolean
  }
}

/**
 * Set conversation state for a user in MongoDB
 */
export async function setConversationState(userId: string, state: ConversationStateData): Promise<void> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000) // 5 minutes from now

  // Encrypt password before storing
  const encryptedPassword = state.data.password ? encryptPassword(state.data.password) : null

  await prisma.conversationState.upsert({
    where: { telegramUserId: userId },
    update: {
      step: state.step,
      accountNumber: state.data.accountNumber || null,
      password: encryptedPassword,
      server: state.data.server || null,
      updatedAt: now,
      expiresAt
    },
    create: {
      telegramUserId: userId,
      step: state.step,
      accountNumber: state.data.accountNumber || null,
      password: encryptedPassword,
      server: state.data.server || null,
      createdAt: now,
      updatedAt: now,
      expiresAt
    }
  })

  console.log(`[Conversation State] Saved state for user ${userId}:`, { step: state.step })
}

/**
 * Get conversation state for a user from MongoDB
 * Returns undefined if state doesn't exist or is expired
 */
export async function getConversationState(userId: string): Promise<ConversationStateData | undefined> {
  const state = await prisma.conversationState.findUnique({
    where: { telegramUserId: userId }
  })

  if (!state) {
    console.log(`[Conversation State] No state found for user ${userId}`)
    return undefined
  }

  // Check if expired
  if (state.expiresAt < new Date()) {
    console.log(`[Conversation State] State expired for user ${userId}`)
    await clearConversationState(userId)
    return undefined
  }

  // Decrypt password
  const decryptedPassword = state.password ? decryptPassword(state.password) : undefined

  const ageInSeconds = Math.floor((Date.now() - state.updatedAt.getTime()) / 1000)
  console.log(`[Conversation State] Retrieved state for user ${userId}:`, { step: state.step, age: `${ageInSeconds}s` })
  console.log(`[Conversation State] Promo data:`, {
    promoCode: state.promoCode,
    promoName: state.promoName,
    promoPlanType: state.promoPlanType,
    promoDurationDays: state.promoDurationDays,
    promoIsFree: state.promoIsFree,
    promoAmountKobo: state.promoAmountKobo,
    promoHasCopier: state.promoHasCopier
  })

  return {
    step: state.step as ConversationStep,
    data: {
      // MT5 Setup Data
      accountNumber: state.accountNumber || undefined,
      password: decryptedPassword,
      server: state.server || undefined,
      // Promo Creation Data
      code: state.promoCode || undefined,
      name: state.promoName || undefined,
      planType: state.promoPlanType || undefined,
      durationDays: state.promoDurationDays || undefined,
      isFree: state.promoIsFree ?? undefined,
      amountKobo: state.promoAmountKobo ?? undefined,
      hasCopierAccess: state.promoHasCopier ?? undefined
    }
  }
}

/**
 * Clear conversation state for a user from MongoDB
 */
export async function clearConversationState(userId: string): Promise<void> {
  try {
    await prisma.conversationState.delete({
      where: { telegramUserId: userId }
    })
    console.log(`[Conversation State] Cleared state for user ${userId}`)
  } catch (error) {
    // Ignore if not found
    console.log(`[Conversation State] No state to clear for user ${userId}`)
  }
}

/**
 * Update conversation state data while preserving step
 */
export async function updateConversationData(userId: string, data: Partial<ConversationStateData['data']>): Promise<void> {
  const currentState = await getConversationState(userId)
  if (!currentState) {
    console.log(`[Conversation State] Cannot update - no state found for user ${userId}`)
    return
  }

  const encryptedPassword = data.password ? encryptPassword(data.password) : undefined

  const updateData: any = {
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000) // Reset expiration
  }

  // MT5 Setup Data
  if (data.accountNumber !== undefined) updateData.accountNumber = data.accountNumber
  if (data.password !== undefined) updateData.password = encryptedPassword
  if (data.server !== undefined) updateData.server = data.server

  // Promo Creation Data
  if (data.code !== undefined) updateData.promoCode = data.code
  if (data.name !== undefined) updateData.promoName = data.name
  if (data.planType !== undefined) updateData.promoPlanType = data.planType
  if (data.durationDays !== undefined) updateData.promoDurationDays = data.durationDays
  if (data.isFree !== undefined) updateData.promoIsFree = data.isFree
  if (data.amountKobo !== undefined) updateData.promoAmountKobo = data.amountKobo
  if (data.hasCopierAccess !== undefined) updateData.promoHasCopier = data.hasCopierAccess

  await prisma.conversationState.update({
    where: { telegramUserId: userId },
    data: updateData
  })

  console.log(`[Conversation State] Updated data for user ${userId}:`, Object.keys(data))
}

/**
 * Advance to next step in promo creation flow
 */
export async function advancePromoStep(userId: string, step: PromoStep): Promise<void> {
  await prisma.conversationState.update({
    where: { telegramUserId: userId },
    data: {
      step,
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000) // Reset expiration
    }
  })

  console.log(`[Conversation State] Saved state for user ${userId}:`, { step })
}

/**
 * Advance to next step in MT5 setup flow
 */
export async function advanceMt5SetupStep(userId: string): Promise<void> {
  const currentState = await getConversationState(userId)
  if (!currentState) {
    console.log(`[Conversation State] Cannot advance - no state found for user ${userId}`)
    return
  }

  // Only advance if this is an MT5 setup step
  if (!['account_number', 'password', 'confirming'].includes(currentState.step)) {
    return
  }

  const stepOrder: Mt5SetupStep[] = ['account_number', 'password', 'confirming']
  const currentIndex = stepOrder.indexOf(currentState.step as Mt5SetupStep)

  if (currentIndex < stepOrder.length - 1) {
    const nextStep = stepOrder[currentIndex + 1]

    await prisma.conversationState.update({
      where: { telegramUserId: userId },
      data: {
        step: nextStep,
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // Reset expiration
      }
    })

    console.log(`[Conversation State] Advanced to step ${nextStep} for user ${userId}`)
  }
}
