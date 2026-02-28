import { AlertTriangle, ArrowDown, ArrowUp, Flame } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Priority } from '@/types/kanban'
import { tPriority } from '@/lib/i18n-utils'

const priorityConfig: Record<Priority, { icon: typeof Flame; color: string }> =
  {
    urgent: { icon: Flame, color: 'text-red-500' },
    high: { icon: AlertTriangle, color: 'text-orange-500' },
    medium: { icon: ArrowUp, color: 'text-yellow-500' },
    low: { icon: ArrowDown, color: 'text-blue-400' },
  }

export function PriorityIcon({
  priority,
  className,
}: {
  priority: Priority
  className?: string
}) {
  const { t } = useTranslation()
  const config = priorityConfig[priority]
  const Icon = config.icon
  return (
    <Icon
      className={`${className ?? 'h-3.5 w-3.5'} shrink-0 ${config.color}`}
      aria-label={tPriority(t, priority)}
    />
  )
}
