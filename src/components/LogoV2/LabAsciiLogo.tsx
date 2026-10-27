import * as React from 'react'
import { Box, Text } from '../../ink.js'

export const LAB_NEON = 'rgb(57,255,20)'
export const LAB_NEON_DIM = 'rgb(0,150,60)'
export const LAB_SHADOW = 'rgb(0,78,36)'

/** Scheme A: full ANSI Shadow wordmark — LAB CODE */
const LAB_LINES = [
  ' ██╗      █████╗ ██████╗      ██████╗ ██████╗ ██████╗ ███████╗',
  ' ██║     ██╔══██╗██╔══██╗    ██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  ' ██║     ███████║██████╔╝    ██║     ██║   ██║██║  ██║█████╗  ',
  ' ██║     ██╔══██║██╔══██╗    ██║     ██║   ██║██║  ██║██╔══╝  ',
  ' ███████╗██║  ██║██████╔╝    ╚██████╗╚██████╔╝██████╔╝███████╗',
  ' ╚══════╝╚═╝  ╚═╝╚═════╝      ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝',
]

const LAB_SHADOW_LINE = ' ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░'

type Props = {
  /** welcome adds a bit more spacing; art size is the same readable wordmark */
  size?: 'hero' | 'compact'
}

/**
 * Lab Agent wordmark — scheme A: single-line figlet LAB CODE + ground shadow.
 */
export function LabAsciiLogo({ size = 'compact' }: Props) {
  const gap = size === 'hero' ? 1 : 0
  return (
    <Box flexDirection="column" marginBottom={gap}>
      {LAB_LINES.map((line, i) => (
        <Text key={i} color={LAB_NEON} bold>
          {line}
        </Text>
      ))}
      <Text color={LAB_SHADOW}>{LAB_SHADOW_LINE}</Text>
    </Box>
  )
}
