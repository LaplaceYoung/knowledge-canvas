import { ApiSettingsDialog } from '@/components/ApiSettingsDialog'
import { CanvasWorkspace } from '@/components/CanvasWorkspace'
import { FocusView } from '@/components/FocusView'
import { useCanvasStore } from '@/store/canvas-store'
import '../App.css'

export default function Home() {
  const contentFontSize = useCanvasStore((state) => state.contentFontSize)

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
