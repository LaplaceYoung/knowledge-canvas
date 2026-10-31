import { ApiSettingsDialog } from '@/components/ApiSettingsDialog'
import { CanvasWorkspace } from '@/components/CanvasWorkspace'
import { FocusView } from '@/components/FocusView'
import { listenWebBridgeEvents } from '@/lib/web-bridge'
import { handleWebBridgeEvent, refreshWebNodeBindings } from '@/lib/web-node-service'
import { useCanvasStore } from '@/store/canvas-store'
import { useEffect } from 'react'
import '../App.css'

export default function Home() {
  const contentFontSize = useCanvasStore((state) => state.contentFontSize)

  useEffect(() => {
    return listenWebBridgeEvents((event) => {
      handleWebBridgeEvent(event)
      if (event.type === 'bridge.ready') void refreshWebNodeBindings()
    })
  }, [])

  return (
    <div
      className="app-shell"
      style={{ '--content-font-size': `${contentFontSize}px` } as React.CSSProperties}
    >
      <CanvasWorkspace />
      <FocusView />
      <ApiSettingsDialog />
    </div>
  )
}
