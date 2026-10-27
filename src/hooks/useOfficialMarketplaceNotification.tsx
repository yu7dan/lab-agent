import * as React from 'react'
import { Text } from '../ink.js'
import { logForDebugging } from '../utils/debug.js'
import { getLabMarketplaceConfig } from '../constants/labMarketplace.js'
import { checkAndInstallLabMarketplace } from '../utils/plugins/labMarketplaceStartup.js'
import { checkAndInstallOfficialMarketplace } from '../utils/plugins/officialMarketplaceStartupCheck.js'
import { useStartupNotification } from './notifs/useStartupNotification.js'

/**
 * Startup marketplace notifications (bottom-right).
 * - Anthropic official market: disabled by default (no Anthropic toast).
 * - Lab market: installs only when LAB_MARKETPLACE_* is configured; otherwise silent.
 */
export function useOfficialMarketplaceNotification() {
  useStartupNotification(_temp)
}

async function _temp() {
  const notifs = []

  // Keep call for escape-hatch / telemetry path; Lab disables Anthropic by default
  // so this returns skipped without user-visible Anthropic messaging.
  await checkAndInstallOfficialMarketplace()

  const result = await checkAndInstallLabMarketplace()
  const displayName = getLabMarketplaceConfig().displayName

  if (result.installed) {
    logForDebugging('Showing Lab marketplace installation success notification')
    notifs.push({
      key: 'lab-marketplace-installed',
      jsx: (
        <Text color="success">
          ✓ {displayName} installed · /plugin to see available plugins
        </Text>
      ),
      priority: 'immediate' as const,
      timeoutMs: 7000,
    })
  } else if (result.skipped && result.reason === 'unknown') {
    logForDebugging('Showing Lab marketplace installation failure notification')
    notifs.push({
      key: 'lab-marketplace-install-failed',
      jsx: (
        <Text color="warning">
          Failed to install {displayName} · Will retry on next startup
        </Text>
      ),
      priority: 'immediate' as const,
      timeoutMs: 8000,
    })
  }

  return notifs
}
