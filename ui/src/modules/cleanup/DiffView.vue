<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { highlightLines, type CodeToken } from '../../ui-components/highlight'

const props = defineProps<{ diff: string; lang: string }>()

interface DiffLine {
  type: 'ctx' | 'add' | 'del'
  text: string
  oldNo: number | null
  newNo: number | null
  tokens?: CodeToken[] | undefined
}

interface Hunk {
  header: string
  lines: DiffLine[]
}

function parse(diff: string): Hunk[] {
  const hunks: Hunk[] = []
  let current: Hunk | undefined
  let oldNo = 0
  let newNo = 0
  for (const raw of diff.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
    if (header) {
      oldNo = Number(header[1])
      newNo = Number(header[2])
      current = { header: raw, lines: [] }
      hunks.push(current)
      continue
    }
    if (!current || raw.startsWith('\\')) continue
    const mark = raw[0]
    if (mark === '+')
      current.lines.push({ type: 'add', text: raw.slice(1), oldNo: null, newNo: newNo++ })
    else if (mark === '-')
      current.lines.push({ type: 'del', text: raw.slice(1), oldNo: oldNo++, newNo: null })
    else if (mark === ' ') {
      current.lines.push({ type: 'ctx', text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ })
    }
  }
  return hunks
}

const hunks = ref<Hunk[]>(parse(props.diff))

async function colour(): Promise<void> {
  const parsed = parse(props.diff)
  hunks.value = parsed
  for (const hunk of parsed) {
    const tokens = await highlightLines(hunk.lines.map((line) => line.text).join('\n'), props.lang)
    hunk.lines.forEach((line, index) => {
      line.tokens = tokens[index]
    })
  }
  hunks.value = [...parsed]
}

watch(() => [props.diff, props.lang], colour)
onMounted(colour)

function sign(type: DiffLine['type']): string {
  return type === 'add' ? '+' : type === 'del' ? '−' : ' '
}
</script>

<template>
  <div class="diff" role="region" aria-label="Changes in this file">
    <section v-for="(hunk, index) in hunks" :key="index" class="hunk">
      <div class="hunk__head">{{ hunk.header }}</div>
      <div v-for="(line, at) in hunk.lines" :key="at" class="row" :class="`row--${line.type}`">
        <span class="row__no">{{ line.oldNo ?? '' }}</span>
        <span class="row__no">{{ line.newNo ?? '' }}</span>
        <span class="row__sign">{{ sign(line.type) }}</span>
        <span class="row__text">
          <template v-if="line.tokens">
            <span
              v-for="(token, tokenAt) in line.tokens"
              :key="tokenAt"
              class="tok"
              :style="{
                '--light': token.light || 'var(--text)',
                '--dark': token.dark || 'var(--text)',
              }"
              >{{ token.text }}</span
            >
          </template>
          <template v-else>{{ line.text }}</template>
          <span v-if="line.text === ''">&nbsp;</span>
        </span>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.diff {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: $radius-md;
  background: var(--surface-2);
  font-family: $font-mono;
  font-size: $font-size-sm;
  line-height: 1.6;
  max-height: 460px;
}

.hunk {
  min-width: max-content;

  &__head {
    padding: 2px $space-3;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: $font-size-xs;
  }
}

.row {
  display: flex;

  &--add {
    background: color-mix(in srgb, var(--ok) 16%, transparent);
  }

  &--del {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
  }

  &__no {
    flex: none;
    width: 4ch;
    padding: 0 6px;
    color: var(--muted);
    text-align: right;
    user-select: none;
  }

  &__sign {
    flex: none;
    width: 2ch;
    color: var(--muted);
    user-select: none;
  }

  &--add &__sign {
    color: var(--ok);
  }

  &--del &__sign {
    color: var(--danger);
  }

  &__text {
    white-space: pre;
    padding-right: $space-4;
  }
}

.tok {
  color: var(--light);

  @media (prefers-color-scheme: dark) {
    color: var(--dark);
  }
}
</style>
