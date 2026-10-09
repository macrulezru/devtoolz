<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api, watchJob, type ModuleInfo, type StatusInfo } from '../../api'
import FolderBrowser from '../../components/FolderBrowser.vue'
import Icon from '../../components/Icon.vue'
import ChecksOverview from './ChecksOverview.vue'
import CyclesView from './CyclesView.vue'
import FindingsList from './FindingsList.vue'
import SourceModal from './SourceModal.vue'
import {
  defaultOptions,
  type CheckFinding,
  type CheckInfo,
  type CheckOutcome,
  type OptionValues,
} from './types'

const props = defineProps<{ module: ModuleInfo; status: StatusInfo | undefined }>()

const PROJECT_KEY = 'devtoolz-ui.checks-project'
const CHECK_KEY = 'devtoolz-ui.checks-selected'
const OVERVIEW = 'overview'

const checks = ref<CheckInfo[]>([])
const selectedId = ref('')
const project = ref('')
const options = ref<Record<string, OptionValues>>({})
const outcomes = ref<Record<string, CheckOutcome>>({})
const running = ref('')
const failure = ref('')
const browsing = ref(false)
const query = ref('')
const codeFilter = ref('')
const viewing = ref<number | null>(null)
const peek = ref<CheckFinding[] | null>(null)
const optionsOpen = ref(false)
const runningAll = ref(false)
const allProgress = ref({ done: 0, total: 0, current: '' })
const overviewMs = ref<number>()
let stop: (() => void) | undefined

const isOverview = computed(() => selectedId.value === OVERVIEW)
const selected = computed(() => checks.value.find((check) => check.id === selectedId.value))
const outcome = computed(() => outcomes.value[selectedId.value])
const filtered = computed<CheckFinding[]>(() => {
  const found = outcome.value?.findings ?? []
  const text = query.value.trim().toLowerCase()
  return found.filter(
    (finding) =>
      (codeFilter.value === '' || finding.code === codeFilter.value) &&
      (text === '' ||
        `${finding.file ?? ''} ${finding.message} ${finding.code}`.toLowerCase().includes(text)),
  )
})
const codes = computed(() => {
  const counts = new Map<string, { count: number; severity: string }>()
  for (const finding of outcome.value?.findings ?? []) {
    const entry = counts.get(finding.code)
    if (entry) entry.count += 1
    else counts.set(finding.code, { count: 1, severity: finding.severity })
  }
  return [...counts.entries()].map(([code, value]) => ({ code, ...value }))
})
const groups = computed(() => [
  { id: 'code', title: 'Code', items: checks.value.filter((check) => check.group === 'code') },
  {
    id: 'dependencies',
    title: 'Dependencies',
    items: checks.value.filter((check) => check.group === 'dependencies'),
  },
  {
    id: 'docs',
    title: 'Documentation',
    items: checks.value.filter((check) => check.group === 'docs'),
  },
])

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    return
  }
}

