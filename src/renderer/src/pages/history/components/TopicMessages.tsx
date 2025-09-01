import { MessageOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { MessageEditingProvider } from '@renderer/context/MessageEditingContext'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTimer } from '@renderer/hooks/useTimer'
import { getTopicById } from '@renderer/hooks/useTopic'
import { getAssistantById } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { isGenerating, locateToMessage } from '@renderer/services/MessagesService'
import NavigationService from '@renderer/services/NavigationService'
import { Topic } from '@renderer/types'
import { classNames, runAsyncFunction } from '@renderer/utils'
import { Button, Divider, Empty } from 'antd'
import { t } from 'i18next'
import { Forward } from 'lucide-react'
import { FC, useEffect, useState } from 'react'
import styled from 'styled-components'

import { default as MessageItem } from '../../home/Messages/Message'

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  topic?: Topic
}

const TopicMessages: FC<Props> = ({ topic: _topic, ...props }) => {
  const navigate = NavigationService.navigate!
  const { handleScroll, containerRef } = useScrollPosition('TopicMessages')
  const { messageStyle } = useSettings()
  const { setTimeoutTimer } = useTimer()

  const [topic, setTopic] = useState<Topic | undefined>(_topic)

  useEffect(() => {
    if (!_topic) return

    runAsyncFunction(async () => {
      const topic = await getTopicById(_topic.id)
      setTopic(topic)
    })
  }, [_topic, topic])

  const isEmpty = (topic?.messages || []).length === 0

  if (!topic) {
    return null
  }

  const onContinueChat = async (topic: Topic) => {
    await isGenerating()
    SearchPopup.hide()
    const assistant = getAssistantById(topic.assistantId)
    navigate('/', { state: { assistant, topic } })
    setTimeoutTimer('onContinueChat', () => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 100)
  }

  return (
    <MessageEditingProvider>
      <MessagesContainer {...props} ref={containerRef} onScroll={handleScroll}>
        <ContainerWrapper className={messageStyle}>
          {topic?.messages.map((message) => (
            <MessageWrapper key={message.id} className={classNames([messageStyle, message.role])}>
              <MessageItem message={message} topic={topic} hideMenuBar={true} />
              <Button
                type="text"
                size="middle"
                style={{ color: 'var(--color-text-3)', position: 'absolute', right: 0, top: 5 }}
                onClick={() => locateToMessage(navigate, message)}
                icon={<Forward size={16} />}
              />
              <Divider style={{ margin: '8px auto 15px' }} variant="dashed" />
            </MessageWrapper>
          ))}
          {isEmpty && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          {!isEmpty && (
            <HStack justifyContent="center">
              <Button onClick={() => onContinueChat(topic)} icon={<MessageOutlined />}>
                {t('history.continue_chat')}
              </Button>
            </HStack>
          )}
        </ContainerWrapper>
      </MessagesContainer>
    </MessageEditingProvider>
  )
}

const MessagesContainer = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow-y: scroll;
`

const ContainerWrapper = styled.div`
  width: 100%;
  padding: 16px;
  display: flex;
  flex-direction: column;
`

const MessageWrapper = styled.div`
  position: relative;
  &.bubble.user {
    padding-top: 26px;
  }
`

export default TopicMessages
