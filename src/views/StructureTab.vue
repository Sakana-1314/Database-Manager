<script setup lang="ts">
import { onMounted, ref, computed, h } from 'vue';
import { useMessage, useDialog, NButton, NDataTable, type DataTableColumns } from 'naive-ui';
import type { ConnectionRecord } from '../lib/idb';
import { loadStructure, runDdl, type IndexMeta, type FkMeta, type ColMeta } from '../lib/dbops';
import { zhMessage } from '../api/errors';
import { ApiError } from '../api/errors';

const props = defineProps<{ connection: ConnectionRecord; database?: string; table: string; schema?: string }>();
const message = useMessage();
const dialog = useDialog();

const loading = ref(false);
const cols = ref<ColMeta[]>([]);
const pk = ref<string[]>([]);
const indexes = ref<IndexMeta[]>([]);
const fks = ref<FkMeta[]>([]);
const ddl = ref('');
const ddlApprox = ref(false);

function ident(c: string): string {
  return props.connection.engine === 'mysql' ? '`' + c.replaceAll('`', '``') + '`' : '"' + c.replaceAll('"', '""') + '"';
}

const tableRef = computed(() => {
  const e = props.connection.engine;
  if (e === 'mysql') return props.database ? `${ident(props.database)}.${ident(props.table)}` : ident(props.table);
  return `${ident(props.schema || 'public')}.${ident(props.table)}`;
});

function dangerBtn(text: string, onClick: () => void, small = false) {
  return h(NButton, { size: small ? 'tiny' : 'small', quaternary: true, type: 'error', onClick }, { default: () => text });
}
function ghostBtn(text: string, onClick: () => void) {
  return h(NButton, { size: 'tiny', quaternary: true, onClick }, { default: () => text });
}

const colColumns = computed(() =>
  (
    [
      { title: '列名', key: 'name', render: (r: ColMeta) => (pk.value.includes(r.name) ? r.name + ' 🔑' : r.name) },
      { title: '类型', key: 'engineType' },
      { title: 'NULL', key: 'nullable', width: 70, render: (r: ColMeta) => (r.nullable ? '是' : '否') },
      { title: '默认值', key: 'default', render: (r: ColMeta) => (r.default === null || r.default === undefined ? '' : String(r.default)) },
      { title: '其他', key: 'extra', render: (r: ColMeta) => r.extra ?? '' },
      { title: '注释', key: 'comment', render: (r: ColMeta) => r.comment ?? '' },
      { title: '操作', key: 'act', width: 100, render: (r: ColMeta) => dangerBtn('删除列', () => dropColumn(r.name)) },
    ] as unknown as DataTableColumns
  ),
);
const indexColumns = computed(() =>
  (
    [
      { title: '名称', key: 'name' },
      { title: '列', key: 'columns', render: (r: IndexMeta) => r.columns.join(', ') },
      { title: '唯一', key: 'unique', width: 60, render: (r: IndexMeta) => (r.unique ? '是' : '否') },
      { title: '主键', key: 'primary', width: 60, render: (r: IndexMeta) => (r.primary ? '是' : '否') },
      { title: '操作', key: 'act', width: 90, render: (r: IndexMeta) => (r.primary ? '' : dangerBtn('删除', () => dropIndex(r))) },
    ] as unknown as DataTableColumns
  ),
);
const fkColumns = computed(() =>
  (
    [
      { title: '名称', key: 'name' },
      { title: '列', key: 'columns', render: (r: FkMeta) => r.columns.join(', ') },
      { title: '引用', key: 'ref', render: (r: FkMeta) => `${r.refTable}(${r.refColumns.join(', ')})` },
      { title: '更新', key: 'onUpdate', render: (r: FkMeta) => r.onUpdate ?? '' },
      { title: '删除', key: 'onDelete', render: (r: FkMeta) => r.onDelete ?? '' },
    ] as unknown as DataTableColumns
  ),
);

async function load() {
  loading.value = true;
  try {
    const s = await loadStructure(props.connection, props.database, props.table, props.schema);
    cols.value = s.columns;
    pk.value = s.pk;
    indexes.value = s.indexes;
    fks.value = s.fks;
    ddl.value = s.createSql.sql;
    ddlApprox.value = !!s.createSql.approximate;
  } catch (e) {
    message.error(zhMessage((e as ApiError).code, (e as ApiError).message));
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function exec(sql: string, okMsg: string) {
  try {
    await runDdl(props.connection, sql, props.connection.engine === 'mysql' ? props.database : undefined);
    message.success(okMsg);
    await load();
  } catch (e) {
    message.error(zhMessage((e as ApiError).code, (e as ApiError).message));
    if ((e as ApiError).detail) message.warning((e as ApiError).detail!.slice(0, 400), { duration: 8000 });
  }
}

function dropColumn(col: string) {
  dialog.warning({
    title: '删除列',
    content: `确定删除列「${col}」及其全部数据？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => exec(`ALTER TABLE ${tableRef.value} DROP COLUMN ${ident(col)}`, `已删除列 ${col}`),
  });
}

function dropIndex(ix: IndexMeta) {
  dialog.warning({
    title: '删除索引',
    content: `确定删除索引「${ix.name}」？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () =>
      exec(
        props.connection.engine === 'mysql' ? `ALTER TABLE ${tableRef.value} DROP INDEX ${ident(ix.name)}` : `DROP INDEX ${ident(ix.name)} ON ${tableRef.value}`,
        `已删除索引 ${ix.name}`,
      ),
  });
}
</script>

<template>
  <div class="struct-tab">
    <div class="toolbar">
      <span class="title">结构 · {{ table }}</span>
      <n-tag v-if="ddlApprox" size="small" type="warning" :bordered="false">PG 建表语句为近似重建</n-tag>
      <div class="spacer" />
      <n-button size="small" secondary :loading="loading" @click="load">刷新</n-button>
    </div>

    <n-tabs type="line" class="tabs">
      <n-tab-pane name="columns" :tab="`列 (${cols.length})`">
        <n-data-table size="small" :columns="colColumns" :data="cols" :max-height="400" />
      </n-tab-pane>
      <n-tab-pane name="indexes" :tab="`索引 (${indexes.length})`">
        <n-data-table size="small" :columns="indexColumns" :data="indexes" :max-height="320" />
      </n-tab-pane>
      <n-tab-pane name="fks" :tab="`外键 (${fks.length})`">
        <n-data-table size="small" :columns="fkColumns" :data="fks" :max-height="320" />
      </n-tab-pane>
      <n-tab-pane name="ddl" :tab="'建表 SQL'">
        <n-scrollbar style="max-height: 460px">
          <pre class="ddl">{{ ddl || '（无法获取）' }}</pre>
        </n-scrollbar>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<style scoped>
.struct-tab { display: flex; flex-direction: column; height: 100%; padding: 4px 8px; }
.toolbar { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.title { font-weight: 600; }
.spacer { flex: 1; }
.tabs { flex: 1; }
.ddl { margin: 0; font-size: 12px; line-height: 1.7; white-space: pre-wrap; word-break: break-all; font-family: ui-monospace, Consolas, monospace; }
</style>
