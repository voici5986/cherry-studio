import { loggerService } from '@logger'
import * as OcrService from '@renderer/services/ocr/OcrService'
import { ImageFileMetadata, isImageFileMetadata, SupportedOcrFile } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { formatErrorMessage } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useOcrProviders } from './useOcrProvider'

const logger = loggerService.withContext('useOcr')

export const useOcr = () => {
  const { t } = useTranslation()
  const { imageProvider } = useOcrProviders()

  /**
   * 对图片文件进行OCR识别
   * @param image 图片文件元数据
   * @returns OCR识别结果的Promise
   * @throws OCR失败时抛出错误
   */
  const ocrImage = useCallback(
    async (image: ImageFileMetadata) => {
      logger.debug('ocrImage', { config: imageProvider.config })
      return OcrService.ocr(image, imageProvider)
    },
    [imageProvider]
  )

  /**
   * 对支持的文件进行OCR识别.
   * @param file 支持OCR的文件
   * @returns OCR识别结果的Promise
   * @throws 当文件类型不支持或OCR失败时抛出错误
   */
  const ocr = async (file: SupportedOcrFile) => {
    const key = uuid()
    window.message.loading({ content: t('ocr.processing'), key, duration: 0 })
    // await to keep show loading message
    try {
      if (isImageFileMetadata(file)) {
        return await ocrImage(file)
      } else {
        // @ts-expect-error all types should be covered
        throw new Error(t('ocr.file.not_supported', { type: file.type }))
      }
    } catch (e) {
      logger.error('Failed to ocr.', e as Error)
      window.message.error(t('ocr.error.unknown') + ': ' + formatErrorMessage(e))
      throw e
    } finally {
      window.message.destroy(key)
    }
  }

  return {
    ocr
  }
}
