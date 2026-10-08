<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api } from '../../api'
import Icon from '../../components/Icon.vue'
import { useCopy } from '../../composables/useCopy'
import UiCode from '../../ui-components/UiCode.vue'
import UiModal from '../../ui-components/UiModal.vue'
import type { CheckFinding, SourceFile } from './types'

const props = defineProps<{
  project: string
  findings: CheckFinding[]
  index: number
}>()
const emit = defineEmits<{ close: []; 'update:index': [index: number] }>()

const { copied, copy } = useCopy()
const source = ref<SourceFile>()
const failure = ref('')
const loading = ref(false)
const cache = new Map<string, SourceFile>()

const finding = computed(() => props.findings[props.index] as CheckFinding)
const hasPrev = computed(() => props.index > 0)
const hasNext = computed(() => props.index < props.findings.length - 1)
const editorLink = computed(() => {
  if (!source.value) return ''
  const place = [source.value.abs.replace(/\\/g, '/')]
  if (finding.value.line) place.push(String(finding.value.line))
  if (finding.value.line && finding.value.column) place.push(String(finding.value.column))
  return `vscode://file/${place.join(':')}`
})

async function load(): Promise<void> {
  const file = finding.value.file
  failure.value = ''
  if (!file) {
    source.value = undefined
    return
  }
  const cached = cache.get(file)
  if (cached) {
    source.value = cached
    return
  }
  loading.value = true
  try {
    const result = await api.get<SourceFile>(
      `/api/source?project=${encodeURIComponent(props.project)}&path=${encodeURIComponent(file)}`,
    )
    cache.set(file, result)
    source.value = result
  } catch (error) {
    source.value = undefined
    failure.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

function go(step: number): void {
  const next = props.index + step
  if (next >= 0 && next < props.findings.length) emit('update:index', next)
}

function onKey(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement) return
  if (event.key === 'ArrowLeft') go(-1)
  if (event.key === 'ArrowRight') go(1)
}

watch(() => props.index, load, { immediate: true })
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <UiModal :title="finding.file ?? 'Project'" width="1100px" @close="emit('close')">
    <template #actions>
      <span class="muted counter">{{ index + 1 }} / {{ findings.length }}</span>
      <button
        class="btn btn--small"
        :disabled="!hasPrev"
        aria-label="Previous finding"
        @click="go(-1)"
      >
        <Icon name="left" :size="15" />
      </button>
      <button class="btn btn--small" :disabled="!hasNext" aria-label="Next finding" @click="go(1)">
        <Icon name="right" :size="15" />
      </button>
    </template>

    <div class="body">
      <div class="finding">
        <span class="badge" :class="`badge--${finding.severity}`">{{ finding.code }}</span>
        <strong>{{ finding.message }}</strong>
        <p v-if="finding.hint" class="muted">{{ finding.hint }}</p>
      </div>

      <p v-if="failure" class="notice notice--error">{{ failure }}</p>
      <p v-else-if="loading" class="muted">Loading…</p>
      <p v-else-if="!finding.file" class="muted">This finding is not tied to a source file.</p>
      <template v-else-if="source">
        <div class="bar">
          <code class="path">
            {{ source.path }}<template v-if="finding.line">:{{ finding.line }}</template>
          </code>
          <button class="btn btn--small" @click="copy('path', source.abs)">
            <Icon :name="copied === 'path' ? 'check' : 'copy'" :size="14" />
            {{ copied === 'path' ? 'Copied' : 'Copy path' }}
          </button>
          <a class="btn btn--small" :href="editorLink">
            <Icon name="external" :size="14" /> Open in VS Code
          </a>
        </div>
        <UiCode
          class="viewer"
          :text="source.text"
          :lang="source.lang"
          :focus-line="finding.line"
          :focus-column="finding.column"
        />
      </template>
    </div>
  </UiModal>
</template>

<style scoped lang="scss">
.counter {
  font-size: $font-size-sm;
}

.body {
  @include stack($space-3);
  padding: $space-4;
  min-height: 0;
}

.finding {
  @include stack($space-1);
}

.bar {
  @include cluster;
}

.path {
  flex: 1;
  min-width: 0;
  font-size: $font-size-sm;
  word-break: break-all;
}

.viewer {
  max-height: 58vh;
}

.badge {
  align-self: flex-start;
  padding: 1px 8px;
  border-radius: $radius-pill;
  background: var(--surface-2);
  font-size: $font-size-xs;
  text-transform: uppercase;
  letter-spacing: 0.03em;

  &--error {
    background: var(--danger-soft);
    color: var(--danger);
  }

  &--warning {
    background: var(--warn-soft);
    color: var(--warn);
  }
}

a.btn {
  text-decoration: none;
}
</style>
