import { loggerService } from '@logger'
import { TurndownPlugin } from '@truto/turndown-plugin-gfm'
import he from 'he'
import htmlTags, { type HtmlTags } from 'html-tags'
import * as htmlparser2 from 'htmlparser2'
import MarkdownIt from 'markdown-it'
import striptags from 'striptags'
import TurndownService from 'turndown'

const logger = loggerService.withContext('markdownConverter')

function escapeCustomTags(html: string) {
  let result = ''
  let currentPos = 0
  const processedPositions = new Set<number>()

  const parser = new htmlparser2.Parser({
    onopentagname(tagname) {
      const startPos = parser.startIndex
      const endPos = parser.endIndex

      // Add content before this tag
      result += html.slice(currentPos, startPos)

      if (!htmlTags.includes(tagname as HtmlTags)) {
        // This is a custom tag, escape it
        const tagHtml = html.slice(startPos, endPos + 1)
        result += tagHtml.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      } else {
        // This is a standard HTML tag, keep it as-is
        result += html.slice(startPos, endPos + 1)
      }

      currentPos = endPos + 1
    },

    onclosetag(tagname) {
      const startPos = parser.startIndex
      const endPos = parser.endIndex

      // Skip if we've already processed this position (handles malformed HTML)
      if (processedPositions.has(endPos) || endPos + 1 <= currentPos) {
        return
      }

      processedPositions.add(endPos)

      // Get the actual HTML content at this position to verify what tag it really is
      const actualTagHtml = html.slice(startPos, endPos + 1)
      const actualTagMatch = actualTagHtml.match(/<\/([^>]+)>/)
      const actualTagName = actualTagMatch ? actualTagMatch[1] : tagname

      if (!htmlTags.includes(actualTagName as HtmlTags)) {
        // This is a custom tag, escape it
        result += html.slice(currentPos, startPos)
        result += actualTagHtml.replace(/</g, '&lt;').replace(/>/g, '&gt;')
        currentPos = endPos + 1
      } else {
        // This is a standard HTML tag, add content up to and including the closing tag
        result += html.slice(currentPos, endPos + 1)
        currentPos = endPos + 1
      }
    },

    onend() {
      result += html.slice(currentPos)
    }
  })

  parser.write(html)
  parser.end()
  return result
}

export interface TaskListOptions {
  label?: boolean
}

// Create markdown-it instance with task list plugin
const md = new MarkdownIt({
  html: true, // Enable HTML tags in source
  xhtmlOut: true, // Use '>' for single tags (<br> instead of <br />)
  breaks: false,
  linkify: false, // Autoconvert URL-like text to links
  typographer: false // Enable smartypants and other sweet transforms
})

// Override the code_block and code_inline renderers to properly escape HTML entities
md.renderer.rules.code_block = function (tokens, idx) {
  const token = tokens[idx]
  const langName = token.info ? ` class="language-${token.info.trim()}"` : ''
  const escapedContent = he.encode(token.content, { useNamedReferences: false })
  return `<pre><code${langName}>${escapedContent}</code></pre>`
}

md.renderer.rules.code_inline = function (tokens, idx) {
  const token = tokens[idx]
  const escapedContent = he.encode(token.content, { useNamedReferences: false })
  return `<code>${escapedContent}</code>`
}

md.renderer.rules.fence = function (tokens, idx) {
  const token = tokens[idx]
  const langName = token.info ? ` class="language-${token.info.trim()}"` : ''
  const escapedContent = he.encode(token.content, { useNamedReferences: false })
  return `<pre><code${langName}>${escapedContent}</code></pre>`
}

