import { c as _c } from 'react/compiler-runtime'
import * as React from 'react'
import { Box, Text, useTheme } from '../../ink.js'
import { getTheme, type Theme } from '../../utils/theme.js'
import { interpolateColor, parseRGB, toRGBColor } from './utils.js'

/** Classic braille terminal spinner (compact, 1 cell) */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const REDUCED_MOTION_DOT = '●'
const REDUCED_MOTION_CYCLE_MS = 2000
const ERROR_RED = { r: 171, g: 43, b: 63 }

type Props = {
  frame: number
  messageColor: keyof Theme
  stalledIntensity?: number
  reducedMotion?: boolean
  time?: number
}

/**
 * Normal terminal spinner glyph — single braille cell, not a pixel grid.
 */
export function SpinnerGlyph(t0: Props): React.ReactNode {
  const $ = _c(9)
  const {
    frame,
    messageColor,
    stalledIntensity: t1,
    reducedMotion: t2,
    time: t3,
  } = t0
  const stalledIntensity = t1 === undefined ? 0 : t1
  const reducedMotion = t2 === undefined ? false : t2
  const time = t3 === undefined ? 0 : t3
  const [themeName] = useTheme()
  const theme = getTheme(themeName)

  if (reducedMotion) {
    const isDim = Math.floor(time / (REDUCED_MOTION_CYCLE_MS / 2)) % 2 === 1
    let t4
    if ($[0] !== isDim || $[1] !== messageColor) {
      t4 = (
        <Box flexWrap="wrap" height={1} width={2}>
          <Text color={messageColor} dimColor={isDim}>
            {REDUCED_MOTION_DOT}
          </Text>
        </Box>
      )
      $[0] = isDim
      $[1] = messageColor
      $[2] = t4
    } else {
      t4 = $[2]
    }
    return t4
  }

  const spinnerChar = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!

  if (stalledIntensity > 0) {
    const baseColorStr = theme[messageColor]
    const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null
    if (baseRGB) {
      const interpolated = interpolateColor(baseRGB, ERROR_RED, stalledIntensity)
      return (
        <Box flexWrap="wrap" height={1} width={2}>
          <Text color={toRGBColor(interpolated)}>{spinnerChar}</Text>
        </Box>
      )
    }
    const color = stalledIntensity > 0.5 ? 'error' : messageColor
    let t4
    if ($[3] !== color || $[4] !== spinnerChar) {
      t4 = (
        <Box flexWrap="wrap" height={1} width={2}>
          <Text color={color}>{spinnerChar}</Text>
        </Box>
      )
      $[3] = color
      $[4] = spinnerChar
      $[5] = t4
    } else {
      t4 = $[5]
    }
    return t4
  }

  let t4
  if ($[6] !== messageColor || $[7] !== spinnerChar) {
    t4 = (
      <Box flexWrap="wrap" height={1} width={2}>
        <Text color={messageColor}>{spinnerChar}</Text>
      </Box>
    )
    $[6] = messageColor
    $[7] = spinnerChar
    $[8] = t4
  } else {
    t4 = $[8]
  }
  return t4
}
