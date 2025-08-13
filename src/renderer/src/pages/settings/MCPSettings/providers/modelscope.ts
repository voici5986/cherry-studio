import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import type { MCPServer } from '@renderer/types'
import i18next from 'i18next'

const logger = loggerService.withContext('ModelScopeSyncUtils')

// Token storage constants and utilities
const TOKEN_STORAGE_KEY = 'modelscope_token'
export const MODELSCOPE_HOST = 'https://www.modelscope.cn'

export const saveModelScopeToken = (token: string): void => {
  localStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export const getModelScopeToken = (): string | null => {
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export const clearModelScopeToken = (): void => {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
}

export const hasModelScopeToken = (): boolean => {
  return !!getModelScopeToken()
}

interface ModelScopeServer {
  id: string
  name: string
  chinese_name?: string
  description?: string
  operational_urls?: { url: string }[]
  tags?: string[]
  logo_url?: string
}

interface ModelScopeSyncResult {
  success: boolean
  message: string
  addedServers: MCPServer[]
  updatedServers: MCPServer[]
  errorDetails?: string
}

// Function to fetch and process ModelScope servers
export const syncModelScopeServers = async (
  token: string,
  existingServers: MCPServer[]
): Promise<ModelScopeSyncResult> => {
  const t = i18next.t

  try {
    const response = await fetch(`${MODELSCOPE_HOST}/api/v1/mcp/services/operational`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    })

    // Handle authentication errors
    if (response.status === 401 || response.status === 403) {
      clearModelScopeToken()
      return {
        success: false,
        message: t('settings.mcp.sync.unauthorized', 'Sync Unauthorized'),
        addedServers: [],
        updatedServers: []
      }
    }

    // Handle server errors
    if (response.status === 500 || !response.ok) {
      return {
        success: false,
        message: t('settings.mcp.sync.error'),
        addedServers: [],
        updatedServers: [],
        errorDetails: `Status: ${response.status}`
      }
    }

    // Process successful response
    const data = await response.json()
    const servers: ModelScopeServer[] = data.Data?.Result || []

    if (servers.length === 0) {
      return {
        success: true,
        message: t('settings.mcp.sync.noServersAvailable', 'No MCP servers available'),
        addedServers: [],
        updatedServers: []
      }
    }

    // Transform ModelScope servers to MCP servers format
    const addedServers: MCPServer[] = []
    const updatedServers: MCPServer[] = []

    for (const server of servers) {
      try {
        if (!server.operational_urls?.[0]?.url) continue

        // Check if server already exists
        const existingServer = existingServers.find((s) => s.id === `@modelscope/${server.id}`)

        const mcpServer: MCPServer = {
          id: `@modelscope/${server.id}`,
          name: server.chinese_name || server.name || `ModelScope Server ${nanoid()}`,
          description: server.description || '',
          type: 'sse',
          baseUrl: server.operational_urls[0].url,
          command: '',
          args: [],
          env: {},
          isActive: true,
          provider: 'ModelScope',
          providerUrl: `${MODELSCOPE_HOST}/mcp/servers/@${server.id}`,
          logoUrl: server.logo_url || '',
          tags: server.tags || []
        }

        if (existingServer) {
          // Update existing server with latest info
          updatedServers.push(mcpServer)
        } else {
          // Add new server
          addedServers.push(mcpServer)
        }
      } catch (err) {
        logger.error('Error processing ModelScope server:', err as Error)
      }
    }

    const totalServers = addedServers.length + updatedServers.length
    return {
      success: true,
      message: t('settings.mcp.sync.success', { count: totalServers }),
      addedServers,
      updatedServers
    }
  } catch (error) {
    logger.error('ModelScope sync error:', error as Error)
    return {
      success: false,
      message: t('settings.mcp.sync.error'),
      addedServers: [],
      updatedServers: [],
      errorDetails: String(error)
    }
  }
}
