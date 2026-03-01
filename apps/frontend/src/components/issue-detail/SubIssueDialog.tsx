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
        className="md:max-w-[580px]"
        aria-describedby={undefined}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogTitle>{t('issue.createSubIssue')}</DialogTitle>

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
