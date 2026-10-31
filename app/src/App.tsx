import { ReactFlowProvider } from '@xyflow/react'
import Home from './pages/Home'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

export default function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <ReactFlowProvider>
        <Home />
      </ReactFlowProvider>
      <Toaster position="bottom-right" closeButton />
    </TooltipProvider>
  )
}
