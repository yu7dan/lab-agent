/**
 * Lab marketplace startup install (stub until market is ready).
 *
 * When `isLabMarketplaceReady()`, install via the same marketplace manager
 * path used by the upstream official market — but with Lab's source.
 */

import { join } from 'path'
import { getLabMarketplaceConfig, isLabMarketplaceReady } from '../../constants/labMarketplace.js'
import { logForDebugging } from '../debug.js'
import { addMarketplaceSource, getMarketplacesCacheDir, loadKnownMarketplacesConfig } from './marketplaceManager.js'
import type { OfficialMarketplaceCheckResult, OfficialMarketplaceSkipReason } from './officialMarketplaceStartupCheck.js'

export type LabMarketplaceCheckResult = OfficialMarketplaceCheckResult

/**
 * Auto-install Lab marketplace when configured; otherwise no-op (silent).
 */
export async function checkAndInstallLabMarketplace(): Promise<LabMarketplaceCheckResult> {
  if (!isLabMarketplaceReady()) {
    logForDebugging('Lab marketplace not configured — skip auto-install (interface reserved)')
    return { installed: false, skipped: true, reason: 'already_attempted' }
  }

  const cfg = getLabMarketplaceConfig()
  if (!cfg.source) {
    return { installed: false, skipped: true, reason: 'unknown' }
  }

  try {
    const known = await loadKnownMarketplacesConfig()
    if (known[cfg.name]) {
      logForDebugging(`Lab marketplace '${cfg.name}' already installed`)
      return { installed: false, skipped: true, reason: 'already_installed' }
    }

    logForDebugging(`Installing Lab marketplace from ${JSON.stringify(cfg.source)}`)
    await addMarketplaceSource(cfg.source)
    // Ensure cache path exists for consistency with upstream flow
    const cacheDir = getMarketplacesCacheDir()
    void join(cacheDir, cfg.name)

    return { installed: true, skipped: false }
  } catch (err) {
    logForDebugging(`Lab marketplace install failed: ${err}`)
    return { installed: false, skipped: true, reason: 'unknown' as OfficialMarketplaceSkipReason }
  }
}
