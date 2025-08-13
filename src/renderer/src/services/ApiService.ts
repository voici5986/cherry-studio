import { loggerService } from '@logger'
import { CompletionsParams } from '@renderer/aiCore/middleware/schemas'
import { SYSTEM_PROMPT_THRESHOLD } from '@renderer/config/constant'
import {
  isEmbeddingModel,
  isGenerateImageModel,
  isOpenRouterBuiltInWebSearchModel,
  isReasoningModel,
  isSupportedDisableGenerationModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel,
  isWebSearchModel
} from '@renderer/config/models'
import {
  SEARCH_SUMMARY_PROMPT,
  SEARCH_SUMMARY_PROMPT_KNOWLEDGE_ONLY,
  SEARCH_SUMMARY_PROMPT_WEB_ONLY
} from '@renderer/config/prompts'
import { getModel } from '@renderer/hooks/useModel'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { currentSpan, withSpanResult } from '@renderer/services/SpanManagerService'
import store from '@renderer/store'
import { selectCurrentUserId, selectGlobalMemoryEnabled, selectMemoryConfig } from '@renderer/store/memory'
import {
  Assistant,
  ExternalToolResult,
  KnowledgeReference,
  MCPTool,
  MemoryItem,
  Model,
  Provider,
  WebSearchResponse,
  WebSearchSource
} from '@renderer/types'
import { type Chunk, ChunkType } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'
import { SdkModel } from '@renderer/types/sdk'
import { removeSpecialCharactersForTopicName, uuid } from '@renderer/utils'
import {
  abortCompletion,
  addAbortController,
  createAbortPromise,
  removeAbortController
} from '@renderer/utils/abortController'
import { isAbortError } from '@renderer/utils/error'
import { extractInfoFromXML, ExtractResults } from '@renderer/utils/extract'
import { filterAdjacentUserMessaegs, filterLastAssistantMessage } from '@renderer/utils/messageUtils/filters'
import { findFileBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import {
  buildSystemPromptWithThinkTool,
  buildSystemPromptWithTools,
  containsSupportedVariables,
  replacePromptVariables
} from '@renderer/utils/prompt'
import { findLast, isEmpty, takeRight } from 'lodash'

import AiProvider from '../aiCore'
import {
  getAssistantProvider,
  getAssistantSettings,
  getDefaultAssistant,
  getDefaultModel,
  getProviderByModel,
  getTopNamingModel
} from './AssistantService'
import { processKnowledgeSearch } from './KnowledgeService'
import { MemoryProcessor } from './MemoryProcessor'
import {
  filterAfterContextClearMessages,
  filterEmptyMessages,
  filterUsefulMessages,
  filterUserRoleStartMessages
} from './MessagesService'
import WebSearchService from './WebSearchService'

const logger = loggerService.withContext('ApiService')

// TODO：考虑拆开
async function fetchExternalTool(
  lastUserMessage: Message,
  assistant: Assistant,
  onChunkReceived: (chunk: Chunk) => void,
  lastAnswer?: Message
): Promise<ExternalToolResult> {
  // 可能会有重复？
  const knowledgeBaseIds = assistant.knowledge_bases?.map((base) => base.id)
  const hasKnowledgeBase = !isEmpty(knowledgeBaseIds)
  const knowledgeRecognition = assistant.knowledgeRecognition || 'on'
  const webSearchProvider = WebSearchService.getWebSearchProvider(assistant.webSearchProviderId)

  // 使用外部搜索工具
  const shouldWebSearch = !!assistant.webSearchProviderId && webSearchProvider !== null
  const shouldKnowledgeSearch = hasKnowledgeBase
  const globalMemoryEnabled = selectGlobalMemoryEnabled(store.getState())
  const shouldSearchMemory = globalMemoryEnabled && assistant.enableMemory

  // 获取 MCP 工具
  let mcpTools: MCPTool[] = []
  const allMcpServers = store.getState().mcp.servers || []
  const activedMcpServers = allMcpServers.filter((s) => s.isActive)
  const assistantMcpServers = assistant.mcpServers || []
  const enabledMCPs = activedMcpServers.filter((server) => assistantMcpServers.some((s) => s.id === server.id))
  const showListTools = enabledMCPs && enabledMCPs.length > 0

  // 是否使用工具
  const hasAnyTool = shouldWebSearch || shouldKnowledgeSearch || shouldSearchMemory || showListTools

  // 在工具链开始时发送进度通知
  if (hasAnyTool) {
    onChunkReceived({ type: ChunkType.EXTERNEL_TOOL_IN_PROGRESS })
  }

  // --- Keyword/Question Extraction Function ---
  const extract = async (): Promise<ExtractResults | undefined> => {
    if (!lastUserMessage) return undefined

    // 根据配置决定是否需要提取
    const needWebExtract = shouldWebSearch
    const needKnowledgeExtract = hasKnowledgeBase && knowledgeRecognition === 'on'

    if (!needWebExtract && !needKnowledgeExtract) return undefined

    let prompt: string
    if (needWebExtract && !needKnowledgeExtract) {
      prompt = SEARCH_SUMMARY_PROMPT_WEB_ONLY
    } else if (!needWebExtract && needKnowledgeExtract) {
      prompt = SEARCH_SUMMARY_PROMPT_KNOWLEDGE_ONLY
    } else {
      prompt = SEARCH_SUMMARY_PROMPT
    }

    const summaryAssistant = getDefaultAssistant()
    summaryAssistant.model = assistant.model || getDefaultModel()
    summaryAssistant.prompt = prompt

    const callSearchSummary = async (params: { messages: Message[]; assistant: Assistant }) => {
      return await fetchSearchSummary(params)
    }

    const traceParams = {
      name: `${summaryAssistant.model?.name}.Summary`,
      tag: 'LLM',
      topicId: lastUserMessage.topicId,
      modelName: summaryAssistant.model.name
    }

    const searchSummaryParams = {
      messages: lastAnswer ? [lastAnswer, lastUserMessage] : [lastUserMessage],
      assistant: summaryAssistant
    }

    try {
      const result = await withSpanResult(callSearchSummary, traceParams, searchSummaryParams)

      if (!result) return getFallbackResult()

      const extracted = extractInfoFromXML(result.getText())
      // 根据需求过滤结果
      return {
        websearch: needWebExtract ? extracted?.websearch : undefined,
        knowledge: needKnowledgeExtract ? extracted?.knowledge : undefined
      }
    } catch (e: any) {
      logger.error('extract error', e)
      if (isAbortError(e)) throw e
      return getFallbackResult()
    }
  }

  const getFallbackResult = (): ExtractResults => {
    const fallbackContent = getMainTextContent(lastUserMessage)
    return {
      websearch: shouldWebSearch ? { question: [fallbackContent || 'search'] } : undefined,
      knowledge: shouldKnowledgeSearch
        ? {
            question: [fallbackContent || 'search'],
            rewrite: fallbackContent
          }
        : undefined
    }
  }

  // --- Web Search Function ---
  const searchTheWeb = async (
    extractResults: ExtractResults | undefined,
    parentSpanId?: string
  ): Promise<WebSearchResponse | undefined> => {
    if (!shouldWebSearch) return

    // Add check for extractResults existence early
    if (!extractResults?.websearch) {
      logger.warn('searchTheWeb called without valid extractResults.websearch')
      return
    }

    if (extractResults.websearch.question[0] === 'not_needed') return

    // Add check for assistant.model before using it
    if (!assistant.model) {
      logger.warn('searchTheWeb called without assistant.model')
      return undefined
    }

    try {
      // Use the consolidated processWebsearch function
      WebSearchService.createAbortSignal(lastUserMessage.id)
      let safeWebSearchProvider = webSearchProvider
      if (webSearchProvider) {
        safeWebSearchProvider = {
          ...webSearchProvider,
          topicId: lastUserMessage.topicId,
          parentSpanId,
          modelName: assistant.model.name
        }
      }
      const webSearchResponse = await WebSearchService.processWebsearch(
        safeWebSearchProvider!,
        extractResults,
        lastUserMessage.id
      )
      return {
        results: webSearchResponse,
        source: WebSearchSource.WEBSEARCH
      }
    } catch (error) {
      if (isAbortError(error)) throw error
      logger.error('Web search failed:', error as Error)
      return
    }
  }

  const searchMemory = async (): Promise<MemoryItem[] | undefined> => {
    if (!shouldSearchMemory) return []
    try {
      const memoryConfig = selectMemoryConfig(store.getState())
      const content = getMainTextContent(lastUserMessage)
      if (!content) {
        logger.warn('searchMemory called without valid content in lastUserMessage')
        return []
      }

      if (memoryConfig.llmApiClient && memoryConfig.embedderApiClient) {
        const currentUserId = selectCurrentUserId(store.getState())
        // Search for relevant memories
        const processorConfig = MemoryProcessor.getProcessorConfig(memoryConfig, assistant.id, currentUserId)
        logger.info(`Searching for relevant memories with content: ${content}`)
        const memoryProcessor = new MemoryProcessor()
        const relevantMemories = await memoryProcessor.searchRelevantMemories(
          content,
          processorConfig,
          5 // Limit to top 5 most relevant memories
        )

        if (relevantMemories?.length > 0) {
          logger.info('Found relevant memories:', relevantMemories)

          return relevantMemories
        }
        return []
      } else {
        logger.warn('Memory is enabled but embedding or LLM model is not configured')
        return []
      }
    } catch (error) {
      logger.error('Error processing memory search:', error as Error)
      // Continue with conversation even if memory processing fails
      return []
    }
  }

  // --- Knowledge Base Search Function ---
  const searchKnowledgeBase = async (
    extractResults: ExtractResults | undefined,
    parentSpanId?: string,
    modelName?: string
  ): Promise<KnowledgeReference[] | undefined> => {
    if (!hasKnowledgeBase) return

    // 知识库搜索条件
    let searchCriteria: { question: string[]; rewrite: string }
    if (knowledgeRecognition === 'off') {
      const directContent = getMainTextContent(lastUserMessage)
      searchCriteria = { question: [directContent || 'search'], rewrite: directContent }
    } else {
      // auto mode
      if (!extractResults?.knowledge) {
        logger.warn('searchKnowledgeBase: No valid search criteria in auto mode')
        return
      }
      searchCriteria = extractResults.knowledge
    }

    if (searchCriteria.question[0] === 'not_needed') return

    try {
      const tempExtractResults: ExtractResults = {
        websearch: undefined,
        knowledge: searchCriteria
      }
      // Attempt to get knowledgeBaseIds from the main text block
      // NOTE: This assumes knowledgeBaseIds are ONLY on the main text block
      // NOTE: processKnowledgeSearch needs to handle undefined ids gracefully
      // const mainTextBlock = mainTextBlocks
      //   ?.map((blockId) => store.getState().messageBlocks.entities[blockId])
      //   .find((block) => block?.type === MessageBlockType.MAIN_TEXT) as MainTextMessageBlock | undefined
      return await processKnowledgeSearch(
        tempExtractResults,
        knowledgeBaseIds,
        lastUserMessage.topicId,
        parentSpanId,
        modelName
      )
    } catch (error) {
      logger.error('Knowledge base search failed:', error as Error)
      return
    }
  }

  // --- Execute Extraction and Searches ---
  let extractResults: ExtractResults | undefined

  try {
    // 根据配置决定是否需要提取
    if (shouldWebSearch || hasKnowledgeBase) {
      extractResults = await extract()
      logger.info('[fetchExternalTool] Extraction results:', extractResults)
    }

    let webSearchResponseFromSearch: WebSearchResponse | undefined
    let knowledgeReferencesFromSearch: KnowledgeReference[] | undefined
    let memorySearchReferences: MemoryItem[] | undefined

    const parentSpanId = currentSpan(lastUserMessage.topicId, assistant.model?.name)?.spanContext().spanId
    if (shouldWebSearch) {
      webSearchResponseFromSearch = await searchTheWeb(extractResults, parentSpanId)
    }

    if (shouldKnowledgeSearch) {
      knowledgeReferencesFromSearch = await searchKnowledgeBase(extractResults, parentSpanId, assistant.model?.name)
    }

    if (shouldSearchMemory) {
      memorySearchReferences = await searchMemory()
    }

    if (lastUserMessage) {
      if (webSearchResponseFromSearch) {
        window.keyv.set(`web-search-${lastUserMessage.id}`, webSearchResponseFromSearch)
      }
      if (knowledgeReferencesFromSearch) {
        window.keyv.set(`knowledge-search-${lastUserMessage.id}`, knowledgeReferencesFromSearch)
      }
      if (memorySearchReferences) {
        window.keyv.set(`memory-search-${lastUserMessage.id}`, memorySearchReferences)
      }
    }

    if (showListTools) {
      try {
        const spanContext = currentSpan(lastUserMessage.topicId, assistant.model?.name)?.spanContext()
        const toolPromises = enabledMCPs.map<Promise<MCPTool[]>>(async (mcpServer) => {
          try {
            const tools = await window.api.mcp.listTools(mcpServer, spanContext)
            return tools.filter((tool: any) => !mcpServer.disabledTools?.includes(tool.name))
          } catch (error) {
            logger.error(`Error fetching tools from MCP server ${mcpServer.name}:`, error as Error)
            return []
          }
        })
        const results = await Promise.allSettled(toolPromises)
        mcpTools = results
          .filter((result): result is PromiseFulfilledResult<MCPTool[]> => result.status === 'fulfilled')
          .map((result) => result.value)
          .flat()

        // 根据toolUseMode决定如何构建系统提示词
        const basePrompt = assistant.prompt
        if (assistant.settings?.toolUseMode === 'prompt' || mcpTools.length > SYSTEM_PROMPT_THRESHOLD) {
          // 提示词模式：需要完整的工具定义，思考工具返回会打乱提示词的返回（先去掉）
          assistant.prompt = buildSystemPromptWithTools(basePrompt, mcpTools)
        } else {
          // 原生函数调用模式：仅需要注入思考指令
          assistant.prompt = buildSystemPromptWithThinkTool(basePrompt)
        }
      } catch (toolError) {
        logger.error('Error fetching MCP tools:', toolError as Error)
      }
    }

    // 发送工具执行完成通知
    if (hasAnyTool) {
      onChunkReceived({
        type: ChunkType.EXTERNEL_TOOL_COMPLETE,
        external_tool: {
          webSearch: webSearchResponseFromSearch,
          knowledge: knowledgeReferencesFromSearch,
          memories: memorySearchReferences
        }
      })
    }

    return { mcpTools }
  } catch (error) {
    if (isAbortError(error)) throw error
    logger.error('Tool execution failed:', error as Error)

    // 发送错误状态
    const wasAnyToolEnabled = shouldWebSearch || shouldKnowledgeSearch || shouldSearchMemory
    if (wasAnyToolEnabled) {
      onChunkReceived({
        type: ChunkType.EXTERNEL_TOOL_COMPLETE,
        external_tool: {
          webSearch: undefined,
          knowledge: undefined
        }
      })
    }

    return { mcpTools: [] }
  }
}

export async function fetchChatCompletion({
  messages,
  assistant,
  onChunkReceived
}: {
  messages: Message[]
  assistant: Assistant
  onChunkReceived: (chunk: Chunk) => void
  // TODO
  // onChunkStatus: (status: 'searching' | 'processing' | 'success' | 'error') => void
}) {
  logger.debug('fetchChatCompletion', messages, assistant)

  if (assistant.prompt && containsSupportedVariables(assistant.prompt)) {
    assistant.prompt = await replacePromptVariables(assistant.prompt, assistant.model?.name)
  }

  const provider = getAssistantProvider(assistant)
  const AI = new AiProvider(provider)

  // Make sure that 'Clear Context' works for all scenarios including external tool and normal chat.
  const filteredMessages1 = filterAfterContextClearMessages(messages)

  const lastUserMessage = findLast(messages, (m) => m.role === 'user')
  const lastAnswer = findLast(messages, (m) => m.role === 'assistant')
  if (!lastUserMessage) {
    logger.error('fetchChatCompletion returning early: Missing lastUserMessage or lastAnswer')
    return
  }
  // try {
  // NOTE: The search results are NOT added to the messages sent to the AI here.
  // They will be retrieved and used by the messageThunk later to create CitationBlocks.
  const { mcpTools } = await fetchExternalTool(lastUserMessage, assistant, onChunkReceived, lastAnswer)
  const model = assistant.model || getDefaultModel()

  onChunkReceived({ type: ChunkType.LLM_RESPONSE_CREATED })

  const { maxTokens, contextCount } = getAssistantSettings(assistant)

  const filteredMessages2 = filterUsefulMessages(filteredMessages1)

  const filteredMessages3 = filterLastAssistantMessage(filteredMessages2)

  const filteredMessages4 = filterAdjacentUserMessaegs(filteredMessages3)

  const _messages = filterUserRoleStartMessages(
    filterEmptyMessages(filterAfterContextClearMessages(takeRight(filteredMessages4, contextCount + 2))) // 取原来几个provider的最大值
  )

  // FIXME: qwen3即使关闭思考仍然会导致enableReasoning的结果为true
  const enableReasoning =
    ((isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) &&
      assistant.settings?.reasoning_effort !== undefined) ||
    (isReasoningModel(model) && (!isSupportedThinkingTokenModel(model) || !isSupportedReasoningEffortModel(model)))

  const enableWebSearch =
    (assistant.enableWebSearch && isWebSearchModel(model)) ||
    isOpenRouterBuiltInWebSearchModel(model) ||
    model.id.includes('sonar') ||
    false

  const enableUrlContext = assistant.enableUrlContext || false

  const enableGenerateImage =
    isGenerateImageModel(model) && (isSupportedDisableGenerationModel(model) ? assistant.enableGenerateImage : true)

  // --- Call AI Completions ---

  const completionsParams: CompletionsParams = {
    callType: 'chat',
    messages: _messages,
    assistant,
    onChunk: onChunkReceived,
    mcpTools: mcpTools,
    maxTokens,
    streamOutput: assistant.settings?.streamOutput || false,
    enableReasoning,
    enableWebSearch,
    enableUrlContext,
    enableGenerateImage,
    topicId: lastUserMessage.topicId
  }

  const requestOptions = {
    streamOutput: assistant.settings?.streamOutput || false
  }

  // Post-conversation memory processing
  const globalMemoryEnabled = selectGlobalMemoryEnabled(store.getState())
  if (globalMemoryEnabled && assistant.enableMemory) {
    processConversationMemory(messages, assistant)
  }

  return await AI.completionsForTrace(completionsParams, requestOptions)
}

/**
 * Process conversation for memory extraction and storage
 */
async function processConversationMemory(messages: Message[], assistant: Assistant) {
  try {
    const memoryConfig = selectMemoryConfig(store.getState())

    // Use assistant's model as fallback for memory processing if not configured
    const llmModel =
      getModel(memoryConfig.llmApiClient?.model, memoryConfig.llmApiClient?.provider) ||
      assistant.model ||
      getDefaultModel()
    const embedderModel =
      getModel(memoryConfig.embedderApiClient?.model, memoryConfig.embedderApiClient?.provider) ||
      getFirstEmbeddingModel()

    if (!embedderModel) {
      logger.warn(
        'Memory processing skipped: no embedding model available. Please configure an embedding model in memory settings.'
      )
      return
    }

    if (!llmModel) {
      logger.warn('Memory processing skipped: LLM model not available')
      return
    }

    // Convert messages to the format expected by memory processor
    const conversationMessages = messages
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: getMainTextContent(msg) || ''
      }))
      .filter((msg) => msg.content.trim().length > 0)

    // if (conversationMessages.length < 2) {
    // Need at least a user message and assistant response
    // return
    // }

    const currentUserId = selectCurrentUserId(store.getState())

    // Create updated memory config with resolved models
    const updatedMemoryConfig = {
      ...memoryConfig,
      llmApiClient: {
        model: llmModel.id,
        provider: llmModel.provider,
        apiKey: getProviderByModel(llmModel).apiKey,
        baseURL: new AiProvider(getProviderByModel(llmModel)).getBaseURL(),
        apiVersion: getProviderByModel(llmModel).apiVersion
      },
      embedderApiClient: {
        model: embedderModel.id,
        provider: embedderModel.provider,
        apiKey: getProviderByModel(embedderModel).apiKey,
        baseURL: new AiProvider(getProviderByModel(embedderModel)).getBaseURL(),
        apiVersion: getProviderByModel(embedderModel).apiVersion
      }
    }

    const lastUserMessage = findLast(messages, (m) => m.role === 'user')
    const processorConfig = MemoryProcessor.getProcessorConfig(
      updatedMemoryConfig,
      assistant.id,
      currentUserId,
      lastUserMessage?.id
    )

    // Process the conversation in the background (don't await to avoid blocking UI)
    const memoryProcessor = new MemoryProcessor()
    memoryProcessor
      .processConversation(conversationMessages, processorConfig)
      .then((result) => {
        logger.debug('Memory processing completed:', result)
        if (result.facts.length > 0) {
          logger.debug('Extracted facts from conversation:', result.facts)
          logger.debug('Memory operations performed:', result.operations)
        } else {
          logger.debug('No facts extracted from conversation')
        }
      })
      .catch((error) => {
        logger.error('Background memory processing failed:', error as Error)
      })
  } catch (error) {
    logger.error('Error in post-conversation memory processing:', error as Error)
  }
}

