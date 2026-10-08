<script setup lang="ts">
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force'
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import { computed, nextTick, onMounted, ref, watch } from 'vue'

export interface Cycle {
  id: number
  files: string[]
  typeOnly: boolean
}

const props = defineProps<{ cycles: Cycle[]; selected: number | null }>()
const emit = defineEmits<{ 'select-cycle': [id: number | null]; 'open-file': [file: string] }>()

interface GraphNode extends SimulationNodeDatum {
  id: string
  label: string
  dir: string
  cycles: Set<number>
}

interface GraphEdge {
  key: string
  from: string
  to: string
  cycles: Set<number>
  typeOnly: boolean
}

const WIDTH = 900
const HEIGHT = 560
const RADIUS = 9

const hovered = ref<string | null>(null)
const view = ref({ x: 0, y: 0, w: WIDTH, h: HEIGHT })
const home = ref({ x: 0, y: 0, w: WIDTH, h: HEIGHT })
const dragging = ref<{ x: number; y: number } | null>(null)
const svg = ref<SVGSVGElement>()

function baseName(file: string): string {
  return file.split('/').pop() ?? file
}

function dirName(file: string): string {
  const parts = file.split('/')
  parts.pop()
  return parts.join('/')
}

const graph = computed(() => {
  const nodes = new Map<string, GraphNode>()
  const edges = new Map<string, GraphEdge>()
  for (const cycle of props.cycles) {
    cycle.files.forEach((file, index) => {
      const node = nodes.get(file) ?? {
        id: file,
        label: baseName(file),
        dir: dirName(file),
        cycles: new Set<number>(),
      }
      node.cycles.add(cycle.id)
      nodes.set(file, node)
      const next = cycle.files[(index + 1) % cycle.files.length] as string
      const key = `${file}>${next}`
      const edge = edges.get(key) ?? {
        key,
        from: file,
        to: next,
        cycles: new Set<number>(),
        typeOnly: true,
      }
      edge.cycles.add(cycle.id)
      if (!cycle.typeOnly) edge.typeOnly = false
      edges.set(key, edge)
    })
  }
  const list = [...nodes.values()]
  list.forEach((node, index) => {
    const angle = (index / Math.max(list.length, 1)) * Math.PI * 2
    node.x = Math.cos(angle) * 160
    node.y = Math.sin(angle) * 160
  })
  const links: SimulationLinkDatum<GraphNode>[] = [...edges.values()].map((edge) => ({
    source: edge.from,
    target: edge.to,
  }))
  const simulation = forceSimulation(list)
    .force(
      'link',
      forceLink<GraphNode, SimulationLinkDatum<GraphNode>>(links)
        .id((node) => node.id)
        .distance(120),
    )
    .force('charge', forceManyBody().strength(-300))
    .force('x', forceX(0).strength(0.09))
    .force('y', forceY(0).strength(0.09))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide(46))
    .stop()
  const ticks = Math.min(400, 120 + list.length * 4)
  for (let tick = 0; tick < ticks; tick++) simulation.tick()
  return { nodes: list, edges: [...edges.values()] }
})

const positions = computed(
  () => new Map(graph.value.nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }])),
)

function fit(): void {
  const points = [...positions.value.values()]
  if (points.length === 0) return
  const pad = 90
  const minX = Math.min(...points.map((point) => point.x)) - pad
  const maxX = Math.max(...points.map((point) => point.x)) + pad
  const minY = Math.min(...points.map((point) => point.y)) - pad
  const maxY = Math.max(...points.map((point) => point.y)) + pad
  let w = maxX - minX
  let h = maxY - minY
  const rect = svg.value?.getBoundingClientRect()
  const ratio = rect && rect.height > 0 ? rect.width / rect.height : WIDTH / HEIGHT
  if (w / h < ratio) w = h * ratio
  else h = w / ratio
  const box = { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h }
  home.value = box
  view.value = { ...box }
}

watch(graph, () => nextTick(fit))
onMounted(fit)

const activeCycle = computed(() => props.cycles.find((cycle) => cycle.id === props.selected))

function nodeOn(node: GraphNode): boolean {
  if (activeCycle.value) return node.cycles.has(activeCycle.value.id)
  if (hovered.value) {
    return (
      node.id === hovered.value ||
      graph.value.edges.some(
        (edge) =>
          (edge.from === hovered.value && edge.to === node.id) ||
          (edge.to === hovered.value && edge.from === node.id),
      )
    )
  }
  return true
}

function edgeOn(edge: GraphEdge): boolean {
  if (activeCycle.value) return edge.cycles.has(activeCycle.value.id)
  if (hovered.value) return edge.from === hovered.value || edge.to === hovered.value
  return true
}

function edgePath(edge: GraphEdge): string {
  const a = positions.value.get(edge.from)
  const b = positions.value.get(edge.to)
  if (!a || !b) return ''
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  const sx = a.x + ux * (RADIUS + 2)
  const sy = a.y + uy * (RADIUS + 2)
  const ex = b.x - ux * (RADIUS + 7)
  const ey = b.y - uy * (RADIUS + 7)
  const bend = Math.min(26, length * 0.18)
  const cx = (sx + ex) / 2 - uy * bend
  const cy = (sy + ey) / 2 + ux * bend
  return `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`
}

function zoom(event: WheelEvent): void {
  event.preventDefault()
  const box = svg.value?.getBoundingClientRect()
  if (!box) return
  const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15
  const w = Math.min(Math.max(view.value.w * factor, home.value.w / 8), home.value.w * 4)
  const h = w / (view.value.w / view.value.h)
  const px = (event.clientX - box.left) / box.width
  const py = (event.clientY - box.top) / box.height
  view.value = {
    x: view.value.x + (view.value.w - w) * px,
    y: view.value.y + (view.value.h - h) * py,
    w,
    h,
  }
}

