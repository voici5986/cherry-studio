import CherryLogo from '@renderer/assets/images/banner.png'
import Favicon from '@renderer/components/Icons/FallbackFavicon'
import { useMetaDataParser } from '@renderer/hooks/useMetaDataParser'
import { Skeleton, Typography } from 'antd'
import { useEffect, useMemo } from 'react'
import styled from 'styled-components'
const { Title, Paragraph } = Typography

type Props = {
  link: string
  show: boolean
}

export const OGCard = ({ link, show }: Props) => {
  const openGraph = ['og:title', 'og:description', 'og:image', 'og:imageAlt'] as const
  const { metadata, isLoading, parseMetadata } = useMetaDataParser(link, openGraph)

  const hasImage = !!metadata['og:image']

  const hostname = useMemo(() => {
    try {
      return new URL(link).hostname
    } catch {
      return null
    }
  }, [link])

  useEffect(() => {
    // use show to lazy loading
    if (show && isLoading) {
      parseMetadata()
    }
  }, [parseMetadata, isLoading, show])

  if (isLoading) {
    return <CardSkeleton />
  }

  return (
    <PreviewContainer hasImage={hasImage}>
      {hasImage && (
        <PreviewImageContainer>
          <PreviewImage src={metadata['og:image']} alt={metadata['og:imageAlt'] || link} />
        </PreviewImageContainer>
      )}
      {!hasImage && (
        <PreviewImageContainer>
          <PreviewImage src={CherryLogo} alt={'no image'} />
        </PreviewImageContainer>
      )}

      <PreviewContent>
        <StyledHyperLink>
          {hostname && <Favicon hostname={hostname} alt={link} />}
          <Title
            style={{
              margin: 0,
              fontSize: '14px',
              lineHeight: '1.2',
              color: 'var(--color-text)'
            }}>
            {metadata['og:title'] || hostname}
          </Title>
        </StyledHyperLink>
        <Paragraph
          title={metadata['og:description'] || link}
          ellipsis={{ rows: 2 }}
          style={{
            fontSize: '12px',
            lineHeight: '1.2',
            color: 'var(--color-text-secondary)'
          }}>
          {metadata['og:description'] || link}
        </Paragraph>
      </PreviewContent>
    </PreviewContainer>
  )
}

const CardSkeleton = () => {
  return (
    <SkeletonContainer>
      <Skeleton.Image style={{ width: '100%', height: 140 }} active />
      <Skeleton
        paragraph={{
          rows: 1,
          style: {
            margin: '8px 0'
          }
        }}
        active
      />
    </SkeletonContainer>
  )
}

const StyledHyperLink = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const PreviewContainer = styled.div<{ hasImage?: boolean }>`
  display: flex;
  flex-direction: column;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  width: 380px;
  height: 220px;
  overflow: hidden;
`

const PreviewImageContainer = styled.div`
  width: 100%;
  height: 140px;
  min-height: 140px;
  overflow: hidden;
`

const PreviewContent = styled.div`
  padding: 12px 16px;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
`

const PreviewImage = styled.img`
  width: 100%;
  height: 140px;
  object-fit: cover;
`

const SkeletonContainer = styled.div`
  width: 380px;
  height: 220px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  gap: 16px;
`
