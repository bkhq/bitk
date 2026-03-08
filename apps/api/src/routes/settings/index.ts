import { Hono } from 'hono'
import about from './about'
import cleanup from './cleanup'
import general from './general'
import recycleBin from './recycle-bin'
import systemLogs from './system-logs'
import upgrade from './upgrade'
import webhooksRoute from './webhooks'

const settings = new Hono()

settings.route('/', general)
settings.route('/', systemLogs)
settings.route('/', recycleBin)
settings.route('/', cleanup)
settings.route('/', about)
settings.route('/upgrade', upgrade)
settings.route('/', webhooksRoute)

export default settings
