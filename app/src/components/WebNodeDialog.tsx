import { useEffect, useState } from 'react'
import { Globe2, LoaderCircle } from 'lucide-react'
import { pingWebBridge } from '@/lib/web-bridge'
import { WEB_PROVIDER_IDS, WEB_PROVIDERS } from '@/lib/web-providers'
import type { WebProviderId } from '@/types/canvas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface WebNodeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (providerId: WebProviderId) => void
}

export function WebNodeDialog({ open, onOpenChange, onCreate }: WebNodeDialogProps) {
  const [providerId, setProviderId] = useState<WebProviderId>('chatgpt')
  const [extensionState, setExtensionState] = useState<'checking' | 'available' | 'missing'>(
    'checking',
  )

  useEffect(() => {
    let cancelled = false
    pingWebBridge().then((result) => {
      if (!cancelled) setExtensionState(result ? 'available' : 'missing')
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建 Web 节点</DialogTitle>
          <DialogDescription>
            节点绑定真实网页标签页，不嵌入 iframe，也不读取 Cookie 或网页凭据。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <span className="text-sm font-medium">Provider</span>
          <div className="grid gap-2" role="group" aria-label="Web Provider">
            {WEB_PROVIDER_IDS.map((id) => {
              const provider = WEB_PROVIDERS[id]
              const active = id === providerId
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setProviderId(id)}
                  className={`flex items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors ${
                    active ? 'border-ring bg-muted/50' : 'bg-card hover:bg-accent/50'
                  }`}
                >
                  <Globe2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium">{provider.label}</span>
                      <Badge variant={provider.mirrorSupported ? 'secondary' : 'outline'}>
                        {provider.mirrorSupported ? '镜像可用' : '仅标签页联动'}
                      </Badge>
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {provider.note}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
          {extensionState === 'checking' && <LoaderCircle className="size-3.5 animate-spin" />}
          <span>
            {extensionState === 'checking'
              ? '正在检测浏览器扩展'
              : extensionState === 'available'
                ? '扩展已连接。创建后会打开真实网页并尝试绑定。'
                : '未检测到扩展。仍可创建快捷入口，安装扩展后重新绑定。'}
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => onCreate(providerId)}>创建 Web 节点</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
