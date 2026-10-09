import type { UiModule } from '../http.js'
import { checksModule } from './checks.js'
import { cleanupModule } from './cleanup.js'

export const UI_MODULES: UiModule[] = [checksModule, cleanupModule]
