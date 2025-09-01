import { RootState } from '@renderer/store'
import { syncPreprocessProvider as _syncPreprocessProvider } from '@renderer/store/knowledge'
import {
  setDefaultPreprocessProvider as _setDefaultPreprocessProvider,
  updatePreprocessProvider as _updatePreprocessProvider,
  updatePreprocessProviders as _updatePreprocessProviders
} from '@renderer/store/preprocess'
import { PreprocessProvider, PreprocessProviderId } from '@renderer/types'
import { useDispatch, useSelector } from 'react-redux'

export const usePreprocessProvider = (id: PreprocessProviderId) => {
  const dispatch = useDispatch()
  const preprocessProviders = useSelector((state: RootState) => state.preprocess.providers)
  const provider = preprocessProviders.find((provider) => provider.id === id)
  if (!provider) {
    throw new Error(`preprocess provider with id ${id} not found`)
  }

  return {
    provider,
    updateProvider: (updates: Partial<PreprocessProvider>) => {
      const payload = { id, ...updates }
      dispatch(_updatePreprocessProvider(payload))
      // 将更新同步到所有知识库中的引用
      if (updates.apiHost || updates.apiKey || updates.model) {
        dispatch(_syncPreprocessProvider(payload))
      }
    }
  }
}

export const usePreprocessProviders = () => {
  const dispatch = useDispatch()
  const preprocessProviders = useSelector((state: RootState) => state.preprocess.providers)
  return {
    preprocessProviders: preprocessProviders,
    updatePreprocessProviders: (preprocessProviders: PreprocessProvider[]) =>
      dispatch(_updatePreprocessProviders(preprocessProviders))
  }
}

export const useDefaultPreprocessProvider = () => {
  const defaultProviderId = useSelector((state: RootState) => state.preprocess.defaultProvider)
  const { preprocessProviders } = usePreprocessProviders()
  const dispatch = useDispatch()
  const provider = defaultProviderId
    ? preprocessProviders.find((provider) => provider.id === defaultProviderId)
    : undefined

  const setDefaultPreprocessProvider = (preprocessProvider: PreprocessProvider) => {
    dispatch(_setDefaultPreprocessProvider(preprocessProvider.id))
  }
  const updateDefaultPreprocessProvider = (preprocessProvider: PreprocessProvider) => {
    dispatch(_updatePreprocessProvider(preprocessProvider))
  }
  return { provider, setDefaultPreprocessProvider, updateDefaultPreprocessProvider }
}
