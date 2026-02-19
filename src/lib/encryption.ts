import crypto from 'crypto'

const ALGORITHM = 'aes-256-cbc'
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!
const IV_LENGTH = 16

/**
 * Encrypt a password using AES-256-CBC
 * @param password - Plain text password to encrypt
 * @returns Encrypted password in format "iv:encryptedData"
 */
export function encryptPassword(password: string): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH)
    const key = Buffer.from(ENCRYPTION_KEY, 'hex')
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

    let encrypted = cipher.update(password, 'utf8', 'hex')
    encrypted += cipher.final('hex')

    return iv.toString('hex') + ':' + encrypted
  } catch (error) {
    console.error('Error encrypting password:', error)
    throw new Error('Failed to encrypt password')
  }
}

/**
 * Decrypt a password encrypted with encryptPassword
 * @param encryptedPassword - Encrypted password in format "iv:encryptedData"
 * @returns Decrypted plain text password
 */
export function decryptPassword(encryptedPassword: string): string {
  try {
    const parts = encryptedPassword.split(':')
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted password format')
    }

    const iv = Buffer.from(parts[0], 'hex')
    const key = Buffer.from(ENCRYPTION_KEY, 'hex')
    const encrypted = parts[1]

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch (error) {
    console.error('Error decrypting password:', error)
    throw new Error('Failed to decrypt password')
  }
}
