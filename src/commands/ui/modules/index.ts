import type { UiModule } from '../http.js'
import { checksModule } from './checks.js'
import { cleanupModule } from './cleanup.js'
import { imageBatchModule } from './image-batch.js'
import { imageHashModule } from './image-hash.js'

export const UI_MODULES: UiModule[] = [
  checksModule,
  cleanupModule,
  imageHashModule,
  imageBatchModule,
]
