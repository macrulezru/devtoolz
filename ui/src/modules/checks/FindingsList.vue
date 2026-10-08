<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CheckFinding } from './types'

const props = defineProps<{ findings: CheckFinding[] }>()
const emit = defineEmits<{ open: [finding: CheckFinding] }>()

interface Group {
  file: string
  items: CheckFinding[]
}

const PAGE = 40
const shownGroups = ref(PAGE)
const collapsed = ref<Set<string>>(new Set())

const groups = computed<Group[]>(() => {
  const map = new Map<string, CheckFinding[]>()
  for (const finding of props.findings) {
    const key = finding.file ?? 'Project'
    const list = map.get(key)
    if (list) list.push(finding)
    else map.set(key, [finding])
  }
  return [...map.entries()]
    .map(([file, items]) => ({
      file,
      items: [...items].sort((a, b) => (a.line ?? 0) - (b.line ?? 0)),
    }))
    .sort((a, b) => a.file.localeCompare(b.file))
})

function toggle(file: string): void {
  const next = new Set(collapsed.value)
  if (next.has(file)) next.delete(file)
  else next.add(file)
  collapsed.value = next
}

function place(finding: CheckFinding): string {
  if (!finding.line) return ''
  return finding.column ? `${finding.line}:${finding.column}` : String(finding.line)
}
</script>

<template>
  <div class="groups">
    <section v-for="group in groups.slice(0, shownGroups)" :key="group.file" class="group">
      <button
        class="group__head"
        :aria-expanded="!collapsed.has(group.file)"
        @click="toggle(group.file)"
      >
        <span class="group__caret" :class="{ 'group__caret--open': !collapsed.has(group.file) }"
          >▸</span
        >
        <code class="group__file">{{ group.file }}</code>
        <span class="group__count">{{ group.items.length }}</span>
      </button>
      <ul v-if="!collapsed.has(group.file)" class="items">
        <li v-for="(finding, at) in group.items" :key="at" class="item">
          <button class="item__main" @click="emit('open', finding)">
            <span class="item__place">{{ place(finding) }}</span>
            <span class="dot" :class="`dot--${finding.severity}`" :title="finding.severity" />
            <span class="item__text">
              <span class="item__message">{{ finding.message }}</span>
              <span v-if="finding.hint" class="item__hint muted">{{ finding.hint }}</span>
            </span>
            <span class="item__code">{{ finding.code }}</span>
          </button>
        </li>
      </ul>
    </section>
    <div v-if="shownGroups < groups.length" class="more">
      <button class="btn" @click="shownGroups += PAGE">
        Show more files ({{ groups.length - shownGroups }} left)
      </button>
      <button class="btn" @click="shownGroups = groups.length">Show all</button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.groups {
  @include stack($space-2);
}

.group {
  border: 1px solid var(--border);
  border-radius: $radius-md;
  overflow: hidden;

  &__head {
    display: flex;
    align-items: center;
    gap: $space-2;
    width: 100%;
    padding: $space-2 $space-3;
    border: 0;
    background: var(--surface-2);
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

  &__file {
    flex: 1;
    min-width: 0;
    font-size: $font-size-sm;
    @include truncate;
  }

  &__count {
    flex: none;
    padding: 0 8px;
    border-radius: $radius-pill;
    background: var(--surface);
    color: var(--muted);
    font-size: $font-size-xs;
  }
}

.items {
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  border-top: 1px solid var(--border);

  &__main {
    display: flex;
    align-items: flex-start;
    gap: $space-3;
    width: 100%;
    padding: $space-2 $space-3;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
    @include hover-fill;
    @include focus-ring;
  }

  &__place {
    flex: none;
    width: 56px;
    color: var(--muted);
    font-family: $font-mono;
    font-size: $font-size-sm;
    text-align: right;
  }

  &__text {
    @include stack(2px);
    flex: 1;
    min-width: 0;
  }

  &__hint {
    font-size: $font-size-sm;
  }

  &__code {
    flex: none;
    padding: 1px 8px;
    border-radius: $radius-pill;
    background: var(--surface-2);
    color: var(--muted);
    font-size: $font-size-xs;
  }
}

.dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 7px;
  border-radius: 50%;
  background: var(--muted);

  &--error {
    background: var(--danger);
  }

  &--warning {
    background: var(--warn);
  }
}

.more {
  @include cluster;
  justify-content: center;
}
</style>
