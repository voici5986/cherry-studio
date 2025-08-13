import { useSettings } from '@renderer/hooks/useSettings'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { RootState } from '@renderer/store'
import { selectFormattedCitationsByBlockId } from '@renderer/store/messageBlock'
import { type Model } from '@renderer/types'
import type { MainTextMessageBlock, Message } from '@renderer/types/newMessage'
import { determineCitationSource, withCitationTags } from '@renderer/utils/citation'
import { Flex } from 'antd'
import React, { useCallback } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'

interface Props {
  block: MainTextMessageBlock
  citationBlockId?: string
  mentions?: Model[]
  role: Message['role']
}

const MainTextBlock: React.FC<Props> = ({ block, citationBlockId, role, mentions = [] }) => {
  // Use the passed citationBlockId directly in the selector
  const { renderInputMessageAsMarkdown } = useSettings()

  const rawCitations = useSelector((state: RootState) => selectFormattedCitationsByBlockId(state, citationBlockId))

  // 创建引用处理函数，传递给 Markdown 组件在流式渲染中使用
  const processContent = useCallback(
    (rawText: string) => {
      if (!block.citationReferences?.length || !citationBlockId || rawCitations.length === 0) {
        return rawText
      }

      // 确定最适合的 source
      const sourceType = determineCitationSource(block.citationReferences)

      return withCitationTags(rawText, rawCitations, sourceType)
    },
    [block.citationReferences, citationBlockId, rawCitations]
  )

  return (
    <>
      {/* Render mentions associated with the message */}
      {mentions && mentions.length > 0 && (
        <Flex gap="8px" wrap style={{ marginBottom: 10 }}>
          {mentions.map((m) => (
            <MentionTag key={getModelUniqId(m)}>{'@' + m.name}</MentionTag>
          ))}
        </Flex>
      )}
      {role === 'user' && !renderInputMessageAsMarkdown ? (
        <p className="markdown" style={{ whiteSpace: 'pre-wrap' }}>
          {block.content}
        </p>
      ) : (
        <Markdown block={block} postProcess={processContent} />
      )}
    </>
  )
}

const MentionTag = styled.span`
  color: var(--color-link);
`

export default React.memo(MainTextBlock)
