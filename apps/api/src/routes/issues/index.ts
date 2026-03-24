import { createOpenAPIRouter } from '@/openapi/hono'
import attachments from './attachments'
import changes from './changes'
import command from './command'
import create from './create'
import del from './delete'
import duplicate from './duplicate'
import exportRoute from './export'
import logs from './logs'
import message from './message'
import query from './query'
import title from './title'
import update from './update'

const issues = createOpenAPIRouter()
issues.route('/', query)
issues.route('/', create)
issues.route('/', update)
issues.route('/', del)
issues.route('/', duplicate)
issues.route('/', exportRoute)
issues.route('/', title)
issues.route('/', command)
issues.route('/', message)
issues.route('/', attachments)
issues.route('/', logs)
issues.route('/', changes)

export default issues
