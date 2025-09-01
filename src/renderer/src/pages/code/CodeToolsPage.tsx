import AiProvider from '@renderer/aiCore'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import ModelSelector from '@renderer/components/ModelSelector'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { useCodeTools } from '@renderer/hooks/useCodeTools'
import { useProviders } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import { getProviderByModel } from '@renderer/services/AssistantService'
import { loggerService } from '@renderer/services/LoggerService'
import { getModelUniqId } from '@renderer/services/ModelService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setIsBunInstalled } from '@renderer/store/mcp'
import { Model } from '@renderer/types'
import { Alert, Button, Checkbox, Input, Select, Space } from 'antd'
import { Download, Terminal, X } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS,
  CLI_TOOL_PROVIDER_MAP,
  CLI_TOOLS,
  generateToolEnvironment,
  parseEnvironmentVariables
} from '.'

const logger = loggerService.withContext('CodeToolsPage')

const CodeToolsPage: FC = () => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const dispatch = useAppDispatch()
  const isBunInstalled = useAppSelector((state) => state.mcp.isBunInstalled)
  const {
    selectedCliTool,
    selectedModel,
    environmentVariables,
    directories,
    currentDirectory,
    canLaunch,
    setCliTool,
    setModel,
    setEnvVars,
    setCurrentDir,
    removeDir,
    selectFolder
  } = useCodeTools()
  const { setTimeoutTimer } = useTimer()

  const [isLaunching, setIsLaunching] = useState(false)
  const [isInstallingBun, setIsInstallingBun] = useState(false)
  const [autoUpdateToLatest, setAutoUpdateToLatest] = useState(false)

  const modelPredicate = useCallback(
    (m: Model) => {
      if (isEmbeddingModel(m) || isRerankModel(m) || isTextToImageModel(m)) {
        return false
      }
      if (m.provider === 'cherryin') {
        return false
      }
      if (selectedCliTool === 'claude-code') {
        return m.id.includes('claude') || CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS.includes(m.provider)
      }
      if (selectedCliTool === 'gemini-cli') {
        return m.id.includes('gemini')
      }
      return true
    },
    [selectedCliTool]
  )

  const availableProviders = useMemo(() => {
    const filterFn = CLI_TOOL_PROVIDER_MAP[selectedCliTool]
    return filterFn ? filterFn(providers) : []
  }, [providers, selectedCliTool])

  const handleModelChange = (value: string) => {
    if (!value) {
      setModel(null)
      return
    }

    // 从所有 providers 中查找选中的模型
    for (const provider of providers || []) {
      const model = provider.models.find((m) => getModelUniqId(m) === value)
      if (model) {
        setModel(model)
        break
      }
    }
  }

  // 处理删除目录
  const handleRemoveDirectory = (directory: string, e: React.MouseEvent) => {
    e.stopPropagation()
    removeDir(directory)
  }

  // 检查 bun 是否安装
  const checkBunInstallation = useCallback(async () => {
    try {
      const bunExists = await window.api.isBinaryExist('bun')
      dispatch(setIsBunInstalled(bunExists))
    } catch (error) {
      logger.error('检查 bun 安装状态失败:', error as Error)
      dispatch(setIsBunInstalled(false))
    }
  }, [dispatch])

  // 安装 bun
  const handleInstallBun = async () => {
    try {
      setIsInstallingBun(true)
      await window.api.installBunBinary()
      dispatch(setIsBunInstalled(true))
      window.message.success({
        content: t('settings.mcp.installSuccess'),
        key: 'bun-install-message'
      })
    } catch (error: any) {
      logger.error('安装 bun 失败:', error as Error)
      window.message.error({
        content: `${t('settings.mcp.installError')}: ${error.message}`,
        key: 'bun-install-message'
      })
    } finally {
      setIsInstallingBun(false)
      // 重新检查安装状态
      setTimeoutTimer('handleInstallBun', checkBunInstallation, 1000)
    }
  }

  // 验证启动条件
  const validateLaunch = (): { isValid: boolean; message?: string } => {
    if (!canLaunch || !isBunInstalled) {
      return {
        isValid: false,
        message: !isBunInstalled ? t('code.launch.bun_required') : t('code.launch.validation_error')
      }
    }

    if (!selectedModel) {
      return { isValid: false, message: t('code.model_required') }
    }

    return { isValid: true }
  }

  // 准备启动环境
  const prepareLaunchEnvironment = async (): Promise<Record<string, string> | null> => {
    if (!selectedModel) return null

    const modelProvider = getProviderByModel(selectedModel)
    const aiProvider = new AiProvider(modelProvider)
    const baseUrl = await aiProvider.getBaseURL()
    const apiKey = await aiProvider.getApiKey()

    // 生成工具特定的环境变量
    const toolEnv = generateToolEnvironment({
      tool: selectedCliTool,
      model: selectedModel,
      modelProvider,
      apiKey,
      baseUrl
    })

    // 合并用户自定义的环境变量
    const userEnv = parseEnvironmentVariables(environmentVariables)

    return { ...toolEnv, ...userEnv }
  }

  // 执行启动操作
  const executeLaunch = async (env: Record<string, string>) => {
    window.api.codeTools.run(selectedCliTool, selectedModel?.id!, currentDirectory, env, { autoUpdateToLatest })
    window.message.success({ content: t('code.launch.success'), key: 'code-launch-message' })
  }

  // 处理启动
  const handleLaunch = async () => {
    const validation = validateLaunch()

    if (!validation.isValid) {
      window.message.warning({ content: validation.message, key: 'code-launch-message' })
      return
    }

    setIsLaunching(true)

    try {
      const env = await prepareLaunchEnvironment()
      if (!env) {
        window.message.error({ content: t('code.model_required'), key: 'code-launch-message' })
        return
      }

      await executeLaunch(env)
    } catch (error) {
      logger.error('启动失败:', error as Error)
      window.message.error({ content: t('code.launch.error'), key: 'code-launch-message' })
    } finally {
      setIsLaunching(false)
    }
  }

  // 页面加载时检查 bun 安装状态
  useEffect(() => {
    checkBunInstallation()
  }, [checkBunInstallation])

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('code.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <MainContent>
          <Title>{t('code.title')}</Title>
          <Description>{t('code.description')}</Description>

          {/* Bun 安装状态提示 */}
          {!isBunInstalled && (
            <BunInstallAlert>
              <Alert
                type="warning"
                banner
                style={{ borderRadius: 'var(--list-item-border-radius)' }}
                message={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{t('code.bun_required_message')}</span>
                    <Button
                      type="primary"
                      size="small"
                      icon={<Download size={14} />}
                      onClick={handleInstallBun}
                      loading={isInstallingBun}
                      disabled={isInstallingBun}>
                      {isInstallingBun ? t('code.installing_bun') : t('code.install_bun')}
                    </Button>
                  </div>
                }
              />
            </BunInstallAlert>
          )}

          <SettingsPanel>
            <SettingsItem>
              <div className="settings-label">{t('code.cli_tool')}</div>
              <Select
                style={{ width: '100%' }}
                placeholder={t('code.cli_tool_placeholder')}
                value={selectedCliTool}
                onChange={setCliTool}
                options={CLI_TOOLS}
              />
            </SettingsItem>

            <SettingsItem>
              <div className="settings-label">{t('code.model')}</div>
              <ModelSelector
                providers={availableProviders}
                predicate={modelPredicate}
                style={{ width: '100%' }}
                placeholder={t('code.model_placeholder')}
                value={selectedModel ? getModelUniqId(selectedModel) : undefined}
                onChange={handleModelChange}
                allowClear
              />
            </SettingsItem>

            <SettingsItem>
              <div className="settings-label">{t('code.working_directory')}</div>
              <Space.Compact style={{ width: '100%', display: 'flex' }}>
                <Select
                  style={{ flex: 1, width: 480 }}
                  placeholder={t('code.folder_placeholder')}
                  value={currentDirectory || undefined}
                  onChange={setCurrentDir}
                  allowClear
                  showSearch
                  filterOption={(input, option) => {
                    const label = typeof option?.label === 'string' ? option.label : String(option?.value || '')
                    return label.toLowerCase().includes(input.toLowerCase())
                  }}
                  options={directories.map((dir) => ({
                    value: dir,
                    label: (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{dir}</span>
                        <X
                          size={14}
                          style={{ marginLeft: 8, cursor: 'pointer', color: '#999' }}
                          onClick={(e) => handleRemoveDirectory(dir, e)}
                        />
                      </div>
                    )
                  }))}
                />
                <Button onClick={selectFolder} style={{ width: 120 }}>
                  {t('code.select_folder')}
                </Button>
              </Space.Compact>
            </SettingsItem>

            <SettingsItem>
              <div className="settings-label">{t('code.environment_variables')}</div>
              <Input.TextArea
                placeholder={`KEY1=value1\nKEY2=value2`}
                value={environmentVariables}
                onChange={(e) => setEnvVars(e.target.value)}
                rows={2}
                style={{ fontFamily: 'monospace' }}
              />
              <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginTop: 4 }}>{t('code.env_vars_help')}</div>
            </SettingsItem>

            <SettingsItem>
              <div className="settings-label">{t('code.update_options')}</div>
              <Checkbox checked={autoUpdateToLatest} onChange={(e) => setAutoUpdateToLatest(e.target.checked)}>
                {t('code.auto_update_to_latest')}
              </Checkbox>
            </SettingsItem>
          </SettingsPanel>

          <Button
            type="primary"
            icon={<Terminal size={16} />}
            size="large"
            onClick={handleLaunch}
            loading={isLaunching}
            disabled={!canLaunch || !isBunInstalled}
            block>
            {isLaunching ? t('code.launching') : t('code.launch.label')}
          </Button>
        </MainContent>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  overflow-y: auto;
  padding: 20px 0;
`

const MainContent = styled.div`
  width: 600px;
  margin: auto;
  min-height: fit-content;
`

const Title = styled.h1`
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--color-text-1);
`

const Description = styled.p`
  font-size: 14px;
  color: var(--color-text-2);
  margin-bottom: 32px;
  line-height: 1.5;
`

const SettingsPanel = styled.div`
  margin-bottom: 32px;
`

const SettingsItem = styled.div`
  margin-bottom: 24px;

  .settings-label {
    font-size: 14px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-1);
    font-weight: 500;
  }
`

const BunInstallAlert = styled.div`
  margin-bottom: 24px;
`

export default CodeToolsPage
