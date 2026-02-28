import { Toaster as Sonner } from 'sonner'
import type { ToasterProps } from 'sonner'
import { useTheme } from '@/hooks/use-theme'

function Toaster({ ...props }: ToasterProps) {
  const { resolved } = useTheme()

  return (
    <Sonner
      theme={resolved as ToasterProps['theme']}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
