<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { NDataTable, NEmpty, type DataTableColumns } from 'naive-ui';
import type { Column, Row } from '@shared/index';
import { cellText, isJsonCell, isNumericColumn } from '../lib/cell';

const props = withDefaults(
  defineProps<{
    columns: Column[];
    rows: Row[];
    loading?: boolean;
    maxHeight?: number | string;
    selectable?: boolean;
  }>(),
  { loading: false, maxHeight: 480, selectable: false },
);

const emit = defineEmits<{ (e: 'update:checked', rows: Row[]): void }>();

type GridRow = Row & { __k: number };

const data = computed<GridRow[]>(() => props.rows.map((r, i) => Object.assign({ __k: i }, r) as GridRow));
const checkedKeys = ref<(string | number)[]>([]);

watch(checkedKeys, (keys) => {
  if (!props.selectable) return;
  const rows: Row[] = [];
  for (const k of keys) {
    const hit = data.value.find((r) => r.__k === Number(k));
    if (hit) rows.push(hit);
  }
  emit('update:checked', rows);
});

const contentColumns = computed<DataTableColumns>(() =>
  props.columns.map((c) => {
    const numeric = isNumericColumn(c.type);
    return {
      title: c.name,
      key: c.name,
      align: numeric ? 'right' : 'left',
      ellipsis: { tooltip: true },
      minWidth: 120,
      render: (row: Record<string, unknown>) => {
        const v = row[c.name] as never;
        const txt = cellText(v);
        const jsonish = isJsonCell(v);
        const isNull = v === null || v === undefined;
        return h(
          'span',
          {
            style: {
              color: isNull ? 'var(--n-text-color-3)' : undefined,
              opacity: isNull ? 0.6 : 1,
              whiteSpace: 'pre-wrap',
              wordBreak: jsonish ? 'break-all' : 'keep-all',
              fontFamily: numeric || jsonish ? 'ui-monospace, Consolas, monospace' : undefined,
            },
            title: txt.length > 300 ? txt : undefined,
          },
          txt,
        );
      },
    };
  }),
);

const tableColumns = computed<DataTableColumns>(() =>
  props.selectable ? [{ type: 'selection' as const }, ...contentColumns.value] : contentColumns.value,
);

function isEmpty(): boolean {
  return !props.columns.length || !props.rows.length;
}
</script>

<template>
  <div class="result-grid">
    <n-data-table
      v-if="!isEmpty()"
      size="small"
      :columns="tableColumns"
      :data="data"
      :loading="loading"
      :max-height="maxHeight"
      :scroll-x="columns.length * 160"
      :row-key="(row: GridRow) => row.__k"
      :checked-row-keys="checkedKeys"
      @update:checked-row-keys="(keys: (string | number)[]) => (checkedKeys = keys)"
    />
    <n-empty v-else :description="loading ? '加载中…' : '没有返回数据'" size="small" style="padding: 24px 0" />
  </div>
</template>
