<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api, watchJob, type ModuleInfo, type StatusInfo } from '../../api'
import FolderBrowser from '../../components/FolderBrowser.vue'
import Icon from '../../components/Icon.vue'
import UiSegmented from '../../ui-components/UiSegmented.vue'
import DiffView from './DiffView.vue'

const props = defineProps<{ module: ModuleInfo; status: StatusInfo | undefined }>()

interface ToolOption {
  key: string
  label: string
  type: 'boolean' | 'list'
  default: boolean | string
  help: string
}

interface Tool {
  id: string
  title: string
  description: string
  verb: string
  options: ToolOption[]
}

interface ScanFile {
  file: string
  count: number
  diff?: string
  hash: string
}

interface ScanResult {
  tool: string
  project: string
  filesScanned: number
  files: ScanFile[]
  skipped: { file: string; line: number; column: number; snippet: string; reason: string }[]
  total: number
  tookMs: number
}

interface ApplyResult {
  file: string
  status: 'applied' | 'changed' | 'unchanged' | 'refused' | 'error'
  count?: number
  message?: string
}

interface HistoryRow {
  dir: string
  name: string
  tool: string
  files: number
  createdAt: string
}

const PROJECT_KEY = 'devtoolz-ui.checks-project'
const PAGE = 40
const REASONS: Record<string, string> = {
  'embedded-in-expression': 'inside a larger expression',
  'braceless-body': 'the only statement of an if/loop without braces',
}

const tools = ref<Tool[]>([])
const toolId = ref('strip-comments')
const project = ref('')
const options = ref<Record<string, Record<string, boolean | string>>>({})
const optionsOpen = ref(false)
const browsing = ref(false)
const scanning = ref(false)
const applying = ref(false)
const scan = ref<ScanResult>()
const picked = ref<Set<string>>(new Set())
const expanded = ref<Set<string>>(new Set())
const done = ref<Set<string>>(new Set())
const query = ref('')
const failure = ref('')
const note = ref('')
const results = ref<ApplyResult[]>([])
const lastBackup = ref('')
const history = ref<HistoryRow[]>([])
const shown = ref(PAGE)
let stop: (() => void) | undefined

const tool = computed(() => tools.value.find((item) => item.id === toolId.value))
const files = computed(() => {
  const text = query.value.trim().toLowerCase()
  return (scan.value?.files ?? []).filter(
    (file) => text === '' || file.file.toLowerCase().includes(text),
  )
})
const visible = computed(() => files.value.slice(0, shown.value))
const pickedCount = computed(() => picked.value.size)
const pickedRemovals = computed(() =>
  (scan.value?.files ?? [])
    .filter((file) => picked.value.has(file.file))
    .reduce((sum, file) => sum + file.count, 0),
)

function remember(value: string): void {
  try {
    localStorage.setItem(PROJECT_KEY, value)
  } catch {
    return
  }
}

function recall(): string {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? ''
  } catch {
    return ''
  }
}

function currentOptions(): Record<string, boolean | string> {
  const current = tool.value
  if (!current) return {}
  const defaults = Object.fromEntries(current.options.map((option) => [option.key, option.default]))
  return { ...defaults, ...(options.value[current.id] ?? {}) }
}

function setOption(key: string, value: boolean | string): void {
  options.value = { ...options.value, [toolId.value]: { ...currentOptions(), [key]: value } }
}

function langOf(file: string): string {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'ts') return 'ts'
  if (ext === 'tsx') return 'tsx'
  if (ext === 'vue') return 'vue'
  if (ext === 'jsx') return 'jsx'
  return 'js'
}

function stats(diff: string | undefined): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of (diff ?? '').split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1
  }
  return { added, removed }
}

function togglePicked(file: string): void {
  const next = new Set(picked.value)
  if (next.has(file)) next.delete(file)
  else next.add(file)
  picked.value = next
}

function toggleExpanded(file: string): void {
  const next = new Set(expanded.value)
  if (next.has(file)) next.delete(file)
  else next.add(file)
  expanded.value = next
}

