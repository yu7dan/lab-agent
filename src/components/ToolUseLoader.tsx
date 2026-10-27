import React from 'react'
import {
  LAB_MARK_MIN_WIDTH,
  LAB_MARK_TOOL_DONE,
  LAB_MARK_TOOL_FAIL,
  LAB_MARK_TOOL_RUNNING,
} from '../constants/figures.js'
import { useBlink } from '../hooks/useBlink.js'
import { Box, Text } from '../ink.js'

type Props = {
  isError: boolean
  isUnresolved: boolean
  shouldAnimate: boolean
}

export function ToolUseLoader({
  isError,
  isUnresolved,
  shouldAnimate,
}: Props): React.ReactNode {
  const [ref, isBlinking] = useBlink(shouldAnimate)
  const color = isUnresolved ? undefined : isError ? 'error' : 'success'
  const mark = isError
    ? LAB_MARK_TOOL_FAIL
    : isUnresolved
      ? LAB_MARK_TOOL_RUNNING
      : LAB_MARK_TOOL_DONE
  // Blink while running: show mark / blank; settled shows done/fail mark
  const shown =
    !shouldAnimate || isBlinking || isError || !isUnresolved ? mark : ' '

  return (
    <Box ref={ref} minWidth={LAB_MARK_MIN_WIDTH}>
      <Text color={color} dimColor={isUnresolved}>
        {shown}
      </Text>
    </Box>
  )
}
