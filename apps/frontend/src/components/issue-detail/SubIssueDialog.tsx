import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CreateIssueForm } from '@/components/kanban/CreateIssueDialog'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

export function SubIssueDialog({
  projectId,
  parentIssueId,
  open,
  onOpenChange,
}: {
  projectId: string
  parentIssueId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col gap-0 p-0 max-w-[calc(100%-2rem)] md:max-w-[580px] max-h-[calc(100dvh-2rem)] rounded-xl"
        aria-describedby={undefined}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">
          {t('issue.createSubIssue')}
        </DialogTitle>

        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-sm font-semibold text-foreground">
            {t('issue.createSubIssue')}
          </h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <CreateIssueForm
          projectId={projectId}
          parentIssueId={parentIssueId}
          autoFocus={open}
          onCreated={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
