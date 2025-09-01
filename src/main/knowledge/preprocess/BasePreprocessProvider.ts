import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { windowService } from '@main/services/WindowService'
import { getFileExt, getTempDir } from '@main/utils/file'
import { FileMetadata, PreprocessProvider } from '@types'
import { PDFDocument } from 'pdf-lib'

const logger = loggerService.withContext('BasePreprocessProvider')

export default abstract class BasePreprocessProvider {
  protected provider: PreprocessProvider
  protected userId?: string
  public storageDir = path.join(getTempDir(), 'preprocess')

  constructor(provider: PreprocessProvider, userId?: string) {
    if (!provider) {
      throw new Error('Preprocess provider is not set')
    }
    this.provider = provider
    this.userId = userId
    this.ensureDirectories()
  }

  private ensureDirectories() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true })
      }
    } catch (error) {
      logger.error('Failed to create directories:', error as Error)
    }
  }

  abstract parseFile(sourceId: string, file: FileMetadata): Promise<{ processedFile: FileMetadata; quota?: number }>

  abstract checkQuota(): Promise<number>

  /**
   * 检查文件是否已经被预处理过
   * 统一检测方法：如果 Data/Files/{file.id} 是目录，说明已被预处理
   * @param file 文件信息
   * @returns 如果已处理返回处理后的文件信息，否则返回null
   */
  public async checkIfAlreadyProcessed(file: FileMetadata): Promise<FileMetadata | null> {
    try {
      // 检查 Data/Files/{file.id} 是否是目录
      const preprocessDirPath = path.join(this.storageDir, file.id)

      if (fs.existsSync(preprocessDirPath)) {
        const stats = await fs.promises.stat(preprocessDirPath)

        // 如果是目录，说明已经被预处理过
        if (stats.isDirectory()) {
          // 查找目录中的处理结果文件
          const files = await fs.promises.readdir(preprocessDirPath)

          // 查找主要的处理结果文件（.md 或 .txt）
          const processedFile = files.find((fileName) => fileName.endsWith('.md') || fileName.endsWith('.txt'))

          if (processedFile) {
            const processedFilePath = path.join(preprocessDirPath, processedFile)
            const processedStats = await fs.promises.stat(processedFilePath)
            const ext = getFileExt(processedFile)

            return {
              ...file,
              name: file.name.replace(file.ext, ext),
              path: processedFilePath,
              ext: ext,
              size: processedStats.size,
              created_at: processedStats.birthtime.toISOString()
            }
          }
        }
      }

      return null
    } catch (error) {
      // 如果检查过程中出现错误，返回null表示未处理
      return null
    }
  }

  /**
   * 辅助方法：延迟执行
   */
  public delay = (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  public async readPdf(buffer: Buffer) {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true })
    return {
      numPages: pdfDoc.getPageCount()
    }
  }

  public async sendPreprocessProgress(sourceId: string, progress: number): Promise<void> {
    const mainWindow = windowService.getMainWindow()
    mainWindow?.webContents.send('file-preprocess-progress', {
      itemId: sourceId,
      progress: progress
    })
  }

  /**
   * 将文件移动到附件目录
   * @param fileId 文件id
   * @param filePaths 需要移动的文件路径数组
   * @returns 移动后的文件路径数组
   */
  public moveToAttachmentsDir(fileId: string, filePaths: string[]): string[] {
    const attachmentsPath = path.join(this.storageDir, fileId)
    if (!fs.existsSync(attachmentsPath)) {
      fs.mkdirSync(attachmentsPath, { recursive: true })
    }

    const movedPaths: string[] = []

    for (const filePath of filePaths) {
      if (fs.existsSync(filePath)) {
        const fileName = path.basename(filePath)
        const destPath = path.join(attachmentsPath, fileName)
        fs.copyFileSync(filePath, destPath)
        fs.unlinkSync(filePath) // 删除原文件，实现"移动"
        movedPaths.push(destPath)
      }
    }
    return movedPaths
  }
}
