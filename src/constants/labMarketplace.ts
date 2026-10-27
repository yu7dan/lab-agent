/**
 * Lab marketplace — interface for our own plugin/skills market.
 *
 * Not ready yet: leave enabled off (default). No Anthropic market auto-install.
 *
 * When ready, in lab-agent.env:
 *   LAB_MARKETPLACE_ENABLED=1
 *   LAB_MARKETPLACE_REPO=your-org/lab-plugins
 * Optional:
 *   LAB_MARKETPLACE_NAME=lab-plugins
 *   LAB_MARKETPLACE_DISPLAY_NAME=Lab marketplace
 */

import type { MarketplaceSource } from '../utils/plugins/schemas.js'
import { isEnvTruthy } from '../utils/envUtils.js'

const DEFAULT_NAME = 'lab-plugins'
const DEFAULT_DISPLAY = 'Lab marketplace'

export type LabMarketplaceConfig = {
  enabled: boolean
  name: string
  displayName: string
  source: MarketplaceSource | null
}

export function getLabMarketplaceConfig(): LabMarketplaceConfig {
  const repo = process.env.LAB_MARKETPLACE_REPO?.trim() || ''
  const enabled = isEnvTruthy(process.env.LAB_MARKETPLACE_ENABLED) && repo.length > 0
  return {
    enabled,
    name: process.env.LAB_MARKETPLACE_NAME?.trim() || DEFAULT_NAME,
    displayName: process.env.LAB_MARKETPLACE_DISPLAY_NAME?.trim() || DEFAULT_DISPLAY,
    source: enabled ? ({ source: 'github', repo } as const) : null,
  }
}

export function isLabMarketplaceReady(): boolean {
  return getLabMarketplaceConfig().enabled
}
