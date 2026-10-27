import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { LabAsciiLogo, LAB_NEON, LAB_NEON_DIM } from './LabAsciiLogo.js'

/** First-run welcome — option 1 LAB + short intro */
export function WelcomeV2() {
  return (
    <Box flexDirection="column" marginY={1} gap={1}>
      <LabAsciiLogo size="hero" />
      <Box flexDirection="column">
        <Text>
          <Text color={LAB_NEON} bold>
            Lab Agent
          </Text>
          <Text dimColor> · </Text>
          <Text color={LAB_NEON_DIM}>Lab Code</Text>
        </Text>
        <Text dimColor>Terminal coding agent · DeepSeek backend</Text>
        <Text dimColor>v{MACRO.VERSION}</Text>
      </Box>
    </Box>
  )
}
