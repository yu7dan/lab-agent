import * as React from 'react'
import { useEffect } from 'react'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Text } from '../../ink.js'
import { useAppState } from '../../state/AppState.js'
import { getEffortSuffix } from '../../utils/effort.js'
import { truncate } from '../../utils/format.js'
import { formatModelAndBilling, getLogoDisplayData, truncatePath } from '../../utils/logoV2Utils.js'
import { renderModelSetting } from '../../utils/model/model.js'
import { OffscreenFreeze } from '../OffscreenFreeze.js'
import { GuestPassesUpsell, incrementGuestPassesSeenCount, useShowGuestPassesUpsell } from './GuestPassesUpsell.js'
import { LabAsciiLogo, LAB_NEON, LAB_NEON_DIM } from './LabAsciiLogo.js'
import {
  incrementOverageCreditUpsellSeenCount,
  OverageCreditUpsell,
  useShowOverageCreditUpsell,
} from './OverageCreditUpsell.js'

/**
 * Scheme A — flat terminal header (no dual-column table, no feeds).
 *
 *   [3-line neon LAB]
 *   Lab Code · model · path
 *   v…
 */
export function CondensedLogo() {
  const { columns } = useTerminalSize()
  const agent = useAppState(s => s.agent)
  const effortValue = useAppState(s => s.effortValue)
  const model = useMainLoopModel()
  const modelDisplayName = renderModelSetting(model)
  const { version, cwd, billingType, agentName: agentNameFromSettings } = getLogoDisplayData()
  const agentName = agent ?? agentNameFromSettings
  const showGuestPassesUpsell = useShowGuestPassesUpsell()
  const showOverageCreditUpsell = useShowOverageCreditUpsell()

  useEffect(() => {
    if (showGuestPassesUpsell) incrementGuestPassesSeenCount()
  }, [showGuestPassesUpsell])

  useEffect(() => {
    if (showOverageCreditUpsell && !showGuestPassesUpsell) {
      incrementOverageCreditUpsellSeenCount()
    }
  }, [showOverageCreditUpsell, showGuestPassesUpsell])

  const textWidth = Math.max(columns - 2, 20)
  const truncatedVersion = truncate(version, Math.max(textWidth - 12, 8))
  const effortSuffix = getEffortSuffix(model, effortValue)
  const { truncatedModel, truncatedBilling } = formatModelAndBilling(
    modelDisplayName + effortSuffix,
    billingType,
    Math.max(textWidth - 4, 16),
  )
  const truncatedCwd = truncatePath(cwd, Math.max(textWidth - 4, 12))
  const cwdLine = agentName ? `@${agentName} · ${truncatedCwd}` : truncatedCwd

  return (
    <OffscreenFreeze>
      <Box flexDirection="column" marginBottom={1} gap={1} width={columns}>
        <LabAsciiLogo size="compact" />
        <Box flexDirection="column">
          <Text>
            <Text color={LAB_NEON} bold>
              Lab Code
            </Text>
            <Text dimColor>
              {' '}
              · {truncatedModel} · {truncatedBilling}
            </Text>
          </Text>
          <Text dimColor>{cwdLine}</Text>
          <Text color={LAB_NEON_DIM}>v{truncatedVersion}</Text>
        </Box>
        {showGuestPassesUpsell ? <GuestPassesUpsell /> : null}
        {!showGuestPassesUpsell && showOverageCreditUpsell ? (
          <OverageCreditUpsell maxWidth={textWidth} twoLine />
        ) : null}
      </Box>
    </OffscreenFreeze>
  )
}
