import type { WebProviderId } from '@/types/canvas'
import { cn } from '@/lib/utils'
import { WEB_PROVIDERS } from '@/lib/web-providers'

export function ProviderLogo({
  providerId,
  className,
}: {
  providerId: WebProviderId
  className?: string
}) {
  const provider = WEB_PROVIDERS[providerId]
  return (
    <img
      src={provider.logo}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('size-4 shrink-0 object-contain', provider.monoLogo && 'invert', className)}
    />
  )
}