// Custom task list plugin for markdown-it
function taskListPlugin(md: MarkdownIt, options: TaskListOptions = {}) {
  const { label = false } = options
  md.core.ruler.after('inline', 'task_list', (state) => {
    const tokens = state.tokens
    let inside_task_list = false

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]

      if (token.type === 'bullet_list_open') {
        // Check if this list contains task items
        let hasTaskItems = false
        for (let j = i + 1; j < tokens.length && tokens[j].type !== 'bullet_list_close'; j++) {
          if (tokens[j].type === 'inline' && /^\s*\[[ x]\]\s/.test(tokens[j].content)) {
            hasTaskItems = true
            break
          }
        }

        if (hasTaskItems) {
          inside_task_list = true
          token.attrSet('data-type', 'taskList')
          token.attrSet('class', 'task-list')
        }
      } else if (token.type === 'bullet_list_close' && inside_task_list) {
        inside_task_list = false
      } else if (token.type === 'list_item_open' && inside_task_list) {
        token.attrSet('data-type', 'taskItem')
        token.attrSet('class', 'task-list-item')
      } else if (token.type === 'inline' && inside_task_list) {
        const match = token.content.match(/^(\s*)\[([x ])\]\s+(.*)/)
        if (match) {
          const [, , check, content] = match
          const isChecked = check.toLowerCase() === 'x'

          // Find the parent list item token
          for (let j = i - 1; j >= 0; j--) {
            if (tokens[j].type === 'list_item_open') {
              tokens[j].attrSet('data-checked', isChecked.toString())
              break
            }
          }

          // Replace content with checkbox HTML and text
          token.content = content

          // Create checkbox token
          const checkboxToken = new state.Token('html_inline', '', 0)

          if (label) {
            checkboxToken.content = `<label><input type="checkbox"${isChecked ? ' checked' : ''} disabled> ${content}</label>`
            token.children = [checkboxToken]
          } else {
            checkboxToken.content = `<input type="checkbox"${isChecked ? ' checked' : ''} disabled>`

            // Insert checkbox at the beginning of inline content
            const textToken = new state.Token('text', '', 0)
            textToken.content = ' ' + content

            token.children = [checkboxToken, textToken]
          }
        }
      }
    }
  })
}

interface TokenLike {
  content: string
  block?: boolean
  map?: [number, number]
}

interface BlockStateLike {
  src: string
  bMarks: number[]
  eMarks: number[]
  tShift: number[]
  line: number
  parentType: string
  blkIndent: number
  push: (type: string, tag: string, nesting: number) => TokenLike
}

interface InlineStateLike {
  src: string
  pos: number
  posMax: number
  push: (type: string, tag: string, nesting: number) => TokenLike & { content?: string }
}

function tipTapKatexPlugin(md: MarkdownIt) {
  // 1) Parser: recognize $$ ... $$ as a block math token
  md.block.ruler.before(
    'fence',
    'math_block',
    (stateLike: unknown, startLine: number, endLine: number, silent: boolean): boolean => {
      const state = stateLike as BlockStateLike

      const startPos = state.bMarks[startLine] + state.tShift[startLine]
      const maxPos = state.eMarks[startLine]

      // Must begin with $$ at line start (after indentation)
      if (startPos + 2 > maxPos) return false
      if (state.src.charCodeAt(startPos) !== 0x24 /* $ */ || state.src.charCodeAt(startPos + 1) !== 0x24 /* $ */) {
        return false
      }

      // If requested only to validate existence
      if (silent) return true

      // Search for closing $$
      let nextLine = startLine
      let content = ''

      // Same-line closing? $$ ... $$
      const sameLineClose = state.src.indexOf('$$', startPos + 2)
      if (sameLineClose !== -1 && sameLineClose <= maxPos - 2) {
        content = state.src.slice(startPos + 2, sameLineClose).trim()
        nextLine = startLine
      } else {
        // Multiline: look for closing $$ anywhere
        for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
          const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
          const lineEnd = state.eMarks[nextLine]
          const line = state.src.slice(lineStart, lineEnd)

          // Check if this line contains closing $$
          const closingPos = line.indexOf('$$')
          if (closingPos !== -1) {
            // Found closing $$; extract content between opening and closing
            const allLines: string[] = []

            // First line: content after opening $$
            const firstLineStart = state.bMarks[startLine] + state.tShift[startLine] + 2
            const firstLineEnd = state.eMarks[startLine]
            const firstLineContent = state.src.slice(firstLineStart, firstLineEnd)
            if (firstLineContent.trim()) {
              allLines.push(firstLineContent)
            }

            // Middle lines: full content
            for (let lineIdx = startLine + 1; lineIdx < nextLine; lineIdx++) {
              const midLineStart = state.bMarks[lineIdx] + state.tShift[lineIdx]
              const midLineEnd = state.eMarks[lineIdx]
              allLines.push(state.src.slice(midLineStart, midLineEnd))
            }

            // Last line: content before closing $$
            const lastLineContent = line.slice(0, closingPos)
            if (lastLineContent.trim()) {
              allLines.push(lastLineContent)
            }

            content = allLines.join('\n').trim()
            break
          }

          // Check if line starts with $$ (alternative closing pattern)
          if (
            lineStart + 2 <= lineEnd &&
            state.src.charCodeAt(lineStart) === 0x24 &&
            state.src.charCodeAt(lineStart + 1) === 0x24
          ) {
            // Extract content between start and this line
            const firstContentLineStart = state.bMarks[startLine] + state.tShift[startLine] + 2
            const lastContentLineEnd = state.bMarks[nextLine]
            content = state.src.slice(firstContentLineStart, lastContentLineEnd).trim()
            break
          }
        }
        if (nextLine >= endLine) {
          // No closing fence -> not a valid block
          return false
        }
      }

      const token = state.push('math_block', 'div', 0)
      token.block = true
      token.map = [startLine, nextLine]
      token.content = content

      state.line = nextLine + 1
      return true
    }
  )

  // 2) Renderer: output TipTap-friendly container
  md.renderer.rules.math_block = (tokens: Array<{ content?: string }>, idx: number): string => {
    const content = tokens[idx]?.content ?? ''
    const latexEscaped = he.encode(content, { useNamedReferences: true })
    return `<div data-latex="${latexEscaped}" data-type="block-math"></div>`
  }

  // 3) Inline parser: recognize $...$ on a single line as inline math
  md.inline.ruler.before('emphasis', 'math_inline', (stateLike: unknown, silent: boolean): boolean => {
    const state = stateLike as InlineStateLike
    const start = state.pos

    // Need starting $
    if (start >= state.posMax || state.src.charCodeAt(start) !== 0x24 /* $ */) {
      return false
    }

    // Find the next $ after start+1
    const close = state.src.indexOf('$', start + 1)
    if (close === -1 || close > state.posMax) {
      return false
    }

    const content = state.src.slice(start + 1, close)
    // Inline variant must not contain a newline
    if (content.indexOf('\n') !== -1) {
      return false
    }

    if (!silent) {
      const token = state.push('math_inline', 'span', 0)
      token.content = content.trim()
    }

    state.pos = close + 1
    return true
  })

  // 4) Inline renderer: output TipTap-friendly inline container
  md.renderer.rules.math_inline = (tokens: Array<{ content?: string }>, idx: number): string => {
    const content = tokens[idx]?.content ?? ''
    const latexEscaped = he.encode(content, { useNamedReferences: true })
    return `<span data-latex="${latexEscaped}" data-type="inline-math"></span>`
  }
}