export async function fetchMessagesSummary({ messages, assistant }: { messages: Message[]; assistant: Assistant }) {
  let prompt = (getStoreSetting('topicNamingPrompt') as string) || i18n.t('prompts.title')
  const model = getTopNamingModel() || assistant.model || getDefaultModel()

  if (prompt && containsSupportedVariables(prompt)) {
    prompt = await replacePromptVariables(prompt, model.name)
  }

  // 总结上下文总是取最后5条消息
  const contextMessages = takeRight(messages, 5)

  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    return null
  }

  const AI = new AiProvider(provider)

  const topicId = messages?.find((message) => message.topicId)?.topicId || undefined

  // LLM对多条消息的总结有问题，用单条结构化的消息表示会话内容会更好
  const structredMessages = contextMessages.map((message) => {
    const structredMessage = {
      role: message.role,
      mainText: getMainTextContent(message)
    }

    // 让LLM知道消息中包含的文件，但只提供文件名
    // 对助手消息而言，没有提供工具调用结果等更多信息，仅提供文本上下文。
    const fileBlocks = findFileBlocks(message)
    let fileList: Array<string> = []
    if (fileBlocks.length && fileBlocks.length > 0) {
      fileList = fileBlocks.map((fileBlock) => fileBlock.file.origin_name)
    }
    return {
      ...structredMessage,
      files: fileList.length > 0 ? fileList : undefined
    }
  })
  const conversation = JSON.stringify(structredMessages)

  // 复制 assistant 对象，并强制关闭思考预算
  const summaryAssistant = {
    ...assistant,
    settings: {
      ...assistant.settings,
      reasoning_effort: undefined,
      qwenThinkMode: false
    }
  }

  const params: CompletionsParams = {
    callType: 'summary',
    messages: conversation,
    assistant: { ...summaryAssistant, prompt, model },
    maxTokens: 1000,
    streamOutput: false,
    topicId,
    enableReasoning: false
  }

  try {
    const { getText } = await AI.completionsForTrace(params)
    const text = getText()
    return removeSpecialCharactersForTopicName(text) || null
  } catch (error: any) {
    return null
  }
}

