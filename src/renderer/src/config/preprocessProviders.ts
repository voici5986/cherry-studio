import Doc2xLogo from '@renderer/assets/images/ocr/doc2x.png'
import MinerULogo from '@renderer/assets/images/ocr/mineru.jpg'
import MistralLogo from '@renderer/assets/images/providers/mistral.png'
import { PreprocessProviderId } from '@renderer/types'

export function getPreprocessProviderLogo(providerId: PreprocessProviderId) {
  switch (providerId) {
    case 'doc2x':
      return Doc2xLogo
    case 'mistral':
      return MistralLogo
    case 'mineru':
      return MinerULogo
    default:
      return undefined
  }
}

type PreprocessProviderConfig = { websites: { official: string; apiKey: string } }

export const PREPROCESS_PROVIDER_CONFIG: Record<PreprocessProviderId, PreprocessProviderConfig> = {
  doc2x: {
    websites: {
      official: 'https://doc2x.noedgeai.com',
      apiKey: 'https://open.noedgeai.com/apiKeys'
    }
  },
  mistral: {
    websites: {
      official: 'https://mistral.ai',
      apiKey: 'https://mistral.ai/api-keys'
    }
  },
  mineru: {
    websites: {
      official: 'https://mineru.net/',
      apiKey: 'https://mineru.net/apiManage'
    }
  }
}