md.use(taskListPlugin, {
  label: true
})

md.use(tipTapKatexPlugin)

// Initialize turndown service
const turndownService = new TurndownService({
  headingStyle: 'atx', // Use # for headings
  hr: '---', // Use --- for horizontal rules
  bulletListMarker: '-', // Use - for bullet lists
  codeBlockStyle: 'fenced', // Use ``` for code blocks
  fence: '```', // Use ``` for code blocks
  emDelimiter: '*', // Use * for emphasis
  strongDelimiter: '**', // Use ** for strong
  blankReplacement: (_content, node) => {
    const el = node as any as HTMLElement
    if (el.nodeName === 'DIV' && el.getAttribute?.('data-type') === 'block-math') {
      const latex = el.getAttribute?.('data-latex') || ''
      const decodedLatex = he.decode(latex, {
        isAttributeValue: false,
        strict: false
      })
      return `$$${decodedLatex}$$\n\n`
    }
    if (el.nodeName === 'SPAN' && el.getAttribute?.('data-type') === 'inline-math') {
      const latex = el.getAttribute?.('data-latex') || ''
      const decodedLatex = he.decode(latex, {
        isAttributeValue: false,
        strict: false
      })
      return `$${decodedLatex}$`
    }
    // Handle paragraphs containing only math spans
    if (el.nodeName === 'P' && el.querySelector?.('[data-type="inline-math"]')) {
      const mathSpans = el.querySelectorAll('[data-type="inline-math"]')
      if (mathSpans.length === 1 && el.children.length === 1) {
        const span = mathSpans[0]
        const latex = span.getAttribute('data-latex') || ''
        const decodedLatex = he.decode(latex, {
          isAttributeValue: false,
          strict: false
        })
        return `$${decodedLatex}$`
      }
    }
    return (node as any).isBlock ? '\n\n' : ''
  }
})

// Configure turndown rules for better conversion
turndownService.addRule('strikethrough', {
  filter: ['del', 's'],
  replacement: (content) => `~~${content}~~`
})

turndownService.addRule('underline', {
  filter: ['u'],
  replacement: (content) => `<u>${content}</u>`
})

// Custom rule to preserve <br> tags as literal text
turndownService.addRule('br', {
  filter: 'br',
  replacement: () => '<br>'
})

