// Telegram Bot API helper functions

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID!

export interface TelegramMessage {
  chat_id: string | number
  text: string
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML'
  reply_markup?: {
    inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>>
  }
}

export interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    from: TelegramUser
    chat: {
      id: number
      type: string
    }
    text?: string
    date: number
  }
  callback_query?: {
    id: string
    from: TelegramUser
    data: string
  }
}

export interface InviteLinkResponse {
  ok: boolean
  result?: {
    invite_link: string
    creator: TelegramUser
    creates_join_request: boolean
    expire_date: number
    member_limit: number
  }
  description?: string
}

export interface ChatMemberResponse {
  ok: boolean
  result?: {
    user: TelegramUser
    status: string
  }
}

/**
 * Send a message to a Telegram chat
 */
export async function sendMessage(chatId: string | number, text: string, parseMode: 'Markdown' | 'MarkdownV2' | 'HTML' | undefined = 'HTML'): Promise<boolean> {
  try {
    const body: any = {
      chat_id: chatId,
      text,
      parse_mode: parseMode || 'HTML'
    }

    const response = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    const data = await response.json()
    return data.ok
  } catch (error) {
    console.error('Error sending Telegram message:', error)
    return false
  }
}

/**
 * Send a photo to a Telegram chat
 */
export async function sendPhoto(chatId: string | number, fileId: string, caption?: string, parseMode: 'Markdown' | 'MarkdownV2' | 'HTML' | undefined = 'HTML'): Promise<boolean> {
  try {
    const body: any = {
      chat_id: chatId,
      photo: fileId
    }

    if (caption) {
      body.caption = caption
      body.parse_mode = parseMode || 'HTML'
    }

    const response = await fetch(`${TELEGRAM_API_BASE}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    const data = await response.json()
    return data.ok
  } catch (error) {
    console.error('Error sending Telegram photo:', error)
    return false
  }
}

/**
 * Create a one-time invite link for the channel
 */
export async function createInviteLink(): Promise<string | null> {
  try {
    const expireDate = Math.floor(Date.now() / 1000) + 86400 // 24 hours from now

    const response = await fetch(`${TELEGRAM_API_BASE}/createChatInviteLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        member_limit: 1,
        expire_date: expireDate
      })
    })

    const data: InviteLinkResponse = await response.json()

    if (data.ok && data.result?.invite_link) {
      return data.result.invite_link
    }

    console.error('Failed to create invite link:', data.description)
    return null
  } catch (error) {
    console.error('Error creating invite link:', error)
    return null
  }
}

/**
 * Ban/remove a user from the channel
 */
export async function banChatMember(userId: string | number): Promise<boolean> {
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/banChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        user_id: userId,
        revoke_messages: false
      })
    })

    const data = await response.json()
    return data.ok
  } catch (error) {
    console.error('Error banning chat member:', error)
    return false
  }
}

/**
 * Unban a user to allow them to rejoin
 * This should be called when a user repays after being banned
 */
export async function unbanChatMember(userId: string | number): Promise<boolean> {
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/unbanChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        user_id: userId,
        only_if_banned: true
      })
    })

    const data = await response.json()
    return data.ok
  } catch (error) {
    console.error('Error unbanning chat member:', error)
    return false
  }
}

/**
 * Get member status from channel
 */
export async function getChatMember(userId: string | number): Promise<ChatMemberResponse> {
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/getChatMember?chat_id=${CHANNEL_ID}&user_id=${userId}`)
    return await response.json()
  } catch (error) {
    console.error('Error getting chat member:', error)
    return { ok: false }
  }
}

/**
 * Set webhook for the bot
 */
export async function setWebhook(webhookUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/setWebhook?url=${encodeURIComponent(webhookUrl)}`)
    const data = await response.json()
    return data.ok
  } catch (error) {
    console.error('Error setting webhook:', error)
    return false
  }
}

/**
 * Format date for display
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

/**
 * Calculate days remaining until expiry
 */
export function getDaysRemaining(expiresAt: Date): number {
  const now = new Date()
  const diffTime = expiresAt.getTime() - now.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  return diffDays > 0 ? diffDays : 0
}