export async function fetchSearchSummary({ messages, assistant }: { messages: Message[]; assistant: Assistant }) {
  const model = assistant.model || getDefaultModel()
  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    return null
  }

  const topicId = messages?.find((message) => message.topicId)?.topicId || undefined

  const AI = new AiProvider(provider)

  const params: CompletionsParams = {
    callType: 'search',
    messages: messages,
    assistant,
    streamOutput: false,
    topicId
  }

  return await AI.completionsForTrace(params)
}

export async function fetchGenerate({
  prompt,
  content,
  model
}: {
  prompt: string
  content: string
  model?: Model
}): Promise<string> {
  if (!model) {
    model = getDefaultModel()
  }
  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    return ''
  }

  const AI = new AiProvider(provider)

  const assistant = getDefaultAssistant()
  assistant.model = model
  assistant.prompt = prompt

  const params: CompletionsParams = {
    callType: 'generate',
    messages: content,
    assistant,
    streamOutput: false
  }

  try {
    const result = await AI.completions(params)
    return result.getText() || ''
  } catch (error: any) {
    return ''
  }
}

export function hasApiKey(provider: Provider) {
  if (!provider) return false
  if (provider.id === 'ollama' || provider.id === 'lmstudio' || provider.type === 'vertexai') return true
  return !isEmpty(provider.apiKey)
}

