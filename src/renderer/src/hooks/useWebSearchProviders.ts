import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addSubscribeSource as _addSubscribeSource,
  type CompressionConfig,
  removeSubscribeSource as _removeSubscribeSource,
  setCompressionConfig,
  setDefaultProvider as _setDefaultProvider,
  setSubscribeSources as _setSubscribeSources,
  updateCompressionConfig,
  updateSubscribeBlacklist as _updateSubscribeBlacklist,
  updateWebSearchProvider,
  updateWebSearchProviders
} from '@renderer/store/websearch'
import { WebSearchProvider, WebSearchProviderId } from '@renderer/types'

export const useDefaultWebSearchProvider = () => {
  const defaultProvider = useAppSelector((state) => state.websearch.defaultProvider)
  const { providers } = useWebSearchProviders()
  const provider = defaultProvider ? providers.find((provider) => provider.id === defaultProvider) : undefined
  const dispatch = useAppDispatch()

  const setDefaultProvider = (provider: WebSearchProvider) => {
    dispatch(_setDefaultProvider(provider.id))
  }

  const updateDefaultProvider = (provider: WebSearchProvider) => {
    dispatch(updateWebSearchProvider(provider))
  }

  return { provider, setDefaultProvider, updateDefaultProvider }
}

export const useWebSearchProviders = () => {
  const providers = useAppSelector((state) => state.websearch.providers)

  const dispatch = useAppDispatch()

  return {
    providers,
    updateWebSearchProviders: (providers: WebSearchProvider[]) => dispatch(updateWebSearchProviders(providers)),
    addWebSearchProvider: (provider: WebSearchProvider) => {
      // Check if provider exists
      const exists = providers.some((p) => p.id === provider.id)
      if (!exists) {
        // Use the existing update action to add the new provider
        dispatch(updateWebSearchProviders([...providers, provider]))
      }
    }
  }
}

export const useWebSearchProvider = (id: WebSearchProviderId) => {
  const providers = useAppSelector((state) => state.websearch.providers)
  const provider = providers.find((provider) => provider.id === id)
  const dispatch = useAppDispatch()

  if (!provider) {
    throw new Error(`Web search provider with id ${id} not found`)
  }

  return {
    provider,
    updateProvider: (updates: Partial<WebSearchProvider>) => {
      dispatch(updateWebSearchProvider({ id, ...updates }))
    }
  }
}

export const useBlacklist = () => {
  const dispatch = useAppDispatch()
  const websearch = useAppSelector((state) => state.websearch)

  const addSubscribeSource = ({ url, name, blacklist }) => {
    dispatch(_addSubscribeSource({ url, name, blacklist }))
  }

  const removeSubscribeSource = (key: number) => {
    dispatch(_removeSubscribeSource(key))
  }

  const updateSubscribeBlacklist = (key: number, blacklist: string[]) => {
    dispatch(_updateSubscribeBlacklist({ key, blacklist }))
  }

  const setSubscribeSources = (sources: { key: number; url: string; name: string; blacklist?: string[] }[]) => {
    dispatch(_setSubscribeSources(sources))
  }

  return {
    websearch,
    addSubscribeSource,
    removeSubscribeSource,
    updateSubscribeBlacklist,
    setSubscribeSources
  }
}

export const useWebSearchSettings = () => {
  const state = useAppSelector((state) => state.websearch)
  const dispatch = useAppDispatch()

  return {
    ...state,
    setCompressionConfig: (config: CompressionConfig) => dispatch(setCompressionConfig(config)),
    updateCompressionConfig: (config: Partial<CompressionConfig>) => dispatch(updateCompressionConfig(config))
  }
}