// Helper function to safely get text content and clean it with LaTeX support
function cleanCellContent(content: string, cellElement?: Element): string {
  // First check for math elements in the cell
  if (cellElement) {
    const blockMath = cellElement.querySelector('[data-type="block-math"]')
    if (blockMath) {
      const latex = blockMath.getAttribute('data-latex') || ''
      const decodedLatex = he.decode(latex, { isAttributeValue: false, strict: false })
      return `$$${decodedLatex}$$`
    }

    const inlineMath = cellElement.querySelector('[data-type="inline-math"]')
    if (inlineMath) {
      const latex = inlineMath.getAttribute('data-latex') || ''
      const decodedLatex = he.decode(latex, { isAttributeValue: false, strict: false })
      return `$${decodedLatex}$`
    }
  }

  if (!content) return '   ' // Default empty cell content

  // Clean and normalize content
  let cleaned = content
    .trim()
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\|/g, '\\|') // Escape pipes
    .replace(/\n+/g, ' ') // Convert newlines to spaces
    .replace(/\r+/g, ' ') // Convert carriage returns to spaces

  // If content is still empty or only whitespace, provide default
  if (!cleaned || cleaned.match(/^\s*$/)) {
    return '   '
  }

  // Ensure minimum width for table readability
  if (cleaned.length < 3) {
    cleaned += ' '.repeat(3 - cleaned.length)
  }

  return cleaned
}

// Enhanced cell replacement with LaTeX support
function cellWithLatex(content: string, node: Element, index?: number | null): string {
  if (index === null && node && node.parentNode) {
    index = Array.prototype.indexOf.call(node.parentNode.childNodes, node)
  }
  if (index === null) index = 0

  let prefix = ' '
  if (index === 0) prefix = '| '

  const cellContent = cleanCellContent(content, node)

  // Handle colspan by adding extra empty cells
  let colspan = 1
  if (node && node.getAttribute) {
    colspan = parseInt(node.getAttribute('colspan') || '1', 10)
    if (isNaN(colspan) || colspan < 1) colspan = 1
  }

  let result = prefix + cellContent + ' |'

  // Add empty cells for colspan
  for (let i = 1; i < colspan; i++) {
    result += '   |'
  }

  return result
}

const customTablesPlugin: TurndownPlugin = (turndownService) => {
  turndownService.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: function (content: string, node: Element) {
      return cellWithLatex(content, node, null)
    }
  })

  turndownService.addRule('tableRow', {
    filter: 'tr',
    replacement: function (content: string, node: Element) {
      // Skip empty rows
      if (!content || !content.trim()) return ''

      let borderCells = ''

      // Add separator row for heading (simplified version)
      const parentNode = node.parentNode
      if (parentNode && parentNode.nodeName === 'THEAD') {
        const table = node.closest('table')
        if (table) {
          // Count cells in this row
          const cellNodes = Array.from(node.querySelectorAll('th, td'))
          const colCount = cellNodes.length

          if (colCount > 0) {
            for (let i = 0; i < colCount; i++) {
              const prefix = i === 0 ? '| ' : ' '
              borderCells += prefix + '---' + ' |'
            }
          }
        }
      }

      return '\n' + content + (borderCells ? '\n' + borderCells : '')
    }
  })

  turndownService.addRule('table', {
    filter: 'table',
    replacement: function (content: string) {
      // Clean up content (remove extra newlines)
      content = content.replace(/\n+/g, '\n').trim()

      // If no content after cleaning, return empty
      if (!content) return ''

      // Split into lines and filter out empty lines
      const lines = content.split('\n').filter((line) => line.trim())

      if (lines.length === 0) return ''

      // Check if we need to add a header row
      const hasHeaderSeparator = lines.length >= 2 && /\|\s*-+/.test(lines[1])

      let result = lines.join('\n')

      // If no header separator exists, add a simple one
      if (!hasHeaderSeparator && lines.length >= 1) {
        const firstLine = lines[0]
        const colCount = (firstLine.match(/\|/g) || []).length - 1

        if (colCount > 0) {
          let separator = '|'
          for (let i = 0; i < colCount; i++) {
            separator += ' --- |'
          }

          // Insert separator after first line
          const resultLines = [lines[0], separator, ...lines.slice(1)]
          result = resultLines.join('\n')
        }
      }

      return '\n\n' + result + '\n\n'
    }
  })

  // Remove table sections but keep content
  turndownService.addRule('tableSection', {
    filter: ['thead', 'tbody', 'tfoot'],
    replacement: function (content: string) {
      return content
    }
  })
}

