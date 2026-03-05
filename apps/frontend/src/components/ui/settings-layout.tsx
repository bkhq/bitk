import type { LucideIcon } from 'lucide-react'
import { Menu, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export interface SettingsNavItem {
  id: string
  label: string
  icon: LucideIcon
}

export function SettingsLayout({
  open,
  onOpenChange,
  title,
  items,
  defaultItem,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  items: SettingsNavItem[]
  defaultItem?: string
  children: (activeItem: string) => React.ReactNode
  footer?: (activeItem: string) => React.ReactNode
}) {
  const [active, setActive] = useState(defaultItem ?? items[0]?.id ?? '')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const handleNavClick = (id: string) => {
    setActive(id)
    setMobileNavOpen(false)
  }

  const activeLabel = items.find((i) => i.id === active)?.label

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        className={cn(
          // Mobile: full-screen
          'inset-0 top-0 left-0 h-dvh w-full max-w-none translate-x-0 translate-y-0 rounded-none',
          // Desktop (md+): centered dialog
          'md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2',
          'md:h-[min(460px,65dvh)] md:w-full md:max-w-2xl md:rounded-xl',
          // Shared
          'flex flex-col overflow-hidden p-0 gap-0',
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="relative flex min-h-0 flex-1">
          {/* Sidebar — always visible on desktop, overlay on mobile */}
          <nav
            className={cn(
              // Desktop: static sidebar
              'hidden md:flex w-40 shrink-0 flex-col border-r bg-muted/30 p-3',
              // Mobile: overlay drawer from left
              mobileNavOpen &&
                'fixed inset-y-0 left-0 z-50 flex w-64 bg-background p-3 shadow-lg md:relative md:w-40 md:bg-muted/30 md:shadow-none md:z-auto',
            )}
          >
            <div className="mb-3 flex items-center justify-between px-2">
              <h2 className="text-sm font-semibold">{title}</h2>
              <Button
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                onClick={() => setMobileNavOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="flex flex-col gap-0.5">
              {items.map((item) => {
                const Icon = item.icon
                const isActive = item.id === active
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavClick(item.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors text-left',
                      isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                  </button>
                )
              })}
            </div>
          </nav>

          {/* Mobile nav backdrop */}
          {mobileNavOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/20 md:hidden"
              onClick={() => setMobileNavOpen(false)}
              onKeyDown={() => {}}
              role="presentation"
            />
          )}

          {/* Content — always visible */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="md:hidden"
                  onClick={() => setMobileNavOpen(true)}
                >
                  <Menu className="size-4" />
                </Button>
                <h3 className="text-sm font-semibold">{activeLabel}</h3>
              </div>
              <DialogClose render={<Button variant="ghost" size="icon-sm" />}>
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </DialogClose>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
              {children(active)}
            </div>
            {footer?.(active)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
