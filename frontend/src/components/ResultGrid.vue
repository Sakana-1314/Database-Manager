<script setup lang="ts">
import { computed, h } from 'vue';
import { NDataTable, NEmpty, type DataTableColumns } from 'naive-ui';
import type { Column, Row } from '@shared/index';
import { cellText, isJsonCell, isNumericColumn } from '../lib/cell';

const props = withDefaults(
  defineProps<{
    columns: Column[];
    rows: Row[];
    loading?: boolean;
    maxHeight?: number | string;
    rowKey?: string;
  }>(),
  { loading: false, maxHeight: 480, rowKey: '' },
);

type GridRow = Row & { __k: string };

const data = computed<GridRow[]>(() =>
  props.rows.map((r, i) => {
    const key = props.rowKey && r[props.rowKey] != null ? String(r[props.rowKey]) : `row-${i}`;
    return Object.assign({ __k: `${key}-${i}` }, r) as GridRow;
  }),
);

const tableColumns = computed<DataTableColumns>(() =>
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
        const color = v === null ? 'var(--n-text-color-3)' : undefined;
        return h(
          'span',
          {
            style: {
              color,
              opacity: v === null ? 0.6 : 1,
              whiteSpace: 'pre-wrap',
              wordBreak: jsonish ? 'break-all' : 'keep-all',
            },
            title: txt.length > 300 ? txt : undefined,
          },
          txt,
        );
      },
    };
  }),
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
    />
    <n-empty v-else :description="loading ? '加载中…' : '没有返回数据'" size="small" style="padding: 24px 0" />
  </div>
</template>