function selectAll(): void {
  picked.value = new Set(
    files.value.filter((file) => !done.value.has(file.file)).map((file) => file.file),
  )
}

function selectNone(): void {
  picked.value = new Set()
}

function setProject(paths: string[]): void {
  browsing.value = false
  const next = paths[0]
  if (!next || next === project.value) return
  project.value = next
  remember(next)
  reset()
  void loadHistory()
}

function reset(): void {
  scan.value = undefined
  picked.value = new Set()
  expanded.value = new Set()
  done.value = new Set()
  results.value = []
  lastBackup.value = ''
  note.value = ''
  failure.value = ''
}

function chooseTool(id: string): void {
  toolId.value = id
  reset()
}

async function runScan(): Promise<void> {
  if (scanning.value) return
  stop?.()
  reset()
  scanning.value = true
  shown.value = PAGE
  try {
    const { jobId } = await api.post<{ jobId: string }>(`/api/cleanup/${toolId.value}/scan`, {
      project: project.value,
      options: currentOptions(),
    })
    stop = watchJob<unknown, ScanResult>(jobId, {
      onDone: (data) => {
        scan.value = data
        scanning.value = false
      },
      onFailed: (message) => {
        failure.value = message
        scanning.value = false
      },
    })
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
    scanning.value = false
  }
}

async function loadHistory(): Promise<void> {
  try {
    const found = await api.get<{ backups: HistoryRow[] }>(
      `/api/cleanup/history?project=${encodeURIComponent(project.value)}`,
    )
    history.value = found.backups
  } catch {
    history.value = []
  }
}

async function apply(): Promise<void> {
  const current = scan.value
  if (!current || pickedCount.value === 0 || applying.value) return
  const sure = window.confirm(
    `Change ${pickedCount.value} file${pickedCount.value === 1 ? '' : 's'}? ` +
      `${pickedRemovals.value} ${tool.value?.verb ?? 'item'}${pickedRemovals.value === 1 ? '' : 's'} will be removed. ` +
      'A backup is saved first, and you can undo this afterwards.',
  )
  if (!sure) return
  applying.value = true
  failure.value = ''
  try {
    const chosen = current.files.filter((file) => picked.value.has(file.file))
    const response = await api.post<{ results: ApplyResult[]; backupDir?: string }>(
      `/api/cleanup/${toolId.value}/apply`,
      {
        project: project.value,
        options: currentOptions(),
        files: chosen.map((file) => ({ file: file.file, hash: file.hash })),
      },
    )
    results.value = response.results
    lastBackup.value = response.backupDir ?? ''
    const applied = response.results
      .filter((item) => item.status === 'applied')
      .map((item) => item.file)
    done.value = new Set([...done.value, ...applied])
    picked.value = new Set([...picked.value].filter((file) => !applied.includes(file)))
    note.value = `${applied.length} file${applied.length === 1 ? '' : 's'} changed.`
    await loadHistory()
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
  } finally {
    applying.value = false
  }
}

async function undo(dir: string): Promise<void> {
  if (!window.confirm('Put the files back as they were before this cleanup?')) return
  try {
    const report = await api.post<{ counts: Record<string, number> }>('/api/cleanup/undo', {
      project: project.value,
      dir,
    })
    const restored = report.counts.restored ?? 0
    const modified = report.counts.modified ?? 0
    note.value =
      `Restored ${restored} file${restored === 1 ? '' : 's'}.` +
      (modified ? ` ${modified} changed since and were left alone.` : '')
    if (dir === lastBackup.value) {
      lastBackup.value = ''
      results.value = []
      done.value = new Set()
    }
    await loadHistory()
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
  }
}

function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