const taskListItemsPlugin: TurndownPlugin = (turndownService) => {
  turndownService.addRule('taskListItems', {
    filter: (node: Element) => {
      return node.nodeName === 'LI' && node.getAttribute && node.getAttribute('data-type') === 'taskItem'
    },
    replacement: (_content: string, node: Element) => {
      const checkbox = node.querySelector('input[type="checkbox"]') as HTMLInputElement | null
      const isChecked = checkbox?.checked || node.getAttribute('data-checked') === 'true'
      const textContent = node.textContent?.trim() || ''

      return '- ' + (isChecked ? '[x]' : '[ ]') + ' ' + textContent + '\n\n'
    }
  })
  turndownService.addRule('taskList', {
    filter: (node: Element) => {
      return node.nodeName === 'UL' && node.getAttribute && node.getAttribute('data-type') === 'taskList'
    },
    replacement: (content: string) => {
      return content
    }
  })
}

turndownService.use([customTablesPlugin, taskListItemsPlugin])

/**
 * Converts HTML content to Markdown
 * @param html - HTML string to convert
 * @returns Markdown string
 */
export const htmlToMarkdown = (html: string | null | undefined): string => {
  if (!html || typeof html !== 'string') {
    return ''
  }

  try {
    const encodedHtml = escapeCustomTags(html)
    const turndownResult = turndownService.turndown(encodedHtml).trim()
    const finalResult = he.decode(turndownResult)
    return finalResult
  } catch (error) {
    logger.error('Error converting HTML to Markdown:', error as Error)
    return ''
  }
}

/**
 * Converts Markdown content to HTML
 * @param markdown - Markdown string to convert
 * @param options - Task list options
 * @returns HTML string
 */
export const markdownToHtml = (markdown: string | null | undefined): string => {
  if (!markdown || typeof markdown !== 'string') {
    return ''
  }

  try {
    // First, convert any standalone markdown images to HTML img tags
    // This handles cases where markdown images should be rendered as HTML instead of going through markdown-it
    const processedMarkdown = markdown.replace(
      /!\[([^\]]*)\]\(([^)]+?)(?:\s+"([^"]*)")?\)/g,
      (match, alt, src, title) => {
        // Only convert file:// protocol images to HTML img tags
        if (src.startsWith('file://')) {
          const altText = alt || ''
          const srcUrl = src.trim()
          const titleAttr = title ? ` title="${title}"` : ''
          return `<img src="${srcUrl}" alt="${altText}"${titleAttr} />`
        }
        return match
      }
    )

    let html = md.render(processedMarkdown)
    const trimmedMarkdown = processedMarkdown.trim()
    if (html.trim() === trimmedMarkdown) {
      const singleTagMatch = trimmedMarkdown.match(/^<([a-zA-Z][^>\s]*)\/?>$/)
      if (singleTagMatch) {
        const tagName = singleTagMatch[1]
        if (!htmlTags.includes(tagName.toLowerCase() as any)) {
          html = `<p>${html}</p>`
        }
      }
    }
    return html
  } catch (error) {
    logger.error('Error converting Markdown to HTML:', error as Error)
    return ''
  }
}

/**
 * Gets plain text preview from Markdown content
 * @param markdown - Markdown string
 * @param maxLength - Maximum length for preview
 * @returns Plain text preview
 */
export const markdownToPreviewText = (markdown: string, maxLength: number = 50): string => {
  if (!markdown) return ''

  // Convert to HTML first, then strip tags
  const html = markdownToHtml(markdown)
  const textContent = he.decode(striptags(html)).replace(/\s+/g, ' ').trim()

  return textContent.length > maxLength ? `${textContent.slice(0, maxLength)}...` : textContent
}

/**
 * Checks if content is Markdown (contains Markdown syntax)
 * @param content - Content to check
 * @returns True if content appears to be Markdown
 */
export const isMarkdownContent = (content: string): boolean => {
  if (!content) return false

  // Check for common Markdown syntax
  const markdownPatterns = [
    /^#{1,6}\s/, // Headers
    /^\*\s|^-\s|^\+\s/, // Unordered lists
    /^\d+\.\s/, // Ordered lists
    /\*\*.*\*\*/, // Bold
    /\*.*\*/, // Italic
    /`.*`/, // Inline code
    /```/, // Code blocks
    /^>/, // Blockquotes
    /\[.*\]\(.*\)/, // Links
    /!\[.*\]\(.*\)/ // Images
  ]

  return markdownPatterns.some((pattern) => pattern.test(content))
}
