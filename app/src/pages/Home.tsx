import { ApiSettingsDialog } from '@/components/ApiSettingsDialog'
import { CanvasSidebar } from '@/components/CanvasSidebar'
import { GlobalSearch } from '@/components/GlobalSearch'
import { CanvasWorkspace } from '@/components/CanvasWorkspace'
import { FocusView } from '@/components/FocusView'
import { listenWebBridgeEvents } from '@/lib/web-bridge'
import { handleWebBridgeEvent, refreshWebNodeBindings } from '@/lib/web-node-service'
import { useCanvasStore } from '@/store/canvas-store'
import { useEffect } from 'react'
import '../App.css'

export default function Home() {
  const contentFontSize = useCanvasStore((state) => state.contentFontSize)
  const activeCanvasId = useCanvasStore((state) => state.activeCanvasId)

  useEffect(() => {
    return listenWebBridgeEvents((event) => {
      handleWebBridgeEvent(event)
      if (event.type === 'bridge.ready') void refreshWebNodeBindings()
    })
  }, [])

  useEffect(() => {
    void refreshWebNodeBindings()
  }, [activeCanvasId])

  return (
    <div
      className="app-shell flex"
      style={{ '--content-font-size': `${contentFontSize}px` } as React.CSSProperties}
    >
      <CanvasSidebar />
      <div className="min-w-0 flex-1">
        <CanvasWorkspace key={activeCanvasId} />
      </div>
      <FocusView />
      <GlobalSearch />
      <ApiSettingsDialog />
    </div>
  )
}
