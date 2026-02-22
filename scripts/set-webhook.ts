import 'dotenv/config'
import { setWebhook } from '../src/lib/telegram'

const NGROK_URL = 'http://nonarticulative-atypical-jessi.ngrok-free.dev'
const WEBHOOK_PATH = '/api/telegram/webhook'

async function setupWebhook() {
  const webhookUrl = `${NGROK_URL}${WEBHOOK_PATH}`
  console.log('Setting Telegram webhook to:', webhookUrl)

  const success = await setWebhook(webhookUrl)

  if (success) {
    console.log('✅ Webhook set successfully!')
    console.log('Your bot is now listening at:', webhookUrl)
  } else {
    console.log('❌ Failed to set webhook')
    console.log('Please check your TELEGRAM_BOT_TOKEN in .env file')
  }
}

setupWebhook()