function down(event: PointerEvent): void {
  if ((event.target as Element).closest('.node')) return
  dragging.value = { x: event.clientX, y: event.clientY }
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
}

function move(event: PointerEvent): void {
  const start = dragging.value
  const box = svg.value?.getBoundingClientRect()
  if (!start || !box) return
  view.value = {
    ...view.value,
    x: view.value.x - ((event.clientX - start.x) / box.width) * view.value.w,
    y: view.value.y - ((event.clientY - start.y) / box.height) * view.value.h,
  }
  dragging.value = { x: event.clientX, y: event.clientY }
}

function up(): void {
  dragging.value = null
}

function nodeClass(node: GraphNode): string {
  return node.cycles.size > 1 ? 'node--hub' : 'node--single'
}
</script>

<template>
  <div class="graph">
    <svg
      ref="svg"
      class="graph__svg"
      :class="{ 'graph__svg--drag': dragging }"
      :viewBox="`${view.x} ${view.y} ${view.w} ${view.h}`"
      role="img"
      aria-label="Graph of the import cycles"
      @wheel="zoom"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @click.self="emit('select-cycle', null)"
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" class="arrow" />
        </marker>
        <marker
          id="arrow-on"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" class="arrow arrow--on" />
        </marker>
      </defs>

      <path
        v-for="edge in graph.edges"
        :key="edge.key"
        class="edge"
        :class="{
          'edge--dim': !edgeOn(edge),
          'edge--on': !!activeCycle && edgeOn(edge),
          'edge--type': edge.typeOnly,
          'edge--strong': edge.cycles.size > 1,
        }"
        :d="edgePath(edge)"
        :marker-end="activeCycle && edgeOn(edge) ? 'url(#arrow-on)' : 'url(#arrow)'"
      />

      <g
        v-for="node in graph.nodes"
        :key="node.id"
        class="node"
        :class="[nodeClass(node), { 'node--dim': !nodeOn(node) }]"
        :transform="`translate(${node.x ?? 0}, ${node.y ?? 0})`"
        tabindex="0"
        role="button"
        :aria-label="`${node.id}, in ${node.cycles.size} cycle${node.cycles.size === 1 ? '' : 's'}`"
        @mouseenter="hovered = node.id"
        @mouseleave="hovered = null"
        @focus="hovered = node.id"
        @blur="hovered = null"
        @click.stop="emit('open-file', node.id)"
        @keydown.enter="emit('open-file', node.id)"
      >
        <title>
          {{ node.id }} — in {{ node.cycles.size }} cycle{{ node.cycles.size === 1 ? '' : 's' }}
        </title>
        <circle :r="RADIUS" class="node__dot" />
        <text class="node__label" y="-16" text-anchor="middle">{{ node.label }}</text>
        <text v-if="node.dir" class="node__dir" y="26" text-anchor="middle">{{ node.dir }}</text>
      </g>
    </svg>

    <div class="graph__bar">
      <span class="legend"><i class="legend__dot legend__dot--single" /> in one cycle</span>
      <span class="legend"><i class="legend__dot legend__dot--hub" /> in several cycles</span>
      <span class="legend"><i class="legend__line legend__line--type" /> type-only import</span>
      <span class="spacer" />
      <button class="btn btn--small" @click="view = { ...home }">Fit to screen</button>
    </div>
    <p class="muted small">
      Scroll to zoom, drag to move. Click a file to open it, or pick a cycle in the list to light it
      up.
    </p>
  </div>
</template>

<style scoped lang="scss">
.graph {
  @include stack($space-2);

  &__svg {
    width: 100%;
    height: 520px;
    border: 1px solid var(--border);
    border-radius: $radius-md;
    background: var(--surface-2);
    cursor: grab;
    touch-action: none;

    &--drag {
      cursor: grabbing;
    }
  }

  &__bar {
    @include cluster($space-4);
    font-size: $font-size-sm;
  }
}

.spacer {
  flex: 1;
}

.small {
  font-size: $font-size-sm;
}

.edge {
  fill: none;
  stroke: var(--muted);
  stroke-width: 1.4;
  opacity: 0.75;
  transition: opacity $transition-fast;

  &--strong {
    stroke-width: 2.2;
  }

  &--type {
    stroke-dasharray: 5 4;
  }

  &--on {
    stroke: var(--accent);
    stroke-width: 2.6;
    opacity: 1;
  }

  &--dim {
    opacity: 0.12;
  }
}

.arrow {
  fill: var(--muted);

  &--on {
    fill: var(--accent);
  }
}

.node {
  cursor: pointer;
  outline: none;
  transition: opacity $transition-fast;

  &__dot {
    stroke: var(--surface);
    stroke-width: 2;
  }

  &--single &__dot {
    fill: var(--warn);
  }

  &--hub &__dot {
    fill: var(--danger);
  }

  &:hover &__dot,
  &:focus-visible &__dot {
    stroke: var(--accent);
    stroke-width: 3;
  }

  &--dim {
    opacity: 0.2;
  }

  &__label {
    fill: var(--text);
    font-size: 13px;
    font-weight: 600;
    paint-order: stroke;
    stroke: var(--surface-2);
    stroke-width: 4px;
    stroke-linejoin: round;
  }

  &__dir {
    fill: var(--muted);
    font-size: 10px;
    paint-order: stroke;
    stroke: var(--surface-2);
    stroke-width: 3px;
  }
}

.legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;

  &__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;

    &--single {
      background: var(--warn);
    }

    &--hub {
      background: var(--danger);
    }
  }

  &__line {
    width: 22px;
    border-top: 2px dashed var(--muted);

    &--type {
      border-top-style: dashed;
    }
  }
}
</style>