/**
 * Get the first available embedding model from enabled providers
 */
function getFirstEmbeddingModel() {
  const providers = store.getState().llm.providers.filter((p) => p.enabled)

  for (const provider of providers) {
    const embeddingModel = provider.models.find((model) => isEmbeddingModel(model))
    if (embeddingModel) {
      return embeddingModel
    }
  }

  return undefined
}

export async function fetchModels(provider: Provider): Promise<SdkModel[]> {
  const AI = new AiProvider(provider)

  try {
    return await AI.models()
  } catch (error) {
    return []
  }
}

export function checkApiProvider(provider: Provider): void {
  const key = 'api-check'
  const style = { marginTop: '3vh' }

  if (
    provider.id !== 'ollama' &&
    provider.id !== 'lmstudio' &&
    provider.type !== 'vertexai' &&
    provider.id !== 'copilot'
  ) {
    if (!provider.apiKey) {
      window.message.error({ content: i18n.t('message.error.enter.api.label'), key, style })
      throw new Error(i18n.t('message.error.enter.api.label'))
    }
  }

  if (!provider.apiHost && provider.type !== 'vertexai') {
    window.message.error({ content: i18n.t('message.error.enter.api.host'), key, style })
    throw new Error(i18n.t('message.error.enter.api.host'))
  }

  if (isEmpty(provider.models)) {
    window.message.error({ content: i18n.t('message.error.enter.model'), key, style })
    throw new Error(i18n.t('message.error.enter.model'))
  }
}

