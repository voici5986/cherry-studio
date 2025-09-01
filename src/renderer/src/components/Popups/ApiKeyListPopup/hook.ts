import { loggerService } from '@logger'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import SelectProviderModelPopup from '@renderer/pages/settings/ProviderSettings/SelectProviderModelPopup'
import { checkApi } from '@renderer/services/ApiService'
import WebSearchService from '@renderer/services/WebSearchService'
import {
  isPreprocessProviderId,
  isWebSearchProviderId,
  Model,
  PreprocessProvider,
  Provider,
  WebSearchProvider
} from '@renderer/types'
import { ApiKeyConnectivity, ApiKeyWithStatus, HealthStatus } from '@renderer/types/healthCheck'
import { formatApiKeys, splitApiKeyString } from '@renderer/utils/api'
import { formatErrorMessage } from '@renderer/utils/error'
import { TFunction } from 'i18next'
import { isEmpty } from 'lodash'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiKeyValidity, ApiProvider, UpdateApiProviderFunc } from './types'

interface UseApiKeysProps {
  provider: ApiProvider
  updateProvider: UpdateApiProviderFunc
}

const logger = loggerService.withContext('ApiKeyListPopup')

/**
 * API Keys 管理 hook
 */
export function useApiKeys({ provider, updateProvider }: UseApiKeysProps) {
  const { t } = useTranslation()

  // 连通性检查的 UI 状态管理
  const [connectivityStates, setConnectivityStates] = useState<Map<string, ApiKeyConnectivity>>(new Map())

  // 保存 apiKey 到 provider
  const updateProviderWithKey = useCallback(
    (newKeys: string[]) => {
      const validKeys = newKeys.filter((k) => k.trim())
      const formattedKeyString = formatApiKeys(validKeys.join(','))
      updateProvider({ apiKey: formattedKeyString })
    },
    [updateProvider]
  )

  // 解析 keyString 为数组
  const keys = useMemo(() => {
    if (!provider.apiKey) return []
    const formattedApiKeys = formatApiKeys(provider.apiKey)
    const keys = splitApiKeyString(formattedApiKeys)
    return Array.from(new Set(keys))
  }, [provider.apiKey])

  // 合并基本数据和连通性状态
  const keysWithStatus = useMemo((): ApiKeyWithStatus[] => {
    return keys.map((key) => {
      const connectivityState = connectivityStates.get(key) || {
        status: HealthStatus.NOT_CHECKED,
        checking: false,
        error: undefined,
        model: undefined,
        latency: undefined
      }
      return {
        key,
        ...connectivityState
      }
    })
  }, [keys, connectivityStates])

  // 更新单个 key 的连通性状态
  const updateConnectivityState = useCallback((key: string, state: Partial<ApiKeyConnectivity>) => {
    setConnectivityStates((prev) => {
      const newMap = new Map(prev)
      const currentState = prev.get(key) || {
        status: HealthStatus.NOT_CHECKED,
        checking: false,
        error: undefined,
        model: undefined,
        latency: undefined
      }
      newMap.set(key, { ...currentState, ...state })
      return newMap
    })
  }, [])

  // 验证 API key 格式
  const validateApiKey = useCallback(
    (key: string, existingKeys: string[] = []): ApiKeyValidity => {
      const trimmedKey = key.trim()

      if (!trimmedKey) {
        return { isValid: false, error: t('settings.provider.api.key.error.empty') }
      }

      if (existingKeys.includes(trimmedKey)) {
        return { isValid: false, error: t('settings.provider.api.key.error.duplicate') }
      }

      return { isValid: true }
    },
    [t]
  )

  // 添加新 key
  const addKey = useCallback(
    (key: string): ApiKeyValidity => {
      const validation = validateApiKey(key, keys)

      if (!validation.isValid) {
        return validation
      }

      updateProviderWithKey([...keys, key.trim()])
      return { isValid: true }
    },
    [validateApiKey, keys, updateProviderWithKey]
  )

  // 更新 key
  const updateKey = useCallback(
    (index: number, key: string): ApiKeyValidity => {
      if (index < 0 || index >= keys.length) {
        logger.error('invalid key index', { index })
        return { isValid: false, error: 'Invalid index' }
      }

      const otherKeys = keys.filter((_, i) => i !== index)
      const validation = validateApiKey(key, otherKeys)

      if (!validation.isValid) {
        return validation
      }

      // 清除旧 key 的连通性状态
      const oldKey = keys[index]
      if (oldKey !== key.trim()) {
        setConnectivityStates((prev) => {
          const newMap = new Map(prev)
          newMap.delete(oldKey)
          return newMap
        })
      }

      const newKeys = [...keys]
      newKeys[index] = key.trim()
      updateProviderWithKey(newKeys)

      return { isValid: true }
    },
    [keys, validateApiKey, updateProviderWithKey]
  )

  // 移除 key
  const removeKey = useCallback(
    (index: number) => {
      if (index < 0 || index >= keys.length) return

      const keyToRemove = keys[index]
      const newKeys = keys.filter((_, i) => i !== index)

      // 清除对应的连通性状态
      setConnectivityStates((prev) => {
        const newMap = new Map(prev)
        newMap.delete(keyToRemove)
        return newMap
      })

      updateProviderWithKey(newKeys)
    },
    [keys, updateProviderWithKey]
  )

  // 移除连通性检查失败的 keys
  const removeInvalidKeys = useCallback(() => {
    const validKeys = keysWithStatus.filter((keyStatus) => keyStatus.status !== HealthStatus.FAILED).map((k) => k.key)

    // 清除被删除的 keys 的连通性状态
    const keysToRemove = keysWithStatus
      .filter((keyStatus) => keyStatus.status === HealthStatus.FAILED)
      .map((k) => k.key)

    setConnectivityStates((prev) => {
      const newMap = new Map(prev)
      keysToRemove.forEach((key) => newMap.delete(key))
      return newMap
    })

    updateProviderWithKey(validKeys)
  }, [keysWithStatus, updateProviderWithKey])

  // 检查单个 key 的连通性，不负责选择和验证模型
  const runConnectivityCheck = useCallback(
    async (index: number, model?: Model): Promise<void> => {
      const keyToCheck = keys[index]
      const currentState = connectivityStates.get(keyToCheck)
      if (currentState?.checking) return

      // 设置检查状态
      updateConnectivityState(keyToCheck, { checking: true })

      try {
        const startTime = Date.now()
        if (isLlmProvider(provider) && model) {
          await checkApi({ ...provider, apiKey: keyToCheck }, model)
        } else if (isWebSearchProvider(provider)) {
          const result = await WebSearchService.checkSearch({ ...provider, apiKey: keyToCheck })
          if (!result.valid) throw new Error(result.error)
        } else {
          // 不处理预处理供应商
        }
        const latency = Date.now() - startTime

        // 连通性检查成功
        updateConnectivityState(keyToCheck, {
          checking: false,
          status: HealthStatus.SUCCESS,
          model,
          latency,
          error: undefined
        })
      } catch (error: any) {
        // 连通性检查失败
        updateConnectivityState(keyToCheck, {
          checking: false,
          status: HealthStatus.FAILED,
          error: formatErrorMessage(error),
          model: undefined,
          latency: undefined
        })

        logger.error('failed to validate the connectivity of the api key', error)
      }
    },
    [keys, connectivityStates, updateConnectivityState, provider]
  )

  // 检查单个 key 的连通性
  const checkKeyConnectivity = useCallback(
    async (index: number): Promise<void> => {
      if (!provider || index < 0 || index >= keys.length) return

      const keyToCheck = keys[index]
      const currentState = connectivityStates.get(keyToCheck)
      if (currentState?.checking) return

      const model = isLlmProvider(provider) ? await getModelForCheck(provider, t) : undefined
      if (model === null) return

      await runConnectivityCheck(index, model)
    },
    [provider, keys, connectivityStates, t, runConnectivityCheck]
  )

  // 检查所有 keys 的连通性
  const checkAllKeysConnectivity = useCallback(async () => {
    if (!provider || keys.length === 0) return

    const model = isLlmProvider(provider) ? await getModelForCheck(provider, t) : undefined
    if (model === null) return

    await Promise.allSettled(keys.map((_, index) => runConnectivityCheck(index, model)))
  }, [provider, keys, t, runConnectivityCheck])

  // 计算是否有 key 正在检查
  const isChecking = useMemo(() => {
    return Array.from(connectivityStates.values()).some((state) => state.checking)
  }, [connectivityStates])

  return {
    keys: keysWithStatus,
    addKey,
    updateKey,
    removeKey,
    removeInvalidKeys,
    checkKeyConnectivity,
    checkAllKeysConnectivity,
    isChecking
  }
}

export function isLlmProvider(provider: ApiProvider): provider is Provider {
  return 'models' in provider
}

export function isWebSearchProvider(provider: ApiProvider): provider is WebSearchProvider {
  return isWebSearchProviderId(provider.id)
}

export function isPreprocessProvider(provider: ApiProvider): provider is PreprocessProvider {
  // NOTE: mistral 同时提供预处理和llm服务，所以其llm provier可能被误判为预处理provider
  // 后面需要使用更严格的判断方式
  return isPreprocessProviderId(provider.id) && !isLlmProvider(provider)
}

// 获取模型用于检查
async function getModelForCheck(provider: Provider, t: TFunction): Promise<Model | null> {
  const modelsToCheck = provider.models.filter((model) => !isEmbeddingModel(model) && !isRerankModel(model))

  if (isEmpty(modelsToCheck)) {
    window.message.error({
      key: 'no-models',
      style: { marginTop: '3vh' },
      duration: 5,
      content: t('settings.provider.no_models_for_check')
    })
    return null
  }

  try {
    const selectedModel = await SelectProviderModelPopup.show({ provider })
    if (!selectedModel) return null
    return selectedModel
  } catch (error) {
    logger.error('failed to select model', error as Error)
    return null
  }
}
