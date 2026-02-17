'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function PaymentSuccessContent() {
  const [copied, setCopied] = useState(false)
  const [autoVerified, setAutoVerified] = useState(false)
  const [verifying, setVerifying] = useState(true)
  const searchParams = useSearchParams()
  const reference = searchParams.get('reference') || searchParams.get('trxref') || ''

  // Auto-verify payment when page loads
  useEffect(() => {
    const autoVerifyPayment = async () => {
      if (!reference) {
        setVerifying(false)
        return
      }

      try {
        console.log('Auto-verifying payment with reference:', reference)
        const response = await fetch('/api/payment/auto-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference })
        })

        const data = await response.json()
        console.log('Auto-verify response:', data)

        if (data.success) {
          setAutoVerified(true)
        } else {
          console.error('Auto-verify failed:', data.error)
        }
      } catch (error) {
        console.error('Error auto-verifying payment:', error)
      } finally {
        setVerifying(false)
      }
    }

    autoVerifyPayment()
  }, [reference])

  const copyReference = () => {
    if (reference) {
      navigator.clipboard.writeText(reference)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const copyExample = () => {
    const example = `/verify_basic ${reference}`
    navigator.clipboard.writeText(example)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full">
        {/* Success Icon */}
        <div className="bg-green-100 rounded-full h-20 w-20 flex items-center justify-center mx-auto mb-6">
          <svg className="h-10 w-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-800 mb-2 text-center">✅ Payment Successful!</h1>
        <p className="text-gray-600 text-center mb-4">Your payment has been received</p>

        {/* Auto-Verify Status */}
        {reference && (
          <div className="mb-6">
            {verifying && (
              <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 text-center">
                <div className="flex items-center justify-center mb-2">
                  <svg className="animate-spin h-5 w-5 text-blue-600 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="text-blue-900 font-semibold">⏳ Automatically verifying your payment...</span>
                </div>
                <p className="text-xs text-blue-700">Check your Telegram bot for your invite link!</p>
              </div>
            )}

            {!verifying && autoVerified && (
              <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 text-center">
                <div className="flex items-center justify-center mb-2">
                  <svg className="h-5 w-5 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-green-900 font-semibold">✅ Payment verified! Invite link sent to Telegram!</span>
                </div>
                <p className="text-xs text-green-700">Check your Telegram bot to join the channel.</p>
              </div>
            )}

            {!verifying && !autoVerified && (
              <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4 text-center">
                <div className="flex items-center justify-center mb-2">
                  <span className="text-yellow-900 font-semibold">⚠️ Auto-verification failed</span>
                </div>
                <p className="text-xs text-yellow-700">Please copy the reference below and manually verify in Telegram.</p>
              </div>
            )}
          </div>
        )}

        {/* REFERENCE CODE - MOST IMPORTANT */}
        {reference && (
          <div className="bg-green-50 border-4 border-green-400 rounded-xl p-6 mb-6 text-center">
            <h3 className="font-bold text-green-900 mb-4 text-xl">🎉 YOUR TRANSACTION REFERENCE</h3>
            <div className="bg-white border-3 border-green-500 rounded-lg p-4 mb-4">
              <p className="text-2xl font-bold text-green-700 mb-2">REF:</p>
              <p className="text-3xl font-bold text-green-600 tracking-wider">{reference}</p>
            </div>

            {/* If auto-verified, show success */}
            {!verifying && autoVerified ? (
              <div className="bg-green-100 border-2 border-green-500 rounded-lg p-3 mb-3">
                <p className="text-sm font-bold text-green-800">✅ Invite link sent to your Telegram!</p>
                <p className="text-xs text-green-700">Check your Telegram bot to join the channel.</p>
              </div>
            ) : (
              <>
                <button
                  onClick={copyReference}
                  className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold py-4 px-6 rounded-xl text-lg shadow-lg transition-all duration-200 mb-3"
                >
                  {copied ? '✅ Copied!' : '📋 Copy Reference'}
                </button>

                {/* Auto-send verification button */}
                <a
                  href="tg://resolve"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-4 px-6 rounded-xl text-lg shadow-lg transition-all duration-200 mb-3 text-center"
                >
                  🚀 Open Telegram Bot (Check for Invite Link!)
                </a>

                <p className="text-sm text-green-800 font-semibold">
                  ⬆️ Auto-verification is running! Check your Telegram bot for the invite link!
                </p>
                <p className="text-xs text-green-700 mt-2">
                  Or if auto-verify fails, click <b>"✅ Verify Basic Payment"</b> button in bot and paste: <code className="bg-green-100 px-2 py-1 rounded font-bold">{reference}</code>
                </p>
                <p className="text-xs text-green-700 mt-1 font-semibold">
                  ⚠️ Only paste the reference code, not the command!
                </p>
              </>
            )}
          </div>
        )}

        {!reference && (
          /* EMAIL NOTIFICATION - FALLBACK IF NO REFERENCE IN URL */
          <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 mb-6">
            <h3 className="font-bold text-red-900 mb-3 text-lg">📧 CHECK YOUR EMAIL NOW!</h3>
            <div className="text-sm text-red-800 space-y-2">
              <p className="font-semibold">Your transaction reference was sent to your email!</p>
              <p>The reference code is <strong>NOT on this website</strong>.</p>
              <p>You must check your email inbox to find it.</p>
            </div>
          </div>
        )}

        {/* Instructions - Only show if no reference in URL */}
        {!reference && (
          <>
        {/* Step-by-step instructions */}
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 mb-6">
          <h3 className="font-bold text-blue-900 mb-3">📋 How to Find Your Reference:</h3>
          <div className="space-y-3 text-sm text-blue-800">
            <div className="flex items-start">
              <span className="bg-blue-600 text-white rounded-full h-6 w-6 flex items-center justify-center mr-3 mt-0.5 flex-shrink-0 text-xs font-bold">1</span>
              <div>
                <strong>Open your email inbox</strong>
                <p className="text-xs mt-1">Check the email address you provided during payment</p>
              </div>
            </div>
            <div className="flex items-start">
              <span className="bg-blue-600 text-white rounded-full h-6 w-6 flex items-center justify-center mr-3 mt-0.5 flex-shrink-0 text-xs font-bold">2</span>
              <div>
                <strong>Look for Paystack receipt email</strong>
                <p className="text-xs mt-1">Subject: "Payment Receipt" or "Transaction Successful"</p>
              </div>
            </div>
            <div className="flex items-start">
              <span className="bg-blue-600 text-white rounded-full h-6 w-6 flex items-center justify-center mr-3 mt-0.5 flex-shrink-0 text-xs font-bold">3</span>
              <div>
                <strong>Find the reference on the receipt</strong>
                <p className="text-xs mt-1">Look for "Transaction Reference" or "Reference"</p>
              </div>
            </div>
            <div className="flex items-start">
              <span className="bg-blue-600 text-white rounded-full h-6 w-6 flex items-center justify-center mr-3 mt-0.5 flex-shrink-0 text-xs font-bold">4</span>
              <div>
                <strong>Copy the reference number</strong>
                <p className="text-xs mt-1">It looks like: REF_1234567890 or 1234567890</p>
              </div>
            </div>
          </div>
        </div>

        {/* Reference Example Image */}
        <div className="bg-purple-50 border-2 border-purple-200 rounded-xl p-4 mb-6">
          <h3 className="font-bold text-purple-900 mb-3">📸 Example: How the Reference Looks in Email</h3>
          <img
            src="/reference.jpg"
            alt="Example of Paystack receipt showing where to find transaction reference"
            className="w-full rounded-lg border-2 border-purple-300"
          />
          <p className="text-xs text-purple-700 mt-2 text-center">
            Look for the highlighted "Transaction Reference" in your Paystack email receipt
          </p>
        </div>

        {/* What the reference looks like */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
          <h3 className="font-bold text-yellow-900 mb-2">🔍 What the Reference Looks Like:</h3>
          <p className="text-sm text-yellow-800 mb-2">
            Examples: <code className="bg-yellow-100 px-2 py-1 rounded">REF_1234567890</code> or <code className="bg-yellow-100 px-2 py-1 rounded">TXN_abc123xyz</code>
          </p>
          <p className="text-xs text-yellow-700">
            ⚠️ This is NOT your account number, phone number, or name - it's the unique transaction reference from Paystack
          </p>
        </div>

        {/* Next Steps */}
        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <h3 className="font-bold text-gray-800 mb-3">📱 What to Do Next:</h3>
          <ol className="text-sm text-gray-700 space-y-2">
            <li className="flex items-start">
              <span className="bg-blue-600 text-white rounded-full h-5 w-5 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0 text-xs font-bold">1</span>
              <span>Open your email and find the Paystack receipt</span>
            </li>
            <li className="flex items-start">
              <span className="bg-blue-600 text-white rounded-full h-5 w-5 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0 text-xs font-bold">2</span>
              <span>Copy the transaction reference from the email</span>
            </li>
            <li className="flex items-start">
              <span className="bg-blue-600 text-white rounded-full h-5 w-5 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0 text-xs font-bold">3</span>
              <span>Go back to the Telegram bot</span>
            </li>
            <li className="flex items-start">
              <span className="bg-blue-600 text-white rounded-full h-5 w-5 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0 text-xs font-bold">4</span>
              <span>Send: <code className="bg-gray-200 px-2 py-0.5 rounded text-xs">/verify_basic YOUR_REFERENCE</code></span>
            </li>
            <li className="flex items-start">
              <span className="bg-blue-600 text-white rounded-full h-5 w-5 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0 text-xs font-bold">5</span>
              <span>Or if you paid ₦22,000: <code className="bg-gray-200 px-2 py-0.5 rounded text-xs">/verify_premium YOUR_REFERENCE</code></span>
            </li>
            <li className="flex items-start">
              <span className="bg-blue-600 text-white rounded-full h-5 w-5 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0 text-xs font-bold">6</span>
              <span>Receive your invite link instantly! 🎉</span>
            </li>
          </ol>
        </div>

        {/* Example */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-green-800">
            <strong>💡 Example:</strong> If your reference is <code className="bg-green-100 px-2 py-1 rounded">TXN_abc123xyz</code>, send:<br/>
            <code className="bg-green-100 px-2 py-1 rounded mt-2 inline-block">/verify_basic TXN_abc123xyz</code>
          </p>
        </div>

        {/* Need Help */}
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-orange-800">
            <strong>❓ Can't find the email?</strong><br/>
            <span className="text-xs">• Check your spam/junk folder<br/>
            • Wait 2-3 minutes for the email to arrive<br/>
            • Make sure you're checking the correct email address<br/>
            • Look for sender: "Paystack" or "Paystack Payments"</span>
          </p>
        </div>
        </>
        )}

        {/* CTA Button */}
        <button
          onClick={() => {
            // Try to close the window and return to Telegram
            window.close()
            setTimeout(() => {
              window.location.href = 'tg://resolve'
            }, 500)
          }}
          className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold py-4 px-6 rounded-xl text-lg shadow-lg transition-all duration-200"
        >
          📱 Go Back to Telegram Bot
        </button>

        <p className="text-xs text-gray-500 text-center mt-4">
          Questions? Send /help to the bot
        </p>
      </div>
    </div>
  )
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <PaymentSuccessContent />
    </Suspense>
  )
}
