import { createHash, randomBytes } from 'crypto'

/**
 * Encodes a buffer to base64URL format (RFC 4648).
 * @param buffer - The buffer to encode
 * @returns Base64URL encoded string
 */
function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/**
 * Generates a PKCE code verifier for OAuth 2.0 authentication.
 * @returns A cryptographically random code verifier string
 */
export function generateCodeVerifier(): string {
  return base64URLEncode(randomBytes(32))
}

/**
 * Generates a PKCE code challenge from a code verifier.
 * @param verifier - The code verifier to generate challenge for
 * @returns The SHA256 hash of the verifier, base64URL encoded
 */
export function generateCodeChallenge(verifier: string): string {
  const hash = createHash('sha256')
  hash.update(verifier)
  return base64URLEncode(hash.digest())
}

/**
 * Generates a random state parameter for OAuth 2.0 authentication.
 * @returns A cryptographically random state string
 */
export function generateState(): string {
  return base64URLEncode(randomBytes(32))
}
