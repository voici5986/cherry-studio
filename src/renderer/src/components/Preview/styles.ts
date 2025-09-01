import { Flex } from 'antd'
import { styled } from 'styled-components'

export const PreviewError = styled.div`
  overflow: auto;
  padding: 16px;
  color: #ff4d4f;
  border: 1px solid #ff4d4f;
  border-radius: 4px;
  word-wrap: break-word;
  white-space: pre-wrap;
`

export const PreviewContainer = styled(Flex).attrs({ role: 'alert' })`
  position: relative;
  /* Make sure the toolbar is visible */
  min-height: 8rem;

  .special-preview {
    min-height: 8rem;
  }

  .preview-toolbar {
    transition: opacity 0.3s ease-in-out;
    transform: translateZ(0);
    will-change: opacity;
    opacity: 0;
  }

  &:hover {
    .preview-toolbar {
      opacity: 1;
    }
  }
`

export const ShadowWhiteContainer = styled.div`
  --shadow-host-background-color: white;
  --shadow-host-border: 0.5px solid var(--color-code-background);
  --shadow-host-border-radius: 8px;
`

export const ShadowTransparentContainer = styled.div`
  --shadow-host-background-color: transparent;
  --shadow-host-border: unset;
  --shadow-host-border-radius: unset;
`
