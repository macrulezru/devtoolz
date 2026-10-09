import { defineAsyncComponent, type Component } from 'vue'

export interface ModuleView {
  icon: string
  component: Component
}

export const MODULE_VIEWS: Record<string, ModuleView> = {
  checks: {
    icon: 'search',
    component: defineAsyncComponent(() => import('./checks/ChecksPage.vue')),
  },
  cleanup: {
    icon: 'trash',
    component: defineAsyncComponent(() => import('./cleanup/CleanupPage.vue')),
  },
}

export const PLANNED_ICONS: Record<string, string> = {}

export function iconFor(id: string): string {
  return MODULE_VIEWS[id]?.icon ?? PLANNED_ICONS[id] ?? 'layers'
}
