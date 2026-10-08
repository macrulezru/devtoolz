<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../../components/Icon.vue'
import type { CheckInfo, CheckOutcome } from './types'

const props = defineProps<{
  checks: CheckInfo[]
  outcomes: Record<string, CheckOutcome>
  running: boolean
  progress: { done: number; total: number; current: string }
  tookMs: number | undefined
}>()
const emit = defineEmits<{ 'run-all': [includeSlow: boolean]; open: [id: string] }>()

const includeSlow = ref(false)

const GROUPS = [
  { id: 'code', title: 'Code' },
  { id: 'dependencies', title: 'Dependencies' },
  { id: 'docs', title: 'Documentation' },
] as const

const slowNames = computed(() =>
  props.checks.filter((check) => check.slow).map((check) => check.title),
)
const grouped = computed(() =>
  GROUPS.map((group) => ({
    ...group,
    items: props.checks.filter((check) => check.group === group.id),
  })).filter((group) => group.items.length > 0),
)
const percent = computed(() =>
  props.progress.total > 0 ? Math.round((props.progress.done / props.progress.total) * 100) : 0,
)
const ran = computed(() => props.checks.filter((check) => props.outcomes[check.id]))
const clean = computed(
  () =>
    ran.value.filter((check) => {
      const outcome = props.outcomes[check.id]
      return outcome && outcome.findings.length === 0 && !outcome.error
    }).length,
)
const totals = computed(() => {
  const sum = { error: 0, warning: 0, info: 0 }
  for (const check of ran.value) {
    for (const finding of props.outcomes[check.id]?.findings ?? []) sum[finding.severity] += 1
  }
  return sum
})
const total = computed(() => totals.value.error + totals.value.warning + totals.value.info)

function breakdown(id: string): { error: number; warning: number; info: number } {
  const sum = { error: 0, warning: 0, info: 0 }
  for (const finding of props.outcomes[id]?.findings ?? []) sum[finding.severity] += 1
  return sum
}

function state(id: string): 'idle' | 'clean' | 'found' | 'broken' {
  const outcome = props.outcomes[id]
  if (!outcome) return 'idle'
  if (outcome.error) return 'broken'
  return outcome.findings.length === 0 ? 'clean' : 'found'
}
</script>

<template>
  <div class="overview">
    <section class="card block">
      <div class="head">
        <div>
          <h2>Project health</h2>
          <p v-if="ran.length" class="muted">
            <strong>{{ clean }} of {{ ran.length }}</strong> checks are clean ·
            <strong>{{ total }}</strong> finding{{ total === 1 ? '' : 's' }}
            <template v-if="tookMs !== undefined"> · {{ (tookMs / 1000).toFixed(1) }} s</template>
          </p>
          <p v-else class="muted">Run every check at once to see where the project stands.</p>
        </div>
        <button class="btn btn--primary" :disabled="running" @click="emit('run-all', includeSlow)">
          <Icon name="play" :size="15" />
          {{ running ? 'Checking…' : ran.length ? 'Run all again' : 'Run all checks' }}
        </button>
      </div>

      <label v-if="slowNames.length" class="check">
        <input v-model="includeSlow" type="checkbox" :disabled="running" />
        <span>
          Include the slow check ({{ slowNames.join(', ') }})
          <small class="muted"> — it type-checks the whole project</small>
        </span>
      </label>

      <div v-if="running" class="progress-wrap" role="status">
        <div class="progress"><div class="progress__bar" :style="{ width: `${percent}%` }" /></div>
        <span class="muted small">
          {{ progress.done }} of {{ progress.total }}
          <template v-if="progress.current"> · {{ progress.current }}</template>
        </span>
      </div>

      <div v-if="ran.length" class="chips">
        <span v-if="totals.error" class="sev sev--error"
          >{{ totals.error }} error{{ totals.error === 1 ? '' : 's' }}</span
        >
        <span v-if="totals.warning" class="sev sev--warning"
          >{{ totals.warning }} warning{{ totals.warning === 1 ? '' : 's' }}</span
        >
        <span v-if="totals.info" class="sev"
          >{{ totals.info }} note{{ totals.info === 1 ? '' : 's' }}</span
        >
        <span v-if="total === 0" class="sev sev--ok">Everything is clean</span>
      </div>
    </section>

    <section v-for="group in grouped" :key="group.id" class="group">
      <h3 class="group__title">{{ group.title }}</h3>
      <div class="cards">
        <button
          v-for="check in group.items"
          :key="check.id"
          class="tile"
          :class="`tile--${state(check.id)}`"
          @click="emit('open', check.id)"
        >
          <span class="tile__top">
            <strong>{{ check.title }}</strong>
            <span class="tile__state">
              <template v-if="state(check.id) === 'idle'">not run</template>
              <template v-else-if="state(check.id) === 'clean'">✓ clean</template>
              <template v-else-if="state(check.id) === 'broken'">couldn’t run</template>
              <template v-else>{{ outcomes[check.id]?.findings.length }}</template>
            </span>
          </span>
          <span class="tile__text muted">{{
            outcomes[check.id]?.summary ?? check.description
          }}</span>
          <span v-if="state(check.id) === 'found'" class="tile__sev">
            <span v-if="breakdown(check.id).error" class="sev sev--error"
              >{{ breakdown(check.id).error }} error</span
            >
            <span v-if="breakdown(check.id).warning" class="sev sev--warning"
              >{{ breakdown(check.id).warning }} warning</span
            >
            <span v-if="breakdown(check.id).info" class="sev"
              >{{ breakdown(check.id).info }} note</span
            >
          </span>
          <span v-if="check.slow && state(check.id) === 'idle'" class="tile__slow muted">slow</span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.overview {
  @include stack($space-4);
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

.progress-wrap {
  @include stack($space-2);
}

.progress {
  height: $space-2;
  overflow: hidden;
  border-radius: $radius-pill;
  background: var(--surface-2);

  &__bar {
    height: 100%;
    background: var(--accent);
    transition: width $transition-fast;
  }
}

.chips {
  @include cluster;
}

.sev {
  padding: 2px 10px;
  border-radius: $radius-pill;
  background: var(--surface-2);
  font-size: $font-size-sm;

  &--error {
    background: var(--danger-soft);
    color: var(--danger);
  }

  &--warning {
    background: var(--warn-soft);
    color: var(--warn);
  }

  &--ok {
    background: color-mix(in srgb, var(--ok) 18%, transparent);
    color: var(--ok);
  }
}

.group {
  @include stack($space-2);

  &__title {
    @include eyebrow;
  }
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: $space-3;
}

.tile {
  @include stack($space-2);
  @include surface;
  padding: $space-3 $space-4;
  text-align: left;
  cursor: pointer;
  transition: border-color $transition-fast;
  @include focus-ring;

  &:hover {
    border-color: var(--accent);
  }

  &--clean {
    border-left: 3px solid var(--ok);
  }

  &--found {
    border-left: 3px solid var(--warn);
  }

  &--broken {
    border-left: 3px solid var(--danger);
  }

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: $space-2;
  }

  &__state {
    color: var(--muted);
    font-size: $font-size-sm;
    font-weight: 600;
  }

  &--clean &__state {
    color: var(--ok);
  }

  &--found &__state {
    color: var(--warn);
  }

  &--broken &__state {
    color: var(--danger);
  }

  &__text {
    font-size: $font-size-sm;
  }

  &__sev {
    @include cluster($space-1);
  }

  &__slow {
    font-size: $font-size-xs;
  }
}
</style>
