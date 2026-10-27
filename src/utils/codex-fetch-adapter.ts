/**
 * OpenAI Codex API adapter for Claude Code
 * Provides compatibility layer between Claude's API expectations and OpenAI's Codex API
 */

import type { Message } from '../types/message.js'
import { logError } from './log.js'

/**
 * OpenAI message format for API requests
 */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{
    type: 'text' | 'image_url'
    text?: string
    image_url?: {
      url: string
    }
  }>
}

/**
 * OpenAI API response format
 */
interface OpenAIResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/**
 * Convert Claude Code message format to OpenAI format
 */
function convertToOpenAIMessage(message: Message): OpenAIMessage {
  if (typeof message.content === 'string') {
    return {
      role: message.role === 'human' ? 'user' : message.role as 'system' | 'assistant',
      content: message.content,
    }
  }

  // Handle multi-modal content
  const content: Array<any> = []

  for (const item of message.content) {
    if (item.type === 'text') {
      content.push({
        type: 'text',
        text: item.text,
      })
    } else if (item.type === 'image') {
      // Convert Anthropic base64 image schema to OpenAI format
      content.push({
        type: 'image_url',
        image_url: {
          url: item.source.type === 'base64'
            ? `data:${item.source.media_type};base64,${item.source.data}`
            : item.source.data
        }
      })
    }
  }

  return {
    role: message.role === 'human' ? 'user' : message.role as 'system' | 'assistant',
    content,
  }
}

/**
 * Make a request to OpenAI Codex API
 */
export async function fetchCodexResponse(
  messages: Message[],
  model: string,
  options: {
    apiKey?: string
    baseUrl?: string
    stream?: boolean
  } = {}
): Promise<OpenAIResponse> {
  const { apiKey, baseUrl = 'https://api.openai.com/v1', stream = false } = options

  if (!apiKey) {
    throw new Error('OpenAI API key is required for Codex requests')
  }

  const openAIMessages = messages.map(convertToOpenAIMessage)

  const requestBody = {
    model,
    messages: openAIMessages,
    stream,
    temperature: 0.7,
    max_tokens: 4096,
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as OpenAIResponse
    return data
  } catch (error) {
    logError(error)
    throw error
  }
}

/**
 * Convert OpenAI response to Claude Code format
 */
export function convertFromOpenAIResponse(response: OpenAIResponse): {
  content: string
  usage: {
    input_tokens: number
    output_tokens: number
  }
} {
  const choice = response.choices[0]
  if (!choice) {
    throw new Error('No choices in OpenAI response')
  }

  return {
    content: choice.message.content,
    usage: {
      input_tokens: response.usage.prompt_tokens,
      output_tokens: response.usage.completion_tokens,
    },
  }
}