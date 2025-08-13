import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { FileTypes } from '@types'
import chardet from 'chardet'
import iconv from 'iconv-lite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readTextFileWithAutoEncoding } from '../file'
import {
  getAllFiles,
  getAppConfigDir,
  getConfigDir,
  getFilesDir,
  getFileType,
  getTempDir,
  isPathInside,
  untildify
} from '../file'

// Mock dependencies
vi.mock('node:fs')
vi.mock('node:fs/promises')
vi.mock('node:os')
vi.mock('node:path')
vi.mock('uuid', () => ({
  v4: () => 'mock-uuid'
}))
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key) => {
      if (key === 'temp') return '/mock/temp'
      if (key === 'userData') return '/mock/userData'
      return '/mock/unknown'
    })
  }
}))

describe('file', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock path.extname
    vi.mocked(path.extname).mockImplementation((file) => {
      const parts = file.split('.')
      return parts.length > 1 ? `.${parts[parts.length - 1]}` : ''
    })

    // Mock path.basename
    vi.mocked(path.basename).mockImplementation((file) => {
      const parts = file.split('/')
      return parts[parts.length - 1]
    })

    // Mock path.join
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'))

    // Mock os.homedir
    vi.mocked(os.homedir).mockReturnValue('/mock/home')
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('getFileType', () => {
    it('should return IMAGE for image extensions', () => {
      expect(getFileType('.jpg')).toBe(FileTypes.IMAGE)
      expect(getFileType('.jpeg')).toBe(FileTypes.IMAGE)
      expect(getFileType('.png')).toBe(FileTypes.IMAGE)
      expect(getFileType('.gif')).toBe(FileTypes.IMAGE)
      expect(getFileType('.webp')).toBe(FileTypes.IMAGE)
      expect(getFileType('.bmp')).toBe(FileTypes.IMAGE)
    })

    it('should return VIDEO for video extensions', () => {
      expect(getFileType('.mp4')).toBe(FileTypes.VIDEO)
      expect(getFileType('.avi')).toBe(FileTypes.VIDEO)
      expect(getFileType('.mov')).toBe(FileTypes.VIDEO)
      expect(getFileType('.mkv')).toBe(FileTypes.VIDEO)
      expect(getFileType('.flv')).toBe(FileTypes.VIDEO)
    })

    it('should return AUDIO for audio extensions', () => {
      expect(getFileType('.mp3')).toBe(FileTypes.AUDIO)
      expect(getFileType('.wav')).toBe(FileTypes.AUDIO)
      expect(getFileType('.ogg')).toBe(FileTypes.AUDIO)
      expect(getFileType('.flac')).toBe(FileTypes.AUDIO)
      expect(getFileType('.aac')).toBe(FileTypes.AUDIO)
    })

    it('should return TEXT for text extensions', () => {
      expect(getFileType('.txt')).toBe(FileTypes.TEXT)
      expect(getFileType('.md')).toBe(FileTypes.TEXT)
      expect(getFileType('.html')).toBe(FileTypes.TEXT)
      expect(getFileType('.json')).toBe(FileTypes.TEXT)
      expect(getFileType('.js')).toBe(FileTypes.TEXT)
      expect(getFileType('.ts')).toBe(FileTypes.TEXT)
      expect(getFileType('.css')).toBe(FileTypes.TEXT)
      expect(getFileType('.java')).toBe(FileTypes.TEXT)
      expect(getFileType('.py')).toBe(FileTypes.TEXT)
    })

    it('should return DOCUMENT for document extensions', () => {
      expect(getFileType('.pdf')).toBe(FileTypes.DOCUMENT)
      expect(getFileType('.pptx')).toBe(FileTypes.DOCUMENT)
      expect(getFileType('.doc')).toBe(FileTypes.DOCUMENT)
      expect(getFileType('.docx')).toBe(FileTypes.DOCUMENT)
      expect(getFileType('.xlsx')).toBe(FileTypes.DOCUMENT)
      expect(getFileType('.odt')).toBe(FileTypes.DOCUMENT)
    })

    it('should return OTHER for unknown extensions', () => {
      expect(getFileType('.unknown')).toBe(FileTypes.OTHER)
      expect(getFileType('')).toBe(FileTypes.OTHER)
      expect(getFileType('.')).toBe(FileTypes.OTHER)
      expect(getFileType('...')).toBe(FileTypes.OTHER)
      expect(getFileType('.123')).toBe(FileTypes.OTHER)
    })

    it('should handle case-insensitive extensions', () => {
      expect(getFileType('.JPG')).toBe(FileTypes.IMAGE)
      expect(getFileType('.PDF')).toBe(FileTypes.DOCUMENT)
      expect(getFileType('.Mp3')).toBe(FileTypes.AUDIO)
      expect(getFileType('.HtMl')).toBe(FileTypes.TEXT)
      expect(getFileType('.Xlsx')).toBe(FileTypes.DOCUMENT)
    })

    it('should handle extensions without leading dot', () => {
      expect(getFileType('jpg')).toBe(FileTypes.OTHER)
      expect(getFileType('pdf')).toBe(FileTypes.OTHER)
      expect(getFileType('mp3')).toBe(FileTypes.OTHER)
    })

    it('should handle extreme cases', () => {
      expect(getFileType('.averylongfileextensionname')).toBe(FileTypes.OTHER)
      expect(getFileType('.tar.gz')).toBe(FileTypes.OTHER)
      expect(getFileType('.文件')).toBe(FileTypes.OTHER)
      expect(getFileType('.файл')).toBe(FileTypes.OTHER)
    })
  })

  describe('getAllFiles', () => {
    it('should return all valid files recursively', () => {
      // Mock file system
      // @ts-ignore - override type for testing
      vi.spyOn(fs, 'readdirSync').mockImplementation((dirPath) => {
        if (dirPath === '/test') {
          return ['file1.txt', 'file2.pdf', 'subdir']
        } else if (dirPath === '/test/subdir') {
          return ['file3.md', 'file4.docx']
        }
        return []
      })

      vi.mocked(fs.statSync).mockImplementation((filePath) => {
        const isDir = String(filePath).endsWith('subdir')
        return {
          isDirectory: () => isDir,
          size: 1024
        } as fs.Stats
      })

      const result = getAllFiles('/test')

      expect(result).toHaveLength(4)
      expect(result[0].id).toBe('mock-uuid')
      expect(result[0].name).toBe('file1.txt')
      expect(result[0].type).toBe(FileTypes.TEXT)
      expect(result[1].name).toBe('file2.pdf')
      expect(result[1].type).toBe(FileTypes.DOCUMENT)
    })

    it('should skip hidden files', () => {
      // @ts-ignore - override type for testing
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['.hidden', 'visible.txt'])
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
        size: 1024
      } as fs.Stats)

      const result = getAllFiles('/test')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('visible.txt')
    })

    it('should skip unsupported file types', () => {
      // @ts-ignore - override type for testing
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['image.jpg', 'video.mp4', 'audio.mp3', 'document.pdf'])
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
        size: 1024
      } as fs.Stats)

      const result = getAllFiles('/test')

      // Should only include document.pdf as the others are excluded types
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('document.pdf')
      expect(result[0].type).toBe(FileTypes.DOCUMENT)
    })

    it('should return empty array for empty directory', () => {
      // @ts-ignore - override type for testing
      vi.spyOn(fs, 'readdirSync').mockReturnValue([])

      const result = getAllFiles('/empty')

      expect(result).toHaveLength(0)
    })

    it('should handle file system errors', () => {
      // @ts-ignore - override type for testing
      vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
        throw new Error('Directory not found')
      })

      // Since the function doesn't have error handling, we expect it to propagate
      expect(() => getAllFiles('/nonexistent')).toThrow('Directory not found')
    })
  })

  describe('getTempDir', () => {
    it('should return correct temp directory path', () => {
      const tempDir = getTempDir()
      expect(tempDir).toBe('/mock/temp/CherryStudio')
    })
  })

  describe('getFilesDir', () => {
    it('should return correct files directory path', () => {
      const filesDir = getFilesDir()
      expect(filesDir).toBe('/mock/userData/Data/Files')
    })
  })

  describe('getConfigDir', () => {
    it('should return correct config directory path', () => {
      const configDir = getConfigDir()
      expect(configDir).toBe('/mock/home/.cherrystudio/config')
    })
  })

  describe('getAppConfigDir', () => {
    it('should return correct app config directory path', () => {
      const appConfigDir = getAppConfigDir('test-app')
      expect(appConfigDir).toBe('/mock/home/.cherrystudio/config/test-app')
    })

    it('should handle empty app name', () => {
      const appConfigDir = getAppConfigDir('')
      expect(appConfigDir).toBe('/mock/home/.cherrystudio/config/')
    })
  })

  describe('readTextFileWithAutoEncoding', () => {
    const mockFilePath = '/path/to/mock/file.txt'

    it('should read file with auto encoding', async () => {
      const content = '这是一段GB18030编码的测试内容'
      const buffer = iconv.encode(content, 'GB18030')

      // 模拟文件读取和编码检测
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue(buffer)
      vi.spyOn(chardet, 'detectFile').mockResolvedValue('GB18030')

      const result = await readTextFileWithAutoEncoding(mockFilePath)
      expect(result).toBe(content)
    })

    it('should try to fix bad detected encoding', async () => {
      const content = '这是一段UTF-8编码的测试内容'
      const buffer = iconv.encode(content, 'UTF-8')

      // 模拟文件读取
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue(buffer)
      vi.spyOn(chardet, 'detectFile').mockResolvedValue('GB18030')

      const result = await readTextFileWithAutoEncoding(mockFilePath)
      expect(result).toBe(content)
    })
  })

  describe('untildify', () => {
    it('should replace ~ with home directory for paths starting with ~', () => {
      const mockHome = '/mock/home'

      expect(untildify('~')).toBe(mockHome)
      expect(untildify('~/Documents')).toBe('/mock/home/Documents')
      expect(untildify('~\\Documents')).toBe('/mock/home\\Documents')
      expect(untildify('~/Documents/file.txt')).toBe('/mock/home/Documents/file.txt')
      expect(untildify('~\\Documents\\file.txt')).toBe('/mock/home\\Documents\\file.txt')
    })

    it('should not replace ~ when not at the beginning', () => {
      expect(untildify('folder/~/file')).toBe('folder/~/file')
      expect(untildify('/home/user/~')).toBe('/home/user/~')
      expect(untildify('Documents/~backup')).toBe('Documents/~backup')
    })

    it('should not replace ~ when not followed by path separator or end of string', () => {
      expect(untildify('~abc')).toBe('~abc')
      expect(untildify('~user')).toBe('~user')
      expect(untildify('~file.txt')).toBe('~file.txt')
    })

    it('should handle paths that do not start with ~', () => {
      expect(untildify('/absolute/path')).toBe('/absolute/path')
      expect(untildify('./relative/path')).toBe('./relative/path')
      expect(untildify('../parent/path')).toBe('../parent/path')
      expect(untildify('relative/path')).toBe('relative/path')
      expect(untildify('C:\\Windows\\System32')).toBe('C:\\Windows\\System32')
    })

    it('should handle edge cases', () => {
      expect(untildify('')).toBe('')
      expect(untildify(' ')).toBe(' ')
      expect(untildify('~/')).toBe('/mock/home/')
      expect(untildify('~\\')).toBe('/mock/home\\')
    })

    it('should handle special characters and unicode', () => {
      expect(untildify('~/文档')).toBe('/mock/home/文档')
      expect(untildify('~/папка')).toBe('/mock/home/папка')
      expect(untildify('~/folder with spaces')).toBe('/mock/home/folder with spaces')
      expect(untildify('~/folder-with-dashes')).toBe('/mock/home/folder-with-dashes')
      expect(untildify('~/folder_with_underscores')).toBe('/mock/home/folder_with_underscores')
    })
  })

  describe('isPathInside', () => {
    beforeEach(() => {
      // Mock path.resolve to simulate path resolution
      vi.mocked(path.resolve).mockImplementation((...args) => {
        const joined = args.join('/')
        return joined.startsWith('/') ? joined : `/${joined}`
      })

      // Mock path.normalize to simulate path normalization
      vi.mocked(path.normalize).mockImplementation((p) => p.replace(/\/+/g, '/'))

      // Mock path.relative to calculate relative paths
      vi.mocked(path.relative).mockImplementation((from, to) => {
        // Simple mock implementation for testing
        const fromParts = from.split('/').filter((p) => p)
        const toParts = to.split('/').filter((p) => p)

        // Find common prefix
        let i = 0
        while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
          i++
        }

        // Calculate relative path
        const upLevels = fromParts.length - i
        const downPath = toParts.slice(i)

        if (upLevels === 0 && downPath.length === 0) {
          return ''
        }

        const result = ['..'.repeat(upLevels), ...downPath].filter((p) => p).join('/')
        return result || '.'
      })

      // Mock path.isAbsolute
      vi.mocked(path.isAbsolute).mockImplementation((p) => p.startsWith('/'))
    })

    describe('basic parent-child relationships', () => {
      it('should return true when child is inside parent', () => {
        expect(isPathInside('/root/test/child', '/root/test')).toBe(true)
        expect(isPathInside('/root/test/deep/child', '/root/test')).toBe(true)
        expect(isPathInside('child/deep', 'child')).toBe(true)
      })

      it('should return false when child is not inside parent', () => {
        expect(isPathInside('/root/test', '/root/test/child')).toBe(false)
        expect(isPathInside('/root/other', '/root/test')).toBe(false)
        expect(isPathInside('/different/path', '/root/test')).toBe(false)
        expect(isPathInside('child', 'child/deep')).toBe(false)
      })

      it('should return true when paths are the same', () => {
        expect(isPathInside('/root/test', '/root/test')).toBe(true)
        expect(isPathInside('child', 'child')).toBe(true)
      })
    })

    describe('edge cases that startsWith cannot handle', () => {
      it('should correctly distinguish similar path names', () => {
        // The problematic case mentioned by user
        expect(isPathInside('/root/test aaa', '/root/test')).toBe(false)
        expect(isPathInside('/root/test', '/root/test aaa')).toBe(false)

        // More similar cases
        expect(isPathInside('/home/user-data', '/home/user')).toBe(false)
        expect(isPathInside('/home/user', '/home/user-data')).toBe(false)
        expect(isPathInside('/var/log-backup', '/var/log')).toBe(false)
      })

      it('should handle paths with spaces correctly', () => {
        expect(isPathInside('/path with spaces/child', '/path with spaces')).toBe(true)
        expect(isPathInside('/path with spaces', '/path with spaces/child')).toBe(false)
      })

      it('should handle Windows-style paths', () => {
        // Mock for Windows paths
        vi.mocked(path.resolve).mockImplementation((...args) => {
          const joined = args.join('\\').replace(/\//g, '\\')
          return joined.match(/^[A-Z]:/) ? joined : `C:${joined}`
        })

        vi.mocked(path.normalize).mockImplementation((p) => p.replace(/\\+/g, '\\'))

        // Mock path.relative for Windows paths
        vi.mocked(path.relative).mockImplementation((from, to) => {
          const fromParts = from.split('\\').filter((p) => p && p !== 'C:')
          const toParts = to.split('\\').filter((p) => p && p !== 'C:')

          // Find common prefix
          let i = 0
          while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
            i++
          }

          // Calculate relative path
          const upLevels = fromParts.length - i
          const downPath = toParts.slice(i)

          if (upLevels === 0 && downPath.length === 0) {
            return ''
          }

          const upPath = Array(upLevels).fill('..').join('\\')
          const result = [upPath, ...downPath].filter((p) => p).join('\\')
          return result || '.'
        })

        expect(isPathInside('C:\\Users\\test\\child', 'C:\\Users\\test')).toBe(true)
        expect(isPathInside('C:\\Users\\test aaa', 'C:\\Users\\test')).toBe(false)
      })
    })

    describe('error handling', () => {
      it('should return false when path operations throw errors', () => {
        vi.mocked(path.resolve).mockImplementation(() => {
          throw new Error('Path resolution failed')
        })

        expect(isPathInside('/any/path', '/any/parent')).toBe(false)
      })
    })

    describe('comparison with startsWith behavior', () => {
      const testCases: [string, string, boolean, boolean][] = [
        ['/root/test aaa', '/root/test', false, true], // isPathInside vs startsWith
        ['/root/test', '/root/test aaa', false, false],
        ['/root/test/child', '/root/test', true, true],
        ['/home/user-data', '/home/user', false, true]
      ]

      it.each(testCases)(
        'should correctly handle %s vs %s',
        (child: string, parent: string, expectedIsPathInside: boolean, expectedStartsWith: boolean) => {
          const isPathInsideResult = isPathInside(child, parent)
          const startsWithResult = child.startsWith(parent)

          expect(isPathInsideResult).toBe(expectedIsPathInside)
          expect(startsWithResult).toBe(expectedStartsWith)

          // Verify that isPathInside gives different (correct) result in problematic cases
          if (expectedIsPathInside !== expectedStartsWith) {
            expect(isPathInsideResult).not.toBe(startsWithResult)
          }
        }
      )
    })
  })
})