function recall(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function select(id: string): void {
  selectedId.value = id
  query.value = ''
  codeFilter.value = ''
  viewing.value = null
  remember(CHECK_KEY, id)
}

function setProject(paths: string[]): void {
  browsing.value = false
  const next = paths[0]
  if (!next || next === project.value) return
  project.value = next
  outcomes.value = {}
  overviewMs.value = undefined
  remember(PROJECT_KEY, next)
}

function countOf(id: string): number | undefined {
  return outcomes.value[id]?.findings.length
}

async function runAll(includeSlow: boolean): Promise<void> {
  if (runningAll.value || running.value) return
  stop?.()
  runningAll.value = true
  failure.value = ''
  allProgress.value = { done: 0, total: 0, current: '' }
  try {
    const { jobId } = await api.post<{ jobId: string }>('/api/checks/all/run', {
      project: project.value,
      includeSlow,
    })
    stop = watchJob<
      { done: number; total: number; current: string },
      { outcomes: Record<string, CheckOutcome>; tookMs: number }
    >(jobId, {
      onProgress: (data) => {
        allProgress.value = data
      },
      onDone: (data) => {
        outcomes.value = { ...outcomes.value, ...data.outcomes }
        overviewMs.value = data.tookMs
        runningAll.value = false
      },
      onFailed: (message) => {
        failure.value = message
        runningAll.value = false
      },
    })
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
    runningAll.value = false
  }
}

async function run(): Promise<void> {
  const check = selected.value
  if (!check || running.value) return
  stop?.()
  running.value = check.id
  failure.value = ''
  try {
    const { jobId } = await api.post<{ jobId: string }>(`/api/checks/${check.id}/run`, {
      project: project.value,
      options: options.value[check.id] ?? defaultOptions(check),
    })
    stop = watchJob<unknown, CheckOutcome>(jobId, {
      onDone: (data) => {
        outcomes.value = { ...outcomes.value, [check.id]: data }
        running.value = ''
        query.value = ''
        codeFilter.value = ''
      },
      onFailed: (message) => {
        failure.value = message
        running.value = ''
      },
    })
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
    running.value = ''
  }
}

function setFlag(key: string, value: boolean): void {
  const check = selected.value
  if (!check) return
  options.value = {
    ...options.value,
    [check.id]: { ...(options.value[check.id] ?? defaultOptions(check)), [key]: value },
  }
}

function setText(key: string, value: string): void {
  const check = selected.value
  if (!check) return
  options.value = {
    ...options.value,
    [check.id]: { ...(options.value[check.id] ?? defaultOptions(check)), [key]: value },
  }
}

function valueOf(key: string): boolean | string {
  const check = selected.value
  if (!check) return ''
  return (options.value[check.id] ?? defaultOptions(check))[key] ?? ''
}

function openFile(file: string): void {
  peek.value = [{ file, severity: 'info', code: 'file', message: file }]
}

function openCycle(finding: CheckFinding): void {
  if (finding.file) openFile(finding.file)
}

function open(finding: CheckFinding): void {
  const at = filtered.value.indexOf(finding)
  viewing.value = at >= 0 ? at : 0
}

onMounted(async () => {
  project.value = recall(PROJECT_KEY) || props.status?.cwd || ''
  try {
    checks.value = await api.get<CheckInfo[]>('/api/checks')
    const saved = recall(CHECK_KEY)
    selectedId.value =
      saved === OVERVIEW || checks.value.some((check) => check.id === saved) ? saved : OVERVIEW
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => stop?.())
</script>

<template>
  <div class="page">
    <header class="page__head">
      <h1>{{ module.title }}</h1>
      <p class="muted">{{ module.description }}</p>
      <p class="project">
        <Icon name="folder" :size="15" />
        <span class="muted">Project</span>
        <code :title="project">{{ project }}</code>
        <button class="btn btn--small" @click="browsing = true">Change…</button>
      </p>
    </header>

    <p v-if="failure && !selected" class="notice notice--error">{{ failure }}</p>

    <div v-if="checks.length" class="layout">
      <nav class="menu" aria-label="Checks">
        <button
          class="menu__item"
          :class="{ 'menu__item--on': isOverview }"
          :aria-current="isOverview ? 'page' : undefined"
          @click="select(OVERVIEW)"
        >
          <span class="menu__name">Overview</span>
        </button>
        <template v-for="group in groups" :key="group.id">
          <h3 v-if="group.items.length" class="menu__title">{{ group.title }}</h3>
          <button
            v-for="check in group.items"
            :key="check.id"
            class="menu__item"
            :class="{ 'menu__item--on': check.id === selectedId }"
            :aria-current="check.id === selectedId ? 'page' : undefined"
            @click="select(check.id)"
          >
            <span class="menu__name">{{ check.title }}</span>
            <span
              v-if="countOf(check.id) !== undefined"
              class="menu__count"
              :class="{ 'menu__count--clean': countOf(check.id) === 0 }"
              >{{ countOf(check.id) === 0 ? '✓' : countOf(check.id) }}</span
            >
          </button>
        </template>
      </nav>

      <main class="main">
        <p v-if="failure && isOverview" class="notice notice--error">{{ failure }}</p>
        <ChecksOverview
          v-if="isOverview"
          :checks="checks"
          :outcomes="outcomes"
          :running="runningAll"
          :progress="allProgress"
          :took-ms="overviewMs"
          @run-all="runAll"
          @open="select"
        />
        <template v-else-if="selected">
          <section class="card block">
            <div class="head">
              <div>
                <h2>{{ selected.title }}</h2>
                <p class="muted">{{ selected.description }}</p>
              </div>
              <button
                class="btn btn--primary"
                :disabled="running !== '' || project === ''"
                @click="run"
              >
                <Icon name="play" :size="15" />
                {{ running === selected.id ? 'Checking…' : outcome ? 'Run again' : 'Run check' }}
              </button>
            </div>

            <button class="link" @click="optionsOpen = !optionsOpen">
              {{ optionsOpen ? 'Hide' : 'Show' }} options
            </button>
            <div v-if="optionsOpen" class="options">
              <template v-for="option in selected.options" :key="option.key">
                <label v-if="option.type === 'boolean'" class="check">
                  <input
                    type="checkbox"
                    :checked="valueOf(option.key) === true"
                    @change="setFlag(option.key, ($event.target as HTMLInputElement).checked)"
                  />
                  <span>
                    {{ option.label }}
                    <small class="muted"> — {{ option.help }}</small>
                  </span>
                </label>
                <label v-else class="field">
                  <span
                    >{{ option.label }} <small class="muted">— {{ option.help }}</small></span
                  >
                  <textarea
                    class="textarea"
                    rows="3"
                    spellcheck="false"
                    :value="String(valueOf(option.key))"
                    @input="setText(option.key, ($event.target as HTMLTextAreaElement).value)"
                  />
                </label>
              </template>
            </div>
          </section>

          <p v-if="failure" class="notice notice--error">{{ failure }}</p>

          <section v-if="running === selected.id" class="card block" role="status">
            <p class="muted">Scanning the project…</p>
          </section>

          <section v-else-if="outcome" class="card block">
            <div class="head">
              <div>
                <h2>{{ outcome.summary }}</h2>
                <p class="muted small">
                  {{ (outcome.tookMs / 1000).toFixed(1) }} s
                  <template v-if="outcome.filesScanned !== undefined">
                    · {{ outcome.filesScanned }} files scanned</template
                  >
                </p>
              </div>
            </div>
            <p v-for="note in outcome.notes ?? []" :key="note" class="notice notice--warn">
              {{ note }}
            </p>
            <p v-if="outcome.error" class="notice notice--error">{{ outcome.error }}</p>

            <p v-if="outcome.findings.length === 0 && !outcome.error" class="clean">
              <Icon name="check" :size="18" /> Nothing to report. This check is clean.
            </p>

            <CyclesView
              v-if="selected.id === 'circular-imports' && outcome.findings.length"
              :findings="outcome.findings"
              @open-file="openFile"
              @open="openCycle"
            />
            <template v-else-if="outcome.findings.length">
              <div class="filters">
                <input
                  v-model="query"
                  class="input search"
                  placeholder="Filter by file or text"
                  aria-label="Filter findings"
                />
                <div class="chips">
                  <button
                    class="chip"
                    :class="{ 'chip--on': codeFilter === '' }"
                    @click="codeFilter = ''"
                  >
                    all {{ outcome.findings.length }}
                  </button>
                  <button
                    v-for="item in codes"
                    :key="item.code"
                    class="chip"
                    :class="[`chip--${item.severity}`, { 'chip--on': codeFilter === item.code }]"
                    @click="codeFilter = codeFilter === item.code ? '' : item.code"
                  >
                    {{ item.code }} {{ item.count }}
                  </button>
                </div>
              </div>
              <p v-if="filtered.length === 0" class="muted">No findings match the filter.</p>
              <FindingsList v-else :findings="filtered" @open="open" />
            </template>
          </section>

          <section v-else-if="!running" class="card block empty">
            <p class="muted">Press “Run check” to scan the project.</p>
          </section>
        </template>
      </main>
    </div>

    <SourceModal v-if="peek" :index="0" :project="project" :findings="peek" @close="peek = null" />

    <SourceModal
      v-if="viewing !== null && filtered.length"
      v-model:index="viewing"
      :project="project"
      :findings="filtered"
      @close="viewing = null"
    />

    <FolderBrowser
      v-if="browsing"
      :start="project || status?.cwd || ''"
      title="Choose the project folder"
      @close="browsing = false"
      @confirm="setProject"
    />
  </div>
</template>

<style scoped lang="scss">
.page {
  @include stack($space-4);
  padding: 28px 28px 60px;

  @include respond-below(md) {
    padding: 18px 14px 40px;
  }

  &__head p {
    margin-top: $space-1;
  }
}

.project {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: $space-2;
  margin-top: $space-2;
  font-size: $font-size-sm;

  code {
    padding: 2px 8px;
    border-radius: $radius-sm;
    background: var(--surface-2);
    word-break: break-all;
  }
}

.layout {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  gap: $space-5;
  align-items: start;

  @include respond-below(md) {
    grid-template-columns: 1fr;
  }
}

.menu {
  @include stack(2px);

  &__title {
    @include eyebrow;
    margin: $space-3 0 $space-1 $space-2;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: $space-2;
    padding: 9px 10px;
    border: 0;
    border-radius: $radius-md;
    background: transparent;
    text-align: left;
    cursor: pointer;
    @include hover-fill;
    @include focus-ring;

    &--on {
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 600;
    }
  }

  &__name {
    flex: 1;
  }

  &__count {
    padding: 0 8px;
    border-radius: $radius-pill;
    background: var(--warn-soft);
    color: var(--warn);
    font-size: $font-size-xs;
    font-weight: 600;

    &--clean {
      background: color-mix(in srgb, var(--ok) 18%, transparent);
      color: var(--ok);
    }
  }
}

.main {
  @include stack($space-4);
  min-width: 0;
}

.block {
  @include stack($space-3);
  padding: 18px;
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: $space-3;
}

.small {
  font-size: $font-size-sm;
}

.link {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  @include focus-ring;
}

.options {
  @include stack($space-3);
}

.textarea {
  padding: $space-2 $space-3;
  border: 1px solid var(--border);
  border-radius: $radius-md;
  background: var(--surface);
  font-family: $font-mono;
  font-size: $font-size-sm;
  @include focus-ring;
}

.filters {
  @include stack($space-2);
}

.search {
  max-width: 420px;
}

.chips {
  @include cluster;
}

.chip {
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: $radius-pill;
  background: var(--surface);
  font-size: $font-size-sm;
  cursor: pointer;
  @include focus-ring;

  &--on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
}

.clean {
  display: flex;
  align-items: center;
  gap: $space-2;
  color: var(--ok);
  font-weight: 600;
}

.empty {
  text-align: center;
}
</style>
