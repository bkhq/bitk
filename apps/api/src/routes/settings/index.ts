import { Hono } from 'hono'
import cleanup from './cleanup'
import general from './general'
import recycleBin from './recycle-bin'
import systemLogs from './system-logs'

const settings = new Hono()

settings.route('/', general)
settings.route('/', systemLogs)
settings.route('/', recycleBin)
settings.route('/', cleanup)

export default settings
