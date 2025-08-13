import { GlobalOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import ModelSettings from '@renderer/pages/settings/ModelSettings/ModelSettings'
import { Divider as AntDivider } from 'antd'
import {
  Brain,
  Cloud,
  Command,
  FileCode,
  HardDrive,
  Info,
  MonitorCog,
  Package,
  PictureInPicture2,
  Settings2,
  SquareTerminal,
  TextCursorInput,
  Zap
} from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import styled from 'styled-components'

import AboutSettings from './AboutSettings'
import DataSettings from './DataSettings/DataSettings'
import DisplaySettings from './DisplaySettings/DisplaySettings'
import GeneralSettings from './GeneralSettings'
import MCPSettings from './MCPSettings'
import MemorySettings from './MemorySettings'
import PreprocessSettings from './PreprocessSettings'
import ProvidersList from './ProviderSettings'
import QuickAssistantSettings from './QuickAssistantSettings'
import QuickPhraseSettings from './QuickPhraseSettings'
import SelectionAssistantSettings from './SelectionAssistantSettings/SelectionAssistantSettings'
import ShortcutSettings from './ShortcutSettings'
import WebSearchSettings from './WebSearchSettings'

const SettingsPage: FC = () => {
  const { pathname } = useLocation()
  const { t } = useTranslation()

  const isRoute = (path: string): string => (pathname.startsWith(path) ? 'active' : '')

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('settings.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <SettingMenus>
          <MenuItemLink to="/settings/provider">
            <MenuItem className={isRoute('/settings/provider')}>
              <Cloud size={18} />
              {t('settings.provider.title')}
            </MenuItem>
          </MenuItemLink>
          <MenuItemLink to="/settings/model">
            <MenuItem className={isRoute('/settings/model')}>
              <Package size={18} />
              {t('settings.model')}
            </MenuItem>
          </MenuItemLink>
          <Divider />
          <MenuItemLink to="/settings/general">
            <MenuItem className={isRoute('/settings/general')}>
              <Settings2 size={18} />
              {t('settings.general.label')}
            </MenuItem>
          </MenuItemLink>
          <MenuItemLink to="/settings/display">
            <MenuItem className={isRoute('/settings/display')}>
              <MonitorCog size={18} />
              {t('settings.display.title')}
            </MenuItem>
          </MenuItemLink>
          <MenuItemLink to="/settings/data">
            <MenuItem className={isRoute('/settings/data')}>
              <HardDrive size={18} />
              {t('settings.data.title')}
            </MenuItem>
          </MenuItemLink>
          <Divider />
          <MenuItemLink to="/settings/mcp">
            <MenuItem className={isRoute('/settings/mcp')}>
              <SquareTerminal size={18} />
              {t('settings.mcp.title')}
            </MenuItem>
          </MenuItemLink>
          <MenuItemLink to="/settings/websearch">
            <MenuItem className={isRoute('/settings/websearch')}>
              <GlobalOutlined style={{ fontSize: 18 }} />
              {t('settings.tool.websearch.title')}
            </MenuItem>
          </MenuItemLink>
          <MenuItemLink to="/settings/memory">
            <MenuItem className={isRoute('/settings/memory')}>
              <Brain size={18} />
              {t('memory.title')}
            </MenuItem>
          </MenuItemLink>
          <MenuItemLink to="/settings/preprocess">
            <MenuItem className={isRoute('/settings/preprocess')}>
              <FileCode size={18} />
              {t('settings.tool.preprocess.title')}
            </MenuItem>
          </MenuItemLink>
          <MenuItemLink to="/settings/quickphrase">
            <MenuItem className={isRoute('/settings/quickphrase')}>
              <Zap size={18} />
              {t('settings.quickPhrase.title')}
            </MenuItem>
          </MenuItemLink>
          <MenuItemLink to="/settings/shortcut">
            <MenuItem className={isRoute('/settings/shortcut')}>
              <Command size={18} />
              {t('settings.shortcuts.title')}
            </MenuItem>
          </MenuItemLink>
          <Divider />
          <MenuItemLink to="/settings/quickAssistant">
            <MenuItem className={isRoute('/settings/quickAssistant')}>
              <PictureInPicture2 size={18} />
              {t('settings.quickAssistant.title')}
            </MenuItem>
          </MenuItemLink>
          <MenuItemLink to="/settings/selectionAssistant">
            <MenuItem className={isRoute('/settings/selectionAssistant')}>
              <TextCursorInput size={18} />
              {t('selection.name')}
            </MenuItem>
          </MenuItemLink>
          <Divider />
          <MenuItemLink to="/settings/about">
            <MenuItem className={isRoute('/settings/about')}>
              <Info size={18} />
              {t('settings.about.label')}
            </MenuItem>
          </MenuItemLink>
        </SettingMenus>
        <SettingContent>
          <Routes>
            <Route path="provider" element={<ProvidersList />} />
            <Route path="model" element={<ModelSettings />} />
            <Route path="websearch" element={<WebSearchSettings />} />
            <Route path="preprocess" element={<PreprocessSettings />} />
            <Route path="quickphrase" element={<QuickPhraseSettings />} />
            <Route path="mcp/*" element={<MCPSettings />} />
            <Route path="memory" element={<MemorySettings />} />
            <Route path="general/*" element={<GeneralSettings />} />
            <Route path="display" element={<DisplaySettings />} />
            <Route path="shortcut" element={<ShortcutSettings />} />
            <Route path="quickAssistant" element={<QuickAssistantSettings />} />
            <Route path="selectionAssistant" element={<SelectionAssistantSettings />} />
            <Route path="data" element={<DataSettings />} />
            <Route path="about" element={<AboutSettings />} />
          </Routes>
        </SettingContent>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  height: calc(100vh - var(--navbar-height));
  padding: 1px 0;
`

const SettingMenus = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  min-width: var(--settings-width);
  border-right: 0.5px solid var(--color-border);
  padding: 10px;
  user-select: none;
  gap: 5px;
`

const MenuItemLink = styled(Link)`
  text-decoration: none;
  color: var(--color-text-1);
`

const MenuItem = styled.li`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  width: 100%;
  cursor: pointer;
  border-radius: var(--list-item-border-radius);
  font-weight: 500;
  transition: all 0.2s ease-in-out;
  border: 0.5px solid transparent;
  .anticon {
    font-size: 16px;
    opacity: 0.8;
  }
  &:hover {
    background: var(--color-background-soft);
  }
  &.active {
    background: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
  }
`

const SettingContent = styled.div`
  display: flex;
  height: 100%;
  flex: 1;
`

const Divider = styled(AntDivider)`
  margin: 3px 0;
`

export default SettingsPage
