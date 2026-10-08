<script setup lang="ts">
import { computed, ref } from 'vue'
import UiSegmented from '../../ui-components/UiSegmented.vue'
import CycleGraph, { type Cycle } from './CycleGraph.vue'
import FindingsList from './FindingsList.vue'
import type { CheckFinding } from './types'

const props = defineProps<{ findings: CheckFinding[] }>()
const emit = defineEmits<{ 'open-file': [file: string]; open: [finding: CheckFinding] }>()

const mode = ref<'graph' | 'list'>('graph')
const selected = ref<number | null>(null)

const cycles = computed<Cycle[]>(() =>
  props.findings
    .filter((finding) => finding.files && finding.files.length > 0)
    .map((finding, index) => ({
      id: index,
      files: finding.files as string[],
      typeOnly: finding.code === 'type-only',
    })),
)

function pick(id: number): void {
  selected.value = selected.value === id ? null : id
}

function chain(cycle: Cycle): string {
  return [
    ...cycle.files.map((file) => file.split('/').pop() ?? file),
    cycle.files[0]?.split('/').pop(),
  ].join(' → ')
}
</script>

<template>
  <div class="cycles">
    <UiSegmented
      v-model="mode"
      label="View"
      :options="[
        { value: 'graph', label: 'Graph' },
        { value: 'list', label: 'List' },
      ]"
    />

    <div v-if="mode === 'graph'" class="split">
      <CycleGraph
        :cycles="cycles"
        :selected="selected"
        @select-cycle="selected = $event"
        @open-file="emit('open-file', $event)"
      />
      <aside class="side" aria-label="Cycles">
        <h3 class="side__title">{{ cycles.length }} cycle{{ cycles.length === 1 ? '' : 's' }}</h3>
        <ul class="side__list">
          <li v-for="cycle in cycles" :key="cycle.id">
            <button
              class="cycle"
              :class="{ 'cycle--on': selected === cycle.id }"
              @click="pick(cycle.id)"
            >
              <span class="cycle__head">
                <strong>Cycle {{ cycle.id + 1 }}</strong>
                <span class="muted">{{ cycle.files.length }} files</span>
                <span v-if="cycle.typeOnly" class="cycle__tag">types only</span>
              </span>
              <span class="cycle__chain">{{ chain(cycle) }}</span>
            </button>
          </li>
        </ul>
      </aside>
    </div>

    <FindingsList v-else :findings="findings" @open="emit('open', $event)" />
  </div>
</template>

<style scoped lang="scss">
.cycles {
  @include stack($space-3);
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: $space-4;
  align-items: start;

  @include respond-below(lg) {
    grid-template-columns: 1fr;
  }
}

.side {
  @include stack($space-2);
  max-height: 600px;
  overflow-y: auto;

  &__title {
    @include eyebrow;
  }

  &__list {
    @include stack($space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
}

.cycle {
  @include stack(2px);
  width: 100%;
  padding: $space-2 $space-3;
  border: 1px solid var(--border);
  border-radius: $radius-md;
  background: var(--surface);
  text-align: left;
  cursor: pointer;
  @include focus-ring;

  &--on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  &__head {
    display: flex;
    align-items: center;
    gap: $space-2;
    font-size: $font-size-sm;
  }

  &__tag {
    padding: 0 8px;
    border-radius: $radius-pill;
    background: var(--surface-2);
    font-size: $font-size-xs;
  }

  &__chain {
    color: var(--muted);
    font-family: $font-mono;
    font-size: $font-size-xs;
    word-break: break-all;
  }
}
</style>
