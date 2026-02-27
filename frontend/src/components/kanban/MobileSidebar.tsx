import {
  Globe,
  Menu,
  Moon,
  Plus,
  Sun,
  ChevronRight,
  TerminalSquare,
} from 'lucide-react'
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Project } from '@/types/kanban'
import { useProjects } from '@/hooks/use-kanban'
import { useTheme } from '@/hooks/use-theme'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { CreateProjectDialog } from '@/components/CreateProjectDialog'
import { AppLogo } from '@/components/AppLogo'
import { getProjectInitials } from '@/lib/format'
import { LANGUAGES } from '@/lib/constants'

export function MobileSidebarTrigger({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 text-muted-foreground md:hidden"
      aria-label={t('sidebar.menu')}
      onClick={onOpen}
    >
      <Menu className="h-5 w-5" />
    </Button>
  )
}

export function MobileSidebar({
  activeProjectId,
}: {
  activeProjectId: string
}) {
  const [open, setOpen] = useState(false)
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { data: projects } = useProjects()
  const { resolved, toggle } = useTheme()
  const [showCreate, setShowCreate] = useState(false)
  const [langExpanded, setLangExpanded] = useState(false)

  // Mobile always uses list mode
  const mobileProjectPath = useCallback(
    (projectId: string) => `/projects/${projectId}/issues`,
    [],
  )

  const handleProjectCreated = useCallback(
    (project: Project) => {
      setShowCreate(false)
      setOpen(false)
      navigate(mobileProjectPath(project.alias))
    },
    [navigate, mobileProjectPath],
  )

  const currentLang =
    LANGUAGES.find((l) => l.id === i18n.language) ?? LANGUAGES[0]

  return (
    <>
      <MobileSidebarTrigger onOpen={() => setOpen(true)} />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-72 p-0"
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">{t('sidebar.menu')}</SheetTitle>

          <div className="flex flex-col h-full">
            {/* Header -- links to homepage (BitK is the brand name) */}
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/')
              }}
              className="flex items-center gap-3 px-4 py-3 border-b hover:bg-accent/50 active:bg-accent transition-colors"
            >
              <AppLogo className="h-8 w-8" />
              <span className="text-sm font-semibold">BitK</span>
            </button>

            {/* Project list */}
            <div className="px-4 pt-3 pb-1">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                {t('project.projects')}
              </span>
            </div>
            <div
              className="flex-1 overflow-y-auto px-2"
              style={{ scrollbarWidth: 'none' }}
            >
              {projects?.map((project) => {
                const isActive = activeProjectId === project.alias
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      navigate(mobileProjectPath(project.alias))
                    }}
                    className={`flex items-center gap-3 w-full px-2 min-h-[44px] rounded-md text-left transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-foreground'
                        : 'text-foreground/80 hover:bg-accent/50 active:bg-accent'
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold ${
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-foreground/[0.07] text-foreground/60'
                      }`}
                    >
                      {getProjectInitials(project.name)}
                    </div>
                    <span className="text-sm truncate">{project.name}</span>
                    {isActive ? (
                      <ChevronRight className="h-3.5 w-3.5 ml-auto text-primary shrink-0" />
                    ) : null}
                  </button>
                )
              })}
            </div>

            {/* Bottom actions */}
            <div className="border-t mt-auto">
              {/* New project */}
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-3 w-full px-4 min-h-[44px] text-sm text-foreground/80 hover:bg-accent/50 active:bg-accent transition-colors"
              >
                <Plus className="h-4 w-4 text-muted-foreground" />
                {t('sidebar.createProject')}
              </button>

              <Separator />

              {/* Terminal */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  navigate('/terminal')
                }}
                className="flex items-center gap-3 w-full px-4 min-h-[44px] text-sm text-foreground/80 hover:bg-accent/50 active:bg-accent transition-colors"
              >
                <TerminalSquare className="h-4 w-4 text-muted-foreground" />
                {t('terminal.title')}
              </button>

              <Separator />

              {/* Language */}
              <button
                type="button"
                onClick={() => setLangExpanded((v) => !v)}
                className="flex items-center gap-3 w-full px-4 min-h-[44px] text-sm text-foreground/80 hover:bg-accent/50 active:bg-accent transition-colors"
              >
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span>{t('language.switchLanguage')}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {currentLang.label}
                </span>
              </button>
              {langExpanded ? (
                <div className="bg-accent/20 px-4">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.id}
                      type="button"
                      onClick={() => {
                        i18n.changeLanguage(lang.id)
                        setLangExpanded(false)
                      }}
                      className={`flex items-center gap-3 w-full pl-7 min-h-[40px] text-sm transition-colors hover:bg-accent/50 active:bg-accent ${
                        lang.id === i18n.language
                          ? 'text-primary font-medium'
                          : 'text-foreground/70'
                      }`}
                    >
                      {lang.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Theme */}
              <button
                type="button"
                onClick={toggle}
                className="flex items-center gap-3 w-full px-4 min-h-[44px] text-sm text-foreground/80 hover:bg-accent/50 active:bg-accent transition-colors"
              >
                {resolved === 'dark' ? (
                  <Sun className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Moon className="h-4 w-4 text-muted-foreground" />
                )}
                {resolved === 'dark'
                  ? t('theme.switchToLight')
                  : t('theme.switchToDark')}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <CreateProjectDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={handleProjectCreated}
      />
    </>
  )
}
