<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useMessage, useDialog } from 'naive-ui';
import type { ConnectionRecord } from '../lib/idb';
import type { ResultSet, Row, CellValue, PkSpec } from '@shared/index';
import { gridPage, loadStructure, dmlInsert, dmlUpdate, dmlDeleteRows, emptyRow, toCell, type ColMeta } from '../lib/dbops';
import { downloadResultset } from '../lib/export';
import { cellText, isJsonCell } from '../lib/cell';
import { zhMessage } from '../api/errors';
import { ApiError } from '../api/errors';
import ResultGrid from '../components/ResultGrid.vue';

const props = defineProps<{ connection: ConnectionRecord; database?: string; table: string; schema?: string }>();
const emit = defineEmits<{ (e: 'structure'): void }>();
const message = useMessage();
const dialog = useDialog();

const loading = ref(false);
const page = ref(1);
const pageSize = ref(200);
const total = ref<number | null>(null);
const resultset = ref<ResultSet>({ columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 0 });
const hasMore = ref(false);
const cols = ref<ColMeta[]>([]);
const pkCols = ref<string[]>([]);
const selected = ref<Row[]>([]);
const busy = ref(false);

const hasPk = computed(() => pkCols.value.length > 0);
const engineLabel = computed(() => `${props.connection.engine} · ${props.table}`);

