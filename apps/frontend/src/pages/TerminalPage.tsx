import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { TerminalView } from '@/components/terminal/TerminalView'

export default function TerminalPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <div className="flex flex-col h-dvh bg-[#1a1a2e]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 shrink-0">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="p-1.5 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          aria-label={t('terminal.back')}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-white/80">
          {t('terminal.title')}
        </span>
      </div>

      {/* Terminal */}
      <TerminalView className="flex-1 min-h-0 p-1" />
    </div>
  )
}
