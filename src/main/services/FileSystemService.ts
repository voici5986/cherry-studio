import { readTextFileWithAutoEncoding } from '@main/utils/file'
import { TraceMethod } from '@mcp-trace/trace-core'
import fs from 'fs/promises'

export default class FileService {
  @TraceMethod({ spanName: 'readFile', tag: 'FileService' })
  public static async readFile(_: Electron.IpcMainInvokeEvent, pathOrUrl: string, encoding?: BufferEncoding) {
    const path = pathOrUrl.startsWith('file://') ? new URL(pathOrUrl) : pathOrUrl
    if (encoding) return fs.readFile(path, { encoding })
    return fs.readFile(path)
  }

  /**
   * 自动识别编码，读取文本文件
   * @param _ event
   * @param pathOrUrl
   * @throws 路径不存在时抛出错误
   */
  @TraceMethod({ spanName: 'readTextFileWithAutoEncoding', tag: 'FileService' })
  public static async readTextFileWithAutoEncoding(_: Electron.IpcMainInvokeEvent, path: string): Promise<string> {
    return readTextFileWithAutoEncoding(path)
  }
}
