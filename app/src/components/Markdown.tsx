import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

export function Markdown({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div className={`markdown ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={{
          a: ({ children: linkChildren, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener">
              {linkChildren}
            </a>
          ),
          img: ({ alt }) => <span className="text-xs text-muted-foreground">[图片{alt ? `：${alt}` : ''}]</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
