import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import { removeEnvProxy } from '@main/utils'
import { isUserInChina } from '@main/utils/ipService'
import { getBinaryName } from '@main/utils/process'
import { spawn } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(require('child_process').exec)
const logger = loggerService.withContext('CodeToolsService')

interface VersionInfo {
  installed: string | null
  latest: string | null
  needsUpdate: boolean
}

class CodeToolsService {
  private versionCache: Map<string, { version: string; timestamp: number }> = new Map()
  private readonly CACHE_DURATION = 1000 * 60 * 30 // 30 minutes cache

  constructor() {
    this.getBunPath = this.getBunPath.bind(this)
    this.getPackageName = this.getPackageName.bind(this)
    this.getCliExecutableName = this.getCliExecutableName.bind(this)
    this.isPackageInstalled = this.isPackageInstalled.bind(this)
    this.getVersionInfo = this.getVersionInfo.bind(this)
    this.updatePackage = this.updatePackage.bind(this)
    this.run = this.run.bind(this)
  }

  public async getBunPath() {
    const dir = path.join(os.homedir(), '.cherrystudio', 'bin')
    const bunName = await getBinaryName('bun')
    const bunPath = path.join(dir, bunName)
    return bunPath
  }

  public async getPackageName(cliTool: string) {
    if (cliTool === 'claude-code') {
      return '@anthropic-ai/claude-code'
    }
    if (cliTool === 'gemini-cli') {
      return '@google/gemini-cli'
    }
    return '@qwen-code/qwen-code'
  }

  public async getCliExecutableName(cliTool: string) {
    if (cliTool === 'claude-code') {
      return 'claude'
    }
    if (cliTool === 'gemini-cli') {
      return 'gemini'
    }
    return 'qwen'
  }

