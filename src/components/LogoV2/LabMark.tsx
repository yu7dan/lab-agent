import * as React from 'react'
import { Box, Text } from '../../ink.js'

/**
 * @deprecated Prefer LabAsciiLogo — kept so old imports don't break.
 */
export function LabMark() {
  return (
    <Box flexDirection="column" alignItems="flex-start">
      <Text color="rgb(57,255,20)" bold>
        Lab Agent
      </Text>
      <Text dimColor>coding</Text>
    </Box>
  )
}
