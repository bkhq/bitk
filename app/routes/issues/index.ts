import { Hono } from 'hono'
import attachments from './attachments'
import changes from './changes'
import command from './command'
import create from './create'
import logs from './logs'
import message from './message'
import query from './query'
import title from './title'
import update from './update'

const issues = new Hono()
issues.route('/', query)
issues.route('/', create)
issues.route('/', update)
issues.route('/', title)
issues.route('/', command)
issues.route('/', message)
issues.route('/', attachments)
issues.route('/', logs)
issues.route('/', changes)

export default issues