  private async isPackageInstalled(cliTool: string): Promise<boolean> {
    const executableName = await this.getCliExecutableName(cliTool)
    const binDir = path.join(os.homedir(), '.cherrystudio', 'bin')
    const executablePath = path.join(binDir, executableName + (process.platform === 'win32' ? '.exe' : ''))

    // Ensure bin directory exists
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true })
    }

    return fs.existsSync(executablePath)
  }

  /**
   * Get version information for a CLI tool
   */
  public async getVersionInfo(cliTool: string): Promise<VersionInfo> {
    logger.info(`Starting version check for ${cliTool}`)
    const packageName = await this.getPackageName(cliTool)
    const isInstalled = await this.isPackageInstalled(cliTool)

    let installedVersion: string | null = null
    let latestVersion: string | null = null

    // Get installed version if package is installed
    if (isInstalled) {
      logger.info(`${cliTool} is installed, getting current version`)
      try {
        const executableName = await this.getCliExecutableName(cliTool)
        const binDir = path.join(os.homedir(), '.cherrystudio', 'bin')
        const executablePath = path.join(binDir, executableName + (process.platform === 'win32' ? '.exe' : ''))

        const { stdout } = await execAsync(`"${executablePath}" --version`, { timeout: 10000 })
        // Extract version number from output (format may vary by tool)
        const versionMatch = stdout.trim().match(/\d+\.\d+\.\d+/)
        installedVersion = versionMatch ? versionMatch[0] : stdout.trim().split(' ')[0]
        logger.info(`${cliTool} current installed version: ${installedVersion}`)
      } catch (error) {
        logger.warn(`Failed to get installed version for ${cliTool}:`, error as Error)
      }
    } else {
      logger.info(`${cliTool} is not installed`)
    }

    // Get latest version from npm (with cache)
    const cacheKey = `${packageName}-latest`
    const cached = this.versionCache.get(cacheKey)
    const now = Date.now()

    if (cached && now - cached.timestamp < this.CACHE_DURATION) {
      logger.info(`Using cached latest version for ${packageName}: ${cached.version}`)
      latestVersion = cached.version
    } else {
      logger.info(`Fetching latest version for ${packageName} from npm`)
      try {
        const bunPath = await this.getBunPath()
        const { stdout } = await execAsync(`"${bunPath}" info ${packageName} version`, { timeout: 15000 })
        latestVersion = stdout.trim().replace(/["']/g, '')
        logger.info(`${packageName} latest version: ${latestVersion}`)

        // Cache the result
        this.versionCache.set(cacheKey, { version: latestVersion!, timestamp: now })
        logger.debug(`Cached latest version for ${packageName}`)
      } catch (error) {
        logger.warn(`Failed to get latest version for ${packageName}:`, error as Error)
        // If we have a cached version, use it even if expired
        if (cached) {
          logger.info(`Using expired cached version for ${packageName}: ${cached.version}`)
          latestVersion = cached.version
        }
      }
    }

    const needsUpdate = !!(installedVersion && latestVersion && installedVersion !== latestVersion)
    logger.info(
      `Version check result for ${cliTool}: installed=${installedVersion}, latest=${latestVersion}, needsUpdate=${needsUpdate}`
    )

    return {
      installed: installedVersion,
      latest: latestVersion,
      needsUpdate
    }
  }

  /**
   * Get npm registry URL based on user location
   */
  private async getNpmRegistryUrl(): Promise<string> {
    try {
      const inChina = await isUserInChina()
      if (inChina) {
        logger.info('User in China, using Taobao npm mirror')
        return 'https://registry.npmmirror.com'
      } else {
        logger.info('User not in China, using default npm mirror')
        return 'https://registry.npmjs.org'
      }
    } catch (error) {
      logger.warn('Failed to detect user location, using default npm mirror')
      return 'https://registry.npmjs.org'
    }
  }

  /**
   * Update a CLI tool to the latest version
   */
  public async updatePackage(cliTool: string): Promise<{ success: boolean; message: string }> {
    logger.info(`Starting update process for ${cliTool}`)
    try {
      const packageName = await this.getPackageName(cliTool)
      const bunPath = await this.getBunPath()
      const bunInstallPath = path.join(os.homedir(), '.cherrystudio')
      const registryUrl = await this.getNpmRegistryUrl()

      const installEnvPrefix =
        process.platform === 'win32'
          ? `set "BUN_INSTALL=${bunInstallPath}" && set "NPM_CONFIG_REGISTRY=${registryUrl}" &&`
          : `export BUN_INSTALL="${bunInstallPath}" && export NPM_CONFIG_REGISTRY="${registryUrl}" &&`

      const updateCommand = `${installEnvPrefix} "${bunPath}" install -g ${packageName}`
      logger.info(`Executing update command: ${updateCommand}`)

      await execAsync(updateCommand, { timeout: 60000 })
      logger.info(`Successfully executed update command for ${cliTool}`)

      // Clear version cache for this package
      const cacheKey = `${packageName}-latest`
      this.versionCache.delete(cacheKey)
      logger.debug(`Cleared version cache for ${packageName}`)

      const successMessage = `Successfully updated ${cliTool} to the latest version`
      logger.info(successMessage)
      return {
        success: true,
        message: successMessage
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const failureMessage = `Failed to update ${cliTool}: ${errorMessage}`
      logger.error(failureMessage, error as Error)
      return {
        success: false,
        message: failureMessage
      }
    }
  }

  async run(
    _: Electron.IpcMainInvokeEvent,
    cliTool: string,
    _model: string,
    directory: string,
    env: Record<string, string>,
    options: { autoUpdateToLatest?: boolean } = {}
  ) {
    logger.info(`Starting CLI tool launch: ${cliTool} in directory: ${directory}`)
    logger.debug(`Environment variables:`, Object.keys(env))
    logger.debug(`Options:`, options)

    const packageName = await this.getPackageName(cliTool)
    const bunPath = await this.getBunPath()
    const executableName = await this.getCliExecutableName(cliTool)
    const binDir = path.join(os.homedir(), '.cherrystudio', 'bin')
    const executablePath = path.join(binDir, executableName + (process.platform === 'win32' ? '.exe' : ''))

    logger.debug(`Package name: ${packageName}`)
    logger.debug(`Bun path: ${bunPath}`)
    logger.debug(`Executable name: ${executableName}`)
    logger.debug(`Executable path: ${executablePath}`)

    // Check if package is already installed
    const isInstalled = await this.isPackageInstalled(cliTool)

    // Check for updates and auto-update if requested
    let updateMessage = ''
    if (isInstalled && options.autoUpdateToLatest) {
      logger.info(`Auto update to latest enabled for ${cliTool}`)
      try {
        const versionInfo = await this.getVersionInfo(cliTool)
        if (versionInfo.needsUpdate) {
          logger.info(`Update available for ${cliTool}: ${versionInfo.installed} -> ${versionInfo.latest}`)
          logger.info(`Auto-updating ${cliTool} to latest version`)
          updateMessage = ` && echo "Updating ${cliTool} from ${versionInfo.installed} to ${versionInfo.latest}..."`
          const updateResult = await this.updatePackage(cliTool)
          if (updateResult.success) {
            logger.info(`Update completed successfully for ${cliTool}`)
            updateMessage += ` && echo "Update completed successfully"`
          } else {
            logger.error(`Update failed for ${cliTool}: ${updateResult.message}`)
            updateMessage += ` && echo "Update failed: ${updateResult.message}"`
          }
        } else if (versionInfo.installed && versionInfo.latest) {
          logger.info(`${cliTool} is already up to date (${versionInfo.installed})`)
          updateMessage = ` && echo "${cliTool} is up to date (${versionInfo.installed})"`
        }
      } catch (error) {
        logger.warn(`Failed to check version for ${cliTool}:`, error as Error)
      }
    }

    // Select different terminal based on operating system
    const platform = process.platform
    let terminalCommand: string
    let terminalArgs: string[]

    // Build environment variable prefix (based on platform)
    const buildEnvPrefix = (isWindows: boolean) => {
      if (Object.keys(env).length === 0) return ''

      if (isWindows) {
        // Windows uses set command
        return Object.entries(env)
          .map(([key, value]) => `set "${key}=${value.replace(/"/g, '\\"')}"`)
          .join(' && ')
      } else {
        // Unix-like systems use export command
        return Object.entries(env)
          .map(([key, value]) => `export ${key}="${value.replace(/"/g, '\\"')}"`)
          .join(' && ')
      }
    }

    // Build command to execute
    let baseCommand: string
    const bunInstallPath = path.join(os.homedir(), '.cherrystudio')

    if (isInstalled) {
      // If already installed, run executable directly (with optional update message)
      baseCommand = `"${executablePath}"`
      if (updateMessage) {
        baseCommand = `echo "Checking ${cliTool} version..."${updateMessage} && ${baseCommand}`
      }
    } else {
      // If not installed, install first then run
      const registryUrl = await this.getNpmRegistryUrl()
      const installEnvPrefix =
        platform === 'win32'
          ? `set "BUN_INSTALL=${bunInstallPath}" && set "NPM_CONFIG_REGISTRY=${registryUrl}" &&`
          : `export BUN_INSTALL="${bunInstallPath}" && export NPM_CONFIG_REGISTRY="${registryUrl}" &&`

      const installCommand = `${installEnvPrefix} "${bunPath}" install -g ${packageName}`
      baseCommand = `echo "Installing ${packageName}..." && ${installCommand} && echo "Installation complete, starting ${cliTool}..." && "${executablePath}"`
    }

    switch (platform) {
      case 'darwin': {
        // macOS - Use osascript to launch terminal and execute command directly, without showing startup command
        const envPrefix = buildEnvPrefix(false)
        const command = envPrefix ? `${envPrefix} && ${baseCommand}` : baseCommand

        terminalCommand = 'osascript'
        terminalArgs = [
          '-e',
          `tell application "Terminal"
  activate
  do script "cd '${directory.replace(/'/g, "\\'")}' && clear && ${command.replace(/"/g, '\\"')}"
end tell`
        ]
        break
      }
      case 'win32': {
        // Windows - Use temp bat file for debugging
        const envPrefix = buildEnvPrefix(true)
        const command = envPrefix ? `${envPrefix} && ${baseCommand}` : baseCommand

        // Create temp bat file for debugging and avoid complex command line escaping issues
        const tempDir = path.join(os.tmpdir(), 'cherrystudio')
        const timestamp = Date.now()
        const batFileName = `launch_${cliTool}_${timestamp}.bat`
        const batFilePath = path.join(tempDir, batFileName)

        // Ensure temp directory exists
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true })
        }

        // Build bat file content, including debug information
        const batContent = [
          '@echo off',
          `title ${cliTool} - Cherry Studio`, // Set window title in bat file
          'echo ================================================',
          'echo Cherry Studio CLI Tool Launcher',
          `echo Tool: ${cliTool}`,
          `echo Directory: ${directory}`,
          `echo Time: ${new Date().toLocaleString()}`,
          'echo ================================================',
          '',
          ':: Change to target directory',
          `cd /d "${directory}" || (`,
          '  echo ERROR: Failed to change directory',
          `  echo Target directory: ${directory}`,
          '  pause',
          '  exit /b 1',
          ')',
          '',
          ':: Clear screen',
          'cls',
          '',
          ':: Execute command (without displaying environment variable settings)',
          command,
          '',
          ':: Command execution completed',
          'echo.',
          'echo Command execution completed.',
          'echo Press any key to close this window...',
          'pause >nul'
        ].join('\r\n')

        // Write to bat file
        try {
          fs.writeFileSync(batFilePath, batContent, 'utf8')
          logger.info(`Created temp bat file: ${batFilePath}`)
        } catch (error) {
          logger.error(`Failed to create bat file: ${error}`)
          throw new Error(`Failed to create launch script: ${error}`)
        }

        // Launch bat file - Use safest start syntax, no title parameter
        terminalCommand = 'cmd'
        terminalArgs = ['/c', 'start', batFilePath]

        // Set cleanup task (delete temp file after 5 minutes)
        setTimeout(() => {
          try {
            fs.existsSync(batFilePath) && fs.unlinkSync(batFilePath)
          } catch (error) {
            logger.warn(`Failed to cleanup temp bat file: ${error}`)
          }
        }, 10 * 1000) // Delete temp file after 10 seconds

        break
      }
      case 'linux': {
        // Linux - Try to use common terminal emulators
        const envPrefix = buildEnvPrefix(false)
        const command = envPrefix ? `${envPrefix} && ${baseCommand}` : baseCommand

        const linuxTerminals = ['gnome-terminal', 'konsole', 'xterm', 'x-terminal-emulator']
        let foundTerminal = 'xterm' // Default to xterm

        for (const terminal of linuxTerminals) {
          try {
            // Check if terminal exists
            const checkResult = spawn('which', [terminal], { stdio: 'pipe' })
            await new Promise((resolve) => {
              checkResult.on('close', (code) => {
                if (code === 0) {
                  foundTerminal = terminal
                }
                resolve(code)
              })
            })
            if (foundTerminal === terminal) break
          } catch (error) {
            // Continue trying next terminal
          }
        }

        if (foundTerminal === 'gnome-terminal') {
          terminalCommand = 'gnome-terminal'
          terminalArgs = ['--working-directory', directory, '--', 'bash', '-c', `clear && ${command}; exec bash`]
        } else if (foundTerminal === 'konsole') {
          terminalCommand = 'konsole'
          terminalArgs = ['--workdir', directory, '-e', 'bash', '-c', `clear && ${command}; exec bash`]
        } else {
          // Default to xterm
          terminalCommand = 'xterm'
          terminalArgs = ['-e', `cd "${directory}" && clear && ${command} && bash`]
        }
        break
      }
      default:
        throw new Error(`Unsupported operating system: ${platform}`)
    }

    const processEnv = { ...process.env, ...env }
    removeEnvProxy(processEnv as Record<string, string>)

    // Launch terminal process
    try {
      logger.info(`Launching terminal with command: ${terminalCommand}`)
      logger.debug(`Terminal arguments:`, terminalArgs)
      logger.debug(`Working directory: ${directory}`)
      logger.debug(`Process environment keys: ${Object.keys(processEnv)}`)

      spawn(terminalCommand, terminalArgs, {
        detached: true,
        stdio: 'ignore',
        cwd: directory,
        env: processEnv
      })

      const successMessage = `Launched ${cliTool} in new terminal window`
      logger.info(successMessage)

      return {
        success: true,
        message: successMessage,
        command: `${terminalCommand} ${terminalArgs.join(' ')}`
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const failureMessage = `Failed to launch terminal: ${errorMessage}`
      logger.error(failureMessage, error as Error)
      return {
        success: false,
        message: failureMessage,
        command: `${terminalCommand} ${terminalArgs.join(' ')}`
      }
    }
  }
}

export const codeToolsService = new CodeToolsService()
