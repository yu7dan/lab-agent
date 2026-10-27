import xxhash from 'xxhash-wasm'

const CCH_SEED = 0x6E52736AC806831En
const CCH_PLACEHOLDER = 'cch=00000'
const CCH_MASK = 0xFFFFFn

let hasherPromise: ReturnType<typeof xxhash> | null = null

function getHasher() {
  if (!hasherPromise) {
    hasherPromise = xxhash()
  }
  return hasherPromise
}

export async function computeCch(body: string): Promise<string> {
  const hasher = await getHasher()
  const hash = hasher.h64Raw(new TextEncoder().encode(body), CCH_SEED)
  return (hash & CCH_MASK).toString(16).padStart(5, '0')
}

export function replaceCchPlaceholder(body: string, cch: string): string {
  return body.replace(CCH_PLACEHOLDER, `cch=${cch}`)
}

export function hasCchPlaceholder(body: string): boolean {
  return body.includes(CCH_PLACEHOLDER)
}