async function load() {
  loading.value = true;
  try {
    const out = await gridPage(props.connection, props.database, props.table, page.value, pageSize.value, { schema: props.schema });
    resultset.value = out.resultset;
    hasMore.value = out.hasMore;
    total.value = out.total ?? null;
    if (!cols.value.length) {
      const s = await loadStructure(props.connection, props.database, props.table, props.schema);
      cols.value = s.columns;
      pkCols.value = s.pk;
    }
    selected.value = [];
  } catch (e) {
    message.error(zhMessage((e as ApiError).code, (e as ApiError).message));
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function change(p: number, ps: number) {
  if (ps !== pageSize.value) {
    pageSize.value = ps;
    page.value = 1;
  } else {
    page.value = p;
  }
  load();
}

// ---------- 增删改 ----------
const editorOpen = ref(false);
const editorMode = ref<'add' | 'edit'>('add');
const editingPk = ref<PkSpec[]>([]);
const drafts = ref<Record<string, string>>({});

function cellAsInput(v: CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function openAdd() {
  if (!hasPk.value && false) {
    /* 无主键也可插入 */
  }
  editorMode.value = 'add';
  const d: Record<string, string> = {};
  for (const c of cols.value) d[c.name] = '';
  drafts.value = d;
  editingPk.value = [];
  editorOpen.value = true;
}

function openEdit() {
  if (selected.value.length !== 1) return message.warning('请选择一行进行编辑');
  if (!hasPk.value) return message.warning('该表没有主键，无法安全定位单行；请改用 SQL 控制台');
  const row = selected.value[0];
  editorMode.value = 'edit';
  const d: Record<string, string> = {};
  for (const c of cols.value) d[c.name] = cellAsInput(row[c.name]);
  drafts.value = d;
  editingPk.value = pkCols.value.map((c) => ({ column: c, value: row[c] as CellValue }));
  editorOpen.value = true;
}

function parseField(col: ColMeta, input: string): { ok: boolean; value: CellValue; err?: string } {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: true, value: null };
  if (col.type === 'json' || col.type === 'array') {
    try {
      return { ok: true, value: { $json: JSON.parse(trimmed) } };
    } catch {
      return { ok: false, value: null, err: `${col.name} 不是合法 JSON` };
    }
  }
  return { ok: true, value: toCell(input, col.type) };
}

async function submitRow() {
  const values: Row = {};
  for (const c of cols.value) {
    if (editorMode.value === 'edit' && pkCols.value.includes(c.name)) continue;
    const parsed = parseField(c, drafts.value[c.name] ?? '');
    if (!parsed.ok) return message.warning(parsed.err ?? `${c.name} 输入有误`);
    values[c.name] = parsed.value;
  }
  busy.value = true;
  try {
    if (editorMode.value === 'add') {
      await dmlInsert(props.connection, props.database, props.table, [values], props.schema);
      message.success('已插入');
    } else {
      if (!Object.keys(values).length) return message.warning('没有可更新的字段');
      const n = await dmlUpdate(props.connection, props.database, props.table, editingPk.value, values, props.schema);
      message.success(`已更新 ${n} 行`);
    }
    editorOpen.value = false;
    await load();
  } catch (e) {
    message.error(zhMessage((e as ApiError).code, (e as ApiError).message));
    if ((e as ApiError).detail) message.warning((e as ApiError).detail!.slice(0, 300), { duration: 6000 });
  } finally {
    busy.value = false;
  }
}

function askDelete() {
  if (!selected.value.length) return message.warning('请选择要删除的行');
  if (!hasPk.value) return message.warning('该表没有主键，无法精确定位删除；请改用 SQL 控制台');
  const groups: PkSpec[][] = selected.value.map((row) => pkCols.value.map((c) => ({ column: c, value: row[c] as CellValue })));
  dialog.warning({
    title: '确认删除',
    content: `确定删除选中的 ${groups.length} 行数据？此操作不可撤销。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const n = await dmlDeleteRows(props.connection, props.database, props.table, groups, props.schema);
        message.success(`已删除 ${n} 行`);
        await load();
      } catch (e) {
        message.error(zhMessage((e as ApiError).code, (e as ApiError).message));
      }
    },
  });
}

function exportAs(kind: 'csv' | 'json' | 'sql') {
  if (!resultset.value.rows.length) return message.warning('当前页没有数据');
  downloadResultset(resultset.value, kind, props.table, props.schema);
}
</script>

<template>
  <div class="data-tab">
    <div class="toolbar">
      <span class="title">{{ engineLabel }}</span>
      <n-tag v-if="total !== null" size="small" type="info" :bordered="false">约 {{ total }} 行</n-tag>
      <n-tag v-if="hasPk" size="small" type="warning" :bordered="false">PK: {{ pkCols.join(', ') }}</n-tag>
      <n-tag v-else size="small" :bordered="false">无主键</n-tag>
      <div class="spacer" />
      <n-button size="small" secondary :loading="busy" @click="openAdd">新增行</n-button>
      <n-button size="small" secondary :disabled="selected.length !== 1" @click="openEdit">编辑</n-button>
      <n-button size="small" type="error" secondary :disabled="!selected.length" @click="askDelete">删除</n-button>
      <n-dropdown
        trigger="click"
        :options="[
          { label: '导出 CSV', key: 'csv' },
          { label: '导出 JSON(JSONL)', key: 'json' },
          { label: '导出 SQL(INSERT)', key: 'sql' },
        ]"
        @select="(k: string) => exportAs(k as 'csv' | 'json' | 'sql')"
      >
        <n-button size="small" secondary>导出 ▾</n-button>
      </n-dropdown>
      <n-button size="small" quaternary @click="emit('structure')">结构</n-button>
      <n-button size="small" secondary :loading="loading" @click="load">刷新</n-button>
    </div>
    <div class="grid">
      <ResultGrid :columns="resultset.columns" :rows="resultset.rows" :loading="loading" selectable @update:checked="(r: Row[]) => (selected = r)" />
    </div>
    <div class="pager">
      <n-pagination
        v-model:page="page"
        :page-size="pageSize"
        :item-count="total ?? (hasMore ? page * pageSize + 1 : page * pageSize)"
        :page-slot="7"
        show-size-picker
        :page-sizes="[50, 100, 200, 500]"
        @update:page="(p: number) => change(p, pageSize)"
        @update:page-size="(ps: number) => change(page, ps)"
      />
    </div>

    <n-modal v-model:show="editorOpen" preset="card" :title="editorMode === 'add' ? `新增行 · ${table}` : `编辑行 · ${table}`" style="width: 560px">
      <n-scrollbar style="max-height: 60vh">
        <div class="fields">
          <div v-for="c in cols" :key="c.name" class="field-row">
            <div class="field-head">
              <span class="fname">{{ c.name }}</span>
              <span class="ftype">{{ c.type }}{{ pkCols.includes(c.name) ? ' · PK' : '' }}</span>
            </div>
            <n-input
              :value="drafts[c.name] ?? ''"
              :disabled="editorMode === 'edit' && pkCols.includes(c.name)"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 4 }"
              :placeholder="c.nullable ? '留空 = NULL' : '必填'"
              @update:value="(v: string) => (drafts[c.name] = v)"
            />
          </div>
        </div>
      </n-scrollbar>
      <template #footer>
        <div class="modal-actions">
          <span class="note">JSON/数组列会按 JSON 解析；留空写入 NULL</span>
          <n-space>
            <n-button @click="editorOpen = false">取消</n-button>
            <n-button type="primary" :loading="busy" @click="submitRow">保存</n-button>
          </n-space>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.data-tab { display: flex; flex-direction: column; height: 100%; }
.toolbar { display: flex; align-items: center; gap: 6px; padding: 6px 8px; flex-wrap: wrap; }
.title { font-weight: 600; }
.spacer { flex: 1; }
.grid { flex: 1; overflow: auto; }
.pager { padding: 8px; display: flex; justify-content: flex-end; }
.fields { display: flex; flex-direction: column; gap: 8px; }
.field-row { display: flex; flex-direction: column; gap: 2px; }
.field-head { display: flex; justify-content: space-between; align-items: baseline; }
.fname { font-weight: 600; font-size: 13px; }
.ftype { font-size: 11px; opacity: 0.55; font-family: ui-monospace, monospace; }
.modal-actions { display: flex; justify-content: space-between; align-items: center; }
.note { font-size: 12px; opacity: 0.6; }
</style>
