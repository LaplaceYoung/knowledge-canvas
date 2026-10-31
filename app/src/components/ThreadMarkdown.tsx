import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import {
  MarkdownTextPrimitive,
  type CodeHeaderProps,
  type MarkdownTextPrimitiveProps,
  type SyntaxHighlighterProps,
} from '@assistant-ui/react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { copyText } from '@/lib/clipboard'

function CodeHeader({ language, code }: CodeHeaderProps) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const success = await copyText(code)
    setCopied(success)
    if (success) window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="aui-code-header">
      <span className="truncate text-xs text-muted-foreground">{language || 'text'}</span>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => void copy()}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  )
}

function SyntaxHighlighter({ components: { Pre, Code }, language, code }: SyntaxHighlighterProps) {
  return (
    <Pre className="aui-code-pre">
      <Code className={language ? `language-${language}` : undefined}>{code}</Code>
    </Pre>
  )
}

const components: NonNullable<MarkdownTextPrimitiveProps['components']> = {
  a: ({ children, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  img: ({ alt }) => <span className="text-xs text-muted-foreground">[图片{alt ? `：${alt}` : ''}]</span>,
  CodeHeader,
  SyntaxHighlighter,
}

export function ThreadMarkdown() {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
      components={components}
      smooth={false}
      defer
      className="aui-md"
    />
  )
}