onMounted(async () => {
  project.value = recall() || props.status?.cwd || ''
  try {
    tools.value = await api.get<Tool[]>('/api/cleanup/tools')
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
  }
  await loadHistory()
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

    <section v-if="tool" class="card block">
      <div class="head">
        <UiSegmented
          :model-value="toolId"
          label="What to remove"
          :options="tools.map((item) => ({ value: item.id, label: item.title }))"
          @update:model-value="chooseTool"
        />
        <button
          class="btn btn--primary"
          :disabled="scanning || applying || project === ''"
          @click="runScan"
        >
          <Icon name="search" :size="15" />
          {{ scanning ? 'Scanning…' : scan ? 'Scan again' : 'Scan the project' }}
        </button>
      </div>
      <p class="muted">
        {{ tool.description }} Nothing is changed until you choose the files and confirm.
      </p>

      <button class="link" @click="optionsOpen = !optionsOpen">
        {{ optionsOpen ? 'Hide' : 'Show' }} options
      </button>
      <div v-if="optionsOpen" class="options">
        <template v-for="option in tool.options" :key="option.key">
          <label v-if="option.type === 'boolean'" class="check">
            <input
              type="checkbox"
              :checked="currentOptions()[option.key] === true"
              @change="setOption(option.key, ($event.target as HTMLInputElement).checked)"
            />
            <span
              >{{ option.label }} <small class="muted">— {{ option.help }}</small></span
            >
          </label>
          <label v-else class="field">
            <span
              >{{ option.label }} <small class="muted">— {{ option.help }}</small></span
            >
            <textarea
              class="textarea"
              rows="3"
              spellcheck="false"
              :value="String(currentOptions()[option.key] ?? '')"
              @input="setOption(option.key, ($event.target as HTMLTextAreaElement).value)"
            />
          </label>
        </template>
      </div>
    </section>

    <p v-if="failure" class="notice notice--error">{{ failure }}</p>
    <p v-if="note" class="notice">{{ note }}</p>

    <section v-if="lastBackup || results.length" class="card block">
      <h2>Result</h2>
      <ul class="results">
        <li
          v-for="item in results"
          :key="item.file"
          class="result"
          :class="`result--${item.status}`"
        >
          <code>{{ item.file }}</code>
          <span class="muted">
            <template v-if="item.status === 'applied'">changed, {{ item.count }} removed</template>
            <template v-else>{{ item.message ?? item.status }}</template>
          </span>
        </li>
      </ul>
      <div v-if="lastBackup" class="actions">
        <button class="btn" @click="undo(lastBackup)">Undo this cleanup</button>
      </div>
    </section>

    <section v-if="scanning" class="card block" role="status">
      <p class="muted">Scanning the project…</p>
    </section>

    <section v-else-if="scan" class="card block">
      <div class="head">
        <div>
          <h2>
            <template v-if="scan.files.length === 0">Nothing to remove</template>
            <template v-else>
              {{ scan.total }} {{ tool?.verb }}{{ scan.total === 1 ? '' : 's' }} in
              {{ scan.files.length }} file{{ scan.files.length === 1 ? '' : 's' }}
            </template>
          </h2>
          <p class="muted small">
            {{ scan.filesScanned }} files scanned · {{ (scan.tookMs / 1000).toFixed(1) }} s
          </p>
        </div>
      </div>

      <div v-if="scan.skipped.length" class="notice notice--warn">
        <strong
          >{{ scan.skipped.length }} call{{ scan.skipped.length === 1 ? '' : 's' }} left
          alone</strong
        >, because removing them is not safe:
        <ul class="skipped">
          <li v-for="(item, index) in scan.skipped" :key="index">
            <code>{{ item.file }}:{{ item.line }}</code> — {{ REASONS[item.reason] ?? item.reason }}
          </li>
        </ul>
      </div>

      <template v-if="scan.files.length">
        <div class="toolbar">
          <input
            v-model="query"
            class="input search"
            placeholder="Filter files"
            aria-label="Filter files"
          />
          <button class="btn btn--small" @click="selectAll">Select all</button>
          <button class="btn btn--small" @click="selectNone">Select none</button>
          <span class="spacer" />
          <button class="btn btn--primary" :disabled="pickedCount === 0 || applying" @click="apply">
            {{
              applying ? 'Changing…' : `Change ${pickedCount} file${pickedCount === 1 ? '' : 's'}`
            }}
          </button>
        </div>

        <ul class="files">
          <li
            v-for="file in visible"
            :key="file.file"
            class="file"
            :class="{ 'file--done': done.has(file.file) }"
          >
            <div class="file__row">
              <input
                type="checkbox"
                :checked="picked.has(file.file)"
                :disabled="done.has(file.file)"
                :aria-label="`Change ${file.file}`"
                @change="togglePicked(file.file)"
              />
              <button
                class="file__main"
                :aria-expanded="expanded.has(file.file)"
                @click="toggleExpanded(file.file)"
              >
                <span class="file__caret" :class="{ 'file__caret--open': expanded.has(file.file) }"
                  >▸</span
                >
                <code class="file__name">{{ file.file }}</code>
                <span class="file__count"
                  >{{ file.count }} {{ tool?.verb }}{{ file.count === 1 ? '' : 's' }}</span
                >
                <span class="file__stat file__stat--del">−{{ stats(file.diff).removed }}</span>
                <span v-if="stats(file.diff).added" class="file__stat file__stat--add"
                  >+{{ stats(file.diff).added }}</span
                >
                <span v-if="done.has(file.file)" class="file__done">✓ changed</span>
              </button>
            </div>
            <DiffView
              v-if="expanded.has(file.file) && file.diff"
              :diff="file.diff"
              :lang="langOf(file.file)"
            />
          </li>
        </ul>
        <div v-if="shown < files.length" class="actions">
          <button class="btn" @click="shown += PAGE">
            Show more ({{ files.length - shown }} left)
          </button>
          <button class="btn" @click="shown = files.length">Show all</button>
        </div>
      </template>
    </section>

    <section v-if="history.length" class="card block">
      <h2>Recent cleanups</h2>
      <ul class="history">
        <li v-for="row in history" :key="row.dir" class="history__row">
          <span>
            <strong>{{ tools.find((item) => item.id === row.tool)?.title ?? row.tool }}</strong>
            <span class="muted">
              · {{ row.files }} file{{ row.files === 1 ? '' : 's' }} ·
              {{ when(row.createdAt) }}</span
            >
          </span>
          <button class="btn btn--small" @click="undo(row.dir)">Undo</button>
        </li>
      </ul>
    </section>

    <FolderBrowser
      v-if="browsing"
      :start="project || status?.cwd || ''"
      mode="folder"
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

.toolbar {
  @include cluster;
}

.search {
  width: 260px;
}

.spacer {
  flex: 1;
}

.actions {
  @include cluster;
  justify-content: center;
}

.skipped {
  margin: $space-2 0 0;
  padding-left: $space-5;
  font-size: $font-size-sm;
}

.files {
  @include stack($space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.file {
  @include stack($space-2);
  padding: $space-1 $space-3 $space-2;
  border: 1px solid var(--border);
  border-radius: $radius-md;

  &--done {
    opacity: 0.6;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: $space-3;
  }

  &__main {
    display: flex;
    flex: 1;
    align-items: center;
    gap: $space-2;
    min-width: 0;
    padding: $space-2 0;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
    @include focus-ring;
  }

  &__caret {
    flex: none;
    color: var(--muted);
    transition: transform $transition-fast;

    &--open {
      transform: rotate(90deg);
    }
  }

  &__name {
    flex: 1;
    min-width: 0;
    font-size: $font-size-sm;
    @include truncate;
  }

  &__count {
    flex: none;
    color: var(--muted);
    font-size: $font-size-sm;
  }

  &__stat {
    flex: none;
    font-family: $font-mono;
    font-size: $font-size-xs;

    &--del {
      color: var(--danger);
    }

    &--add {
      color: var(--ok);
    }
  }

  &__done {
    flex: none;
    color: var(--ok);
    font-size: $font-size-sm;
  }
}

.results {
  @include stack($space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.result {
  display: flex;
  gap: $space-3;
  font-size: $font-size-sm;

  &--changed,
  &--error,
  &--refused {
    color: var(--danger);
  }
}

.history {
  @include stack($space-2);
  margin: 0;
  padding: 0;
  list-style: none;

  &__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: $space-3;
    padding: $space-2 $space-3;
    border: 1px solid var(--border);
    border-radius: $radius-md;
  }
}
</style>