export async function checkApi(provider: Provider, model: Model, timeout = 15000): Promise<void> {
  checkApiProvider(provider)

  const controller = new AbortController()
  const abortFn = () => controller.abort()
  const taskId = uuid()
  addAbortController(taskId, abortFn)

  const ai = new AiProvider(provider)

  const assistant = getDefaultAssistant()
  assistant.model = model
  try {
    if (isEmbeddingModel(model)) {
      // race 超时 15s
      logger.silly("it's a embedding model")
      const timerPromise = new Promise((_, reject) => setTimeout(() => reject('Timeout'), timeout))
      await Promise.race([ai.getEmbeddingDimensions(model), timerPromise])
    } else {
      // 通过该状态判断abort原因
      let streamError: Error | undefined = undefined

      // 15s超时
      const timer = setTimeout(() => {
        abortCompletion(taskId)
        streamError = new Error('Timeout')
      }, timeout)

      const params: CompletionsParams = {
        callType: 'check',
        messages: 'hi',
        assistant,
        streamOutput: true,
        enableReasoning: false,
        onChunk: () => {
          // 接收到任意chunk都直接abort
          abortCompletion(taskId)
        },
        onError: (e) => {
          // 捕获stream error
          streamError = e
          abortCompletion(taskId)
        }
      }

      // Try streaming check first
      try {
        await createAbortPromise(controller.signal, ai.completions(params))
      } catch (e: any) {
        if (isAbortError(e)) {
          if (streamError) {
            throw streamError
          }
        } else {
          throw e
        }
      } finally {
        clearTimeout(timer)
      }
    }
  } catch (error: any) {
    // FIXME: 这种判断方法无法严格保证错误是流式引起的
    if (error.message.includes('stream')) {
      const params: CompletionsParams = {
        callType: 'check',
        messages: 'hi',
        assistant,
        streamOutput: false,
        shouldThrow: true
      }
      // 超时判断
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject('Timeout'), timeout))
      await Promise.race([ai.completions(params), timeoutPromise])
    } else {
      throw error
    }
  } finally {
    removeAbortController(taskId, abortFn)
  }
}

export async function checkModel(provider: Provider, model: Model, timeout = 15000): Promise<{ latency: number }> {
  const startTime = performance.now()
  await checkApi(provider, model, timeout)
  return { latency: performance.now() - startTime }
}
