import { describe, expect, it } from 'vitest'

import { htmlToMarkdown, markdownToHtml, markdownToSafeHtml, sanitizeHtml } from '../markdownConverter'

describe('markdownConverter', () => {
  describe('htmlToMarkdown', () => {
    it('should convert HTML to Markdown', () => {
      const html = '<h1>Hello World</h1>'
      const result = htmlToMarkdown(html)
      expect(result).toBe('# Hello World')
    })

    it('should keep <br> to <br>', () => {
      const html = '<p>Text with<br>\nindentation<br>\nand without indentation</p>'
      const result = htmlToMarkdown(html)
      expect(result).toBe('Text with<br>indentation<br>and without indentation')
    })

    it('should convert task list HTML back to Markdown', () => {
      const html =
        '<ul data-type="taskList" class="task-list"><li data-type="taskItem" class="task-list-item" data-checked="false"><input type="checkbox" disabled> abcd</li><li data-type="taskItem" class="task-list-item" data-checked="true"><input type="checkbox" checked disabled> efgh</li></ul>'
      const result = htmlToMarkdown(html)
      expect(result).toContain('- [ ] abcd')
      expect(result).toContain('- [x] efgh')
    })

    it('should convert task list HTML back to Markdown with label', () => {
      const html =
        '<ul data-type="taskList" class="task-list"><li data-type="taskItem" class="task-list-item" data-checked="false"><label><input type="checkbox"> abcd</label></li><li data-type="taskItem" class="task-list-item" data-checked="true"><label><input type="checkbox" checked> efgh</lable></li></ul>'
      const result = htmlToMarkdown(html)
      expect(result).toBe('- [ ] abcd\n\n- [x] efgh')
    })

    it('should handle empty HTML', () => {
      const result = htmlToMarkdown('')
      expect(result).toBe('')
    })

    it('should handle null/undefined input', () => {
      expect(htmlToMarkdown(null as any)).toBe('')
      expect(htmlToMarkdown(undefined as any)).toBe('')
    })

    it('should keep math block containers intact', () => {
      const html = '<div data-latex="a+b+c" data-type="block-math"></div>'
      const result = htmlToMarkdown(html)
      expect(result).toBe('$$a+b+c$$')
    })

    it('should convert multiple math blocks to Markdown', () => {
      const html =
        '<div data-latex="\\begin{array}{c}\n\\nabla \\times \\vec{\\mathbf{B}} -\\, \\frac1c\\, \\frac{\\partial\\vec{\\mathbf{E}}}{\\partial t} &amp;\n= \\frac{4\\pi}{c}\\vec{\\mathbf{j}}    \\nabla \\cdot \\vec{\\mathbf{E}} &amp; = 4 \\pi \\rho \\\\\n\n\\nabla \\times \\vec{\\mathbf{E}}\\, +\\, \\frac1c\\, \\frac{\\partial\\vec{\\mathbf{B}}}{\\partial t} &amp; = \\vec{\\mathbf{0}} \\\\\n\n\\nabla \\cdot \\vec{\\mathbf{B}} &amp; = 0\n\n\\end{array}" data-type="block-math"></div>'
      const result = htmlToMarkdown(html)
      expect(result).toBe(
        '$$\\begin{array}{c}\n\\nabla \\times \\vec{\\mathbf{B}} -\\, \\frac1c\\, \\frac{\\partial\\vec{\\mathbf{E}}}{\\partial t} &\n= \\frac{4\\pi}{c}\\vec{\\mathbf{j}}    \\nabla \\cdot \\vec{\\mathbf{E}} & = 4 \\pi \\rho \\\\\n\n\\nabla \\times \\vec{\\mathbf{E}}\\, +\\, \\frac1c\\, \\frac{\\partial\\vec{\\mathbf{B}}}{\\partial t} & = \\vec{\\mathbf{0}} \\\\\n\n\\nabla \\cdot \\vec{\\mathbf{B}} & = 0\n\n\\end{array}$$'
      )
    })

    it('should convert math inline syntax to Markdown', () => {
      const html = '<span data-latex="a+b+c" data-type="inline-math"></span>'
      const result = htmlToMarkdown(html)
      expect(result).toBe('$a+b+c$')
    })

    it('shoud convert multiple math blocks and inline math to Markdown', () => {
      const html =
        '<div data-latex="a+b+c" data-type="block-math"></div><p><span data-latex="d+e+f" data-type="inline-math"></span></p>'
      const result = htmlToMarkdown(html)
      expect(result).toBe('$$a+b+c$$\n\n$d+e+f$')
    })

    it('should convert heading and img to Markdown', () => {
      const html = '<h1>Hello</h1>\n<p><img src="https://example.com/image.png" alt="alt text" /></p>\n'
      const result = htmlToMarkdown(html)
      expect(result).toBe('# Hello\n\n![alt text](https://example.com/image.png)')
    })

    it('should convert heading and paragraph to Markdown', () => {
      const html = '<h1>Hello</h1>\n<p>Hello</p>\n'
      const result = htmlToMarkdown(html)
      expect(result).toBe('# Hello\n\nHello')
    })

    it('should convert code block to Markdown', () => {
      const html = '<pre><code>console.log("Hello, world!");</code></pre>'
      const result = htmlToMarkdown(html)
      expect(result).toBe('```\nconsole.log("Hello, world!");\n```')
    })

    it('should convert code block with language to Markdown', () => {
      const html = '<pre><code class="language-javascript">console.log("Hello, world!");</code></pre>'
      const result = htmlToMarkdown(html)
      expect(result).toBe('```javascript\nconsole.log("Hello, world!");\n```')
    })

    it('should convert table to Markdown', () => {
      const html =
        '<table><tbody><tr><th ><p>f</p></th><th ><p></p></th><th ><p></p></th></tr><tr><td ><p></p></td><td ><p>f</p></td><td ><p></p></td></tr><tr><td ><p></p></td><td ><p></p></td><td ><p>f</p></td></tr></tbody></table><p></p>'
      const result = htmlToMarkdown(html)
      expect(result).toBe('| f   |     |     |\n| --- | --- | --- |\n|     | f   |     |\n|     |     | f   |')
    })
  })

  describe('markdownToHtml', () => {
    it('should convert <br> to <br>', () => {
      const markdown = 'Text with<br>\nindentation<br>\nand without indentation'
      const result = markdownToHtml(markdown)
      expect(result).toBe('<p>Text with<br>\nindentation<br>\nand without indentation</p>\n')
    })

    it('should handle indentation in blockquotes', () => {
      const markdown = '> Quote line 1\n>   Quote line 2 with indentation'
      const result = markdownToHtml(markdown)
      // This should preserve indentation within the blockquote
      expect(result).toContain('Quote line 1')
      expect(result).toContain('Quote line 2 with indentation')
    })

    it('should preserve indentation in nested lists', () => {
      const markdown = '- Item 1\n  - Nested item\n    - Double nested\n      with continued line'
      const result = markdownToHtml(markdown)
      // Should create proper nested list structure
      expect(result).toContain('<ul>')
      expect(result).toContain('<li>')
    })

    it('should handle poetry or formatted text with indentation', () => {
      const markdown = 'Roses are red\n    Violets are blue\n        Sugar is sweet\n            And so are you'
      const result = markdownToHtml(markdown)
      expect(result).toBe('<p>Roses are red\nViolets are blue\nSugar is sweet\nAnd so are you</p>\n')
    })

    it('should preserve indentation after line breaks with multiple paragraphs', () => {
      const markdown = 'First paragraph\n\n    with indentation\n\n    Second paragraph\n\nwith different indentation'
      const result = markdownToHtml(markdown)
      expect(result).toBe(
        '<p>First paragraph</p>\n<pre><code>with indentation\n\nSecond paragraph\n</code></pre><p>with different indentation</p>\n'
      )
    })

    it('should handle zero-width indentation (just line break)', () => {
      const markdown = 'Hello\n\nWorld'
      const result = markdownToHtml(markdown)
      expect(result).toBe('<p>Hello</p>\n<p>World</p>\n')
    })

    it('should preserve indentation in mixed content', () => {
      const markdown =
        'Normal text\n  Indented continuation\n\n- List item\n    List continuation\n\n> Quote\n>   Indented quote'
      const result = markdownToHtml(markdown)
      expect(result).toBe(
        '<p>Normal text\nIndented continuation</p>\n<ul>\n<li>List item\nList continuation</li>\n</ul>\n<blockquote>\n<p>Quote\nIndented quote</p>\n</blockquote>\n'
      )
    })

    it('should convert Markdown to HTML', () => {
      const markdown = '# Hello World'
      const result = markdownToHtml(markdown)
      expect(result).toContain('<h1>Hello World</h1>')
    })

    it('should convert math block syntax to HTML', () => {
      const markdown = '$$a+b+c$$'
      const result = markdownToHtml(markdown)
      expect(result).toContain('<div data-latex="a+b+c" data-type="block-math"></div>')
    })

    it('should convert math inline syntax to HTML', () => {
      const markdown = '$a+b+c$'
      const result = markdownToHtml(markdown)
      expect(result).toContain('<span data-latex="a+b+c" data-type="inline-math"></span>')
    })

    it('should convert multiple math blocks to HTML', () => {
      const markdown = `$$\\begin{array}{c}
\\nabla \\times \\vec{\\mathbf{B}} -\\, \\frac1c\\, \\frac{\\partial\\vec{\\mathbf{E}}}{\\partial t} &
= \\frac{4\\pi}{c}\\vec{\\mathbf{j}}    \\nabla \\cdot \\vec{\\mathbf{E}} & = 4 \\pi \\rho \\\\

\\nabla \\times \\vec{\\mathbf{E}}\\, +\\, \\frac1c\\, \\frac{\\partial\\vec{\\mathbf{B}}}{\\partial t} & = \\vec{\\mathbf{0}} \\\\

\\nabla \\cdot \\vec{\\mathbf{B}} & = 0

\\end{array}$$`
      const result = markdownToHtml(markdown)
      expect(result).toContain(
        '<div data-latex="\\begin{array}{c}\n\\nabla \\times \\vec{\\mathbf{B}} -\\, \\frac1c\\, \\frac{\\partial\\vec{\\mathbf{E}}}{\\partial t} &amp;\n= \\frac{4\\pi}{c}\\vec{\\mathbf{j}}    \\nabla \\cdot \\vec{\\mathbf{E}} &amp; = 4 \\pi \\rho \\\\\n\n\\nabla \\times \\vec{\\mathbf{E}}\\, +\\, \\frac1c\\, \\frac{\\partial\\vec{\\mathbf{B}}}{\\partial t} &amp; = \\vec{\\mathbf{0}} \\\\\n\n\\nabla \\cdot \\vec{\\mathbf{B}} &amp; = 0\n\n\\end{array}" data-type="block-math"></div>'
      )
    })

    it('should convert task list syntax to proper HTML', () => {
      const markdown = '- [ ] abcd\n\n- [x] efgh\n\n'
      const result = markdownToHtml(markdown)
      expect(result).toContain('data-type="taskList"')
      expect(result).toContain('data-type="taskItem"')
      expect(result).toContain('data-checked="false"')
      expect(result).toContain('data-checked="true"')
      expect(result).toContain('<input type="checkbox" disabled>')
      expect(result).toContain('<input type="checkbox" checked disabled>')
      expect(result).toContain('abcd')
      expect(result).toContain('efgh')
    })

    it('should convert mixed task list with checked and unchecked items', () => {
      const markdown = '- [ ] First task\n\n- [x] Second task\n\n- [ ] Third task'
      const result = markdownToHtml(markdown)
      expect(result).toContain('data-type="taskList"')
      expect(result).toContain('First task')
      expect(result).toContain('Second task')
      expect(result).toContain('Third task')
      expect(result.match(/data-checked="false"/g)).toHaveLength(2)
      expect(result.match(/data-checked="true"/g)).toHaveLength(1)
    })

    it('should NOT convert standalone task syntax to task list', () => {
      const markdown = '[x] abcd'
      const result = markdownToHtml(markdown)
      expect(result).toContain('<p>[x] abcd</p>')
      expect(result).not.toContain('data-type="taskList"')
    })

    it('should handle regular list items alongside task lists', () => {
      const markdown = '- Regular item\n\n- [ ] Task item\n\n- Another regular item'
      const result = markdownToHtml(markdown)
      expect(result).toContain('data-type="taskList"')
      expect(result).toContain('Regular item')
      expect(result).toContain('Task item')
      expect(result).toContain('Another regular item')
    })

    it('should handle empty Markdown', () => {
      const result = markdownToHtml('')
      expect(result).toBe('')
    })

    it('should handle null/undefined input', () => {
      expect(markdownToHtml(null as any)).toBe('')
      expect(markdownToHtml(undefined as any)).toBe('')
    })

    it('should handle heading and img', () => {
      const markdown = `# 🌠 Screenshot

![](https://example.com/image.png)`
      const result = markdownToHtml(markdown)
      expect(result).toBe('<h1>🌠 Screenshot</h1>\n<p><img src="https://example.com/image.png" alt="" /></p>\n')
    })

    it('should handle heading and paragraph', () => {
      const markdown = '# Hello\n\nHello'
      const result = markdownToHtml(markdown)
      expect(result).toBe('<h1>Hello</h1>\n<p>Hello</p>\n')
    })

    it('should convert code block to HTML', () => {
      const markdown = '```\nconsole.log("Hello, world!");\n```'
      const result = markdownToHtml(markdown)
      expect(result).toBe('<pre><code>console.log(&#x22;Hello, world!&#x22;);\n</code></pre>')
    })

    it('should convert code block with language to HTML', () => {
      const markdown = '```javascript\nconsole.log("Hello, world!");\n```'
      const result = markdownToHtml(markdown)
      expect(result).toBe(
        '<pre><code class="language-javascript">console.log(&#x22;Hello, world!&#x22;);\n</code></pre>'
      )
    })

    it('should convert table to HTML', () => {
      const markdown = '| f   |     |     |\n| --- | --- | --- |\n|     | f   |     |\n|     |     | f   |'
      const result = markdownToHtml(markdown)
      expect(result).toBe(
        '<table>\n<thead>\n<tr>\n<th>f</th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td></td>\n<td>f</td>\n<td></td>\n</tr>\n<tr>\n<td></td>\n<td></td>\n<td>f</td>\n</tr>\n</tbody>\n</table>\n'
      )
    })

    it('should escape XML-like tags in code blocks', () => {
      const markdown = '```jsx\nconst component = <><div>content</div></>\n```'
      const result = markdownToHtml(markdown)
      expect(result).toBe(
        '<pre><code class="language-jsx">const component = &#x3C;&#x3E;&#x3C;div&#x3E;content&#x3C;/div&#x3E;&#x3C;/&#x3E;\n</code></pre>'
      )
    })

    it('should escape XML-like tags in inline code', () => {
      const markdown = 'Use `<>` for fragments'
      const result = markdownToHtml(markdown)
      expect(result).toBe('<p>Use <code>&#x3C;&#x3E;</code> for fragments</p>\n')
    })

    it('shoud convert XML-like tags in paragraph', () => {
      const markdown = '<abc></abc>'
      const result = markdownToHtml(markdown)
      expect(result).toBe('<p><abc></abc></p>\n')
    })
  })

  describe('sanitizeHtml', () => {
    it('should sanitize HTML content and remove scripts', () => {
      const html = '<h1>Hello</h1><script>alert("xss")</script>'
      const result = sanitizeHtml(html)
      expect(result).toContain('<h1>Hello</h1>')
      expect(result).not.toContain('<script>')
      expect(result).not.toContain('alert')
    })

    it('should preserve task list HTML elements', () => {
      const html =
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><input type="checkbox" checked disabled> Task item</li></ul>'
      const result = sanitizeHtml(html)
      expect(result).toContain('data-type="taskList"')
      expect(result).toContain('data-type="taskItem"')
      expect(result).toContain('data-checked="true"')
      expect(result).toContain('<input type="checkbox"')
      expect(result).toContain('checked')
      expect(result).toContain('disabled')
    })

    it('should handle empty HTML', () => {
      const result = sanitizeHtml('')
      expect(result).toBe('')
    })
  })

  describe('Task List with Labels', () => {
    it('should wrap task items with labels when label option is true', () => {
      const markdown = '- [ ] abcd\n\n- [x] efgh'
      const result = markdownToHtml(markdown)
      expect(result).toBe(
        '<ul data-type="taskList" class="task-list">\n<li data-type="taskItem" class="task-list-item" data-checked="false">\n<p><label><input type="checkbox" disabled> abcd</label></p>\n</li>\n<li data-type="taskItem" class="task-list-item" data-checked="true">\n<p><label><input type="checkbox" checked disabled> efgh</label></p>\n</li>\n</ul>\n'
      )
    })

    it('should preserve labels in sanitized HTML', () => {
      const html =
        '<ul data-type="taskList"><li data-type="taskItem"><label><input type="checkbox" checked disabled> Task with label</label></li></ul>'
      const result = sanitizeHtml(html)
      expect(result).toContain('<label>')
      expect(result).toContain('<input type="checkbox" checked')
      expect(result).toContain('Task with label')
    })
  })

  describe('Task List Round Trip', () => {
    it('should maintain task list structure through markdown → html → markdown conversion', () => {
      const originalMarkdown = '- [ ] abcd\n\n- [x] efgh'
      const html = markdownToHtml(originalMarkdown)
      const backToMarkdown = htmlToMarkdown(html)

      expect(backToMarkdown).toBe(originalMarkdown)
    })

    it('should handle complex task lists with multiple items', () => {
      const originalMarkdown =
        '- [ ] First unchecked task\n\n- [x] First checked task\n\n- [ ] Second unchecked task\n\n- [x] Second checked task'
      const html = markdownToHtml(originalMarkdown)
      const backToMarkdown = htmlToMarkdown(html)

      expect(backToMarkdown).toBe(originalMarkdown)
    })
  })

  describe('LaTeX Escaping in Tables', () => {
    it('should test simple inline math with backslashes', () => {
      const html = '<span data-latex="\\int_{-\\infty}^{\\infty}" data-type="inline-math"></span>'
      const result = htmlToMarkdown(html)
      expect(result).toBe('$\\int_{-\\infty}^{\\infty}$')
    })

    it('should test inline math within table structure', () => {
      const tableHtml =
        '<table><thead><tr><th>Formula</th><th>Description</th></tr></thead><tbody><tr><td><span data-latex="\\int_{-\\infty}^{\\infty} e^{-x&sup2;} dx = \\sqrt{\\pi}" data-type="inline-math"></span></td><td>Gaussian integral</td></tr></tbody></table>'
      const result = htmlToMarkdown(tableHtml)
      expect(result).toContain('$\\int_{-\\infty}^{\\infty} e^{-x²} dx = \\sqrt{\\pi}$')
    })

    it('should preserve LaTeX backslashes in table cells during round trip conversion', () => {
      const tableWithLatex =
        '| Formula | Description |\n| --- | --- |\n| $\\int_{-\\infty}^{\\infty} e^{-x²} dx = \\sqrt{\\pi}$ | Gaussian integral |'
      const html = markdownToHtml(tableWithLatex)
      const backToMarkdown = htmlToMarkdown(html)

      // The LaTeX formula should preserve its backslashes
      expect(backToMarkdown).toContain('$\\int_{-\\infty}^{\\infty} e^{-x²} dx = \\sqrt{\\pi}$')
      expect(backToMarkdown).not.toContain('$\\\\int_{-\\\\infty}^{\\\\infty} e^{-x²} dx = \\\\sqrt{\\\\pi}$')
    })

    it('should handle LaTeX in table cells without double escaping', () => {
      const markdown =
        '| Math | Result |\n| --- | --- |\n| $E = mc^2$ | Energy-mass equivalence |\n| $\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$ | Sum formula |'
      const html = markdownToHtml(markdown)
      const result = htmlToMarkdown(html)

      expect(result).toContain('$E = mc^2$')
      expect(result).toContain('$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$')
      expect(result).not.toContain('$\\\\sum_{i=1}^{n} i = \\\\frac{n(n+1)}{2}$')
    })
  })

  describe('markdown image', () => {
    it('should convert markdown iamge to HTML img tag', () => {
      const markdown = '![foo](train.jpg)'
      const result = markdownToHtml(markdown)
      expect(result).toBe('<p><img src="train.jpg" alt="foo" /></p>\n')
    })
    it('should convert markdown image with file:// protocol to HTML img tag', () => {
      const markdown =
        '![pasted_image_45285c9c-a7cd-4c3d-a9b6-6854c3bbe479.png](file:///Users/xxxx/Library/Application Support/CherryStudioDev/Data/Files/45285c9c-a7cd-4c3d-a9b6-6854c3bbe479.png)'
      const result = markdownToHtml(markdown)
      expect(result).toContain(
        '<img src="file:///Users/xxxx/Library/Application Support/CherryStudioDev/Data/Files/45285c9c-a7cd-4c3d-a9b6-6854c3bbe479.png" alt="pasted_image_45285c9c-a7cd-4c3d-a9b6-6854c3bbe479.png" />'
      )
    })

    it('should handle file:// protocol images differently from http images', () => {
      const markdown =
        'Local: ![Local image](file:///path/to/local.png)\\n\\nRemote: ![Remote image](https://example.com/remote.png)'
      const result = markdownToHtml(markdown)
      // file:// should be converted to HTML img tag
      expect(result).toContain('<img src="file:///path/to/local.png" alt="Local image" />')
      // https:// should be processed by markdown-it normally
      expect(result).toContain('<img src="https://example.com/remote.png" alt="Remote image" />')
    })

    it('should handle images with spaces in file:// protocol paths', () => {
      const markdown = '![My Image](file:///path/to/my image with spaces.png)'
      const result = markdownToSafeHtml(markdown)
      expect(result).toContain('<img src="file:///path/to/my image with spaces.png" alt="My Image">')
    })

    it('shoud img label to markdown', () => {
      const html = '<img src="file:///path/to/my image with spaces.png" alt="My Image" />'
      const result = htmlToMarkdown(html)
      expect(result).toBe('![My Image](file:///path/to/my image with spaces.png)')
    })
  })

  it('should handle hardbreak with backslash followed by indented text', () => {
    const markdown = 'Text with \\\n    indentation \\\nand without indentation'
    const result = markdownToHtml(markdown)
    expect(result).toBe('<p>Text with <br />\nindentation <br />\nand without indentation</p>\n')
  })
})
