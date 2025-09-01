import { loggerService } from '@logger'
import AiProvider from '@renderer/aiCore'
import { CompletionsParams } from '@renderer/aiCore/middleware/schemas'
import {
  isReasoningModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel
} from '@renderer/config/models'
import { db } from '@renderer/databases'
import { CustomTranslateLanguage, TranslateHistory, TranslateLanguage, TranslateLanguageCode } from '@renderer/types'
import { TranslateAssistant } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import { uuid } from '@renderer/utils'
import { formatErrorMessage, isAbortError } from '@renderer/utils/error'
import { t } from 'i18next'

import { hasApiKey } from './ApiService'
import { getDefaultTranslateAssistant, getProviderByModel } from './AssistantService'

const logger = loggerService.withContext('TranslateService')
interface FetchTranslateProps {
  assistant: TranslateAssistant
  onResponse?: (text: string, isComplete: boolean) => void
  abortKey?: string
}

async function fetchTranslate({ assistant, onResponse, abortKey }: FetchTranslateProps) {
  const model = assistant.model

  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    throw new Error(t('error.no_api_key'))
  }

  const isSupportedStreamOutput = () => {
    if (!onResponse) {
      return false
    }
    return true
  }

  const stream = isSupportedStreamOutput()
  const enableReasoning =
    ((isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) &&
      assistant.settings?.reasoning_effort !== undefined) ||
    (isReasoningModel(model) && (!isSupportedThinkingTokenModel(model) || !isSupportedReasoningEffortModel(model)))
  let abortError

  const params: CompletionsParams = {
    callType: 'translate',
    messages: assistant.content,
    assistant,
    streamOutput: stream,
    enableReasoning,
    onResponse,
    onChunk: (chunk) => {
      if (chunk.type === ChunkType.ERROR && isAbortError(chunk.error)) {
        abortError = chunk.error
      }
    },
    abortKey
  }

  const AI = new AiProvider(provider)

  const result = (await AI.completionsForTrace(params)).getText().trim()
  if (abortError) {
    throw abortError
  }
  return result
}

/**
 * 翻译文本到目标语言
 * @param text - 需要翻译的文本内容
 * @param targetLanguage - 目标语言
 * @param onResponse - 流式输出的回调函数，用于实时获取翻译结果
 * @param abortKey - 用于控制 abort 的键
 * @returns 返回翻译后的文本
 * @throws {Error} 翻译中止或失败时抛出异常
 */
export const translateText = async (
  text: string,
  targetLanguage: TranslateLanguage,
  onResponse?: (text: string, isComplete: boolean) => void,
  abortKey?: string
) => {
  try {
    const assistant = getDefaultTranslateAssistant(targetLanguage, text)

    const translatedText = await fetchTranslate({ assistant, onResponse, abortKey })

    const trimmedText = translatedText.trim()

    if (!trimmedText) {
      return Promise.reject(new Error(t('translate.error.empty')))
    }

    return trimmedText
  } catch (e) {
    if (isAbortError(e)) {
      window.message.info(t('translate.info.aborted'))
    } else {
      logger.error('Failed to translate', e as Error)
      window.message.error(t('translate.error.failed' + ': ' + formatErrorMessage(e)))
    }
    throw e
  }
}

/**
 * 添加自定义翻译语言
 * @param value - 语言名称
 * @param emoji - 语言对应的emoji图标
 * @param langCode - 语言代码
 * @returns {Promise<CustomTranslateLanguage>} 返回新添加的自定义语言对象
 * @throws {Error} 当语言已存在或添加失败时抛出错误
 */
export const addCustomLanguage = async (
  value: string,
  emoji: string,
  langCode: string
): Promise<CustomTranslateLanguage> => {
  // 按langcode判重
  const existing = await db.translate_languages.where('langCode').equals(langCode).first()
  if (existing) {
    logger.error(`Custom language ${langCode} exists.`)
    throw new Error(t('settings.translate.custom.error.langCode.exists'))
  } else {
    try {
      const item = {
        id: uuid(),
        value,
        langCode: langCode.toLowerCase(),
        emoji
      }
      await db.translate_languages.add(item)
      return item
    } catch (e) {
      logger.error('Failed to add custom language.', e as Error)
      throw e
    }
  }
}

/**
 * 删除自定义翻译语言
 * @param id - 要删除的自定义语言ID
 * @throws {Error} 删除自定义语言失败时抛出错误
 */
export const deleteCustomLanguage = async (id: string) => {
  try {
    await db.translate_languages.delete(id)
  } catch (e) {
    logger.error('Delete custom language failed.', e as Error)
    throw e
  }
}

/**
 * 更新自定义翻译语言
 * @param old - 原有的自定义语言对象
 * @param value - 新的语言名称
 * @param emoji - 新的语言emoji图标
 * @param langCode - 新的语言代码
 * @throws {Error} 更新自定义语言失败时抛出错误
 */
export const updateCustomLanguage = async (
  old: CustomTranslateLanguage,
  value: string,
  emoji: string,
  langCode: string
) => {
  try {
    await db.translate_languages.put({
      id: old.id,
      value,
      langCode: langCode.toLowerCase(),
      emoji
    })
  } catch (e) {
    logger.error('Update custom language failed.', e as Error)
    throw e
  }
}

/**
 * 获取所有自定义语言
 * @throws {Error} 获取自定义语言失败时抛出错误
 */
export const getAllCustomLanguages = async () => {
  try {
    const languages = await db.translate_languages.toArray()
    return languages
  } catch (e) {
    logger.error('Failed to get all custom languages.', e as Error)
    throw e
  }
}

/**
 * 保存翻译历史记录到数据库
 * @param sourceText - 原文内容
 * @param targetText - 翻译后的内容
 * @param sourceLanguage - 源语言代码
 * @param targetLanguage - 目标语言代码
 * @returns Promise<void>
 */
export const saveTranslateHistory = async (
  sourceText: string,
  targetText: string,
  sourceLanguage: TranslateLanguageCode,
  targetLanguage: TranslateLanguageCode
) => {
  const history: TranslateHistory = {
    id: uuid(),
    sourceText,
    targetText,
    sourceLanguage,
    targetLanguage,
    createdAt: new Date().toISOString()
  }
  await db.translate_history.add(history)
}

/**
 * 更新翻译历史记录
 * @param id - 历史记录ID
 * @param update - 更新内容
 * @returns Promise<void>
 */
export const updateTranslateHistory = async (id: string, update: Omit<Partial<TranslateHistory>, 'id'>) => {
  try {
    const history: Partial<TranslateHistory> = {
      ...update,
      id
    }
    await db.translate_history.update(id, history)
  } catch (e) {
    logger.error('Failed to update translate history', e as Error)
    throw e
  }
}

/**
 * 删除指定的翻译历史记录
 * @param id - 要删除的翻译历史记录ID
 * @returns Promise<void>
 */
export const deleteHistory = async (id: string) => {
  try {
    db.translate_history.delete(id)
  } catch (e) {
    logger.error('Failed to delete translate history', e as Error)
    throw e
  }
}

/**
 * 清空所有翻译历史记录
 * @returns Promise<void>
 */
export const clearHistory = async () => {
  db.translate_history.clear()
}
