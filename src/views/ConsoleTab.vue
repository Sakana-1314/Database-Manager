<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useMessage } from 'naive-ui';
import type { ConnectionRecord } from '../lib/idb';
import type { OpResult, ResultSet } from '@shared/index';
import { execSql, loadDatabases } from '../lib/dbops';
import { idbPushHistory, idbHistory } from '../lib/idb';
import { zhMessage } from '../api/errors';
import { ApiError } from '../api/errors';
import { tsLabel } from '../lib/cell';
import SqlEditor from '../components/SqlEditor.vue';
import ResultGrid from '../components/ResultGrid.vue';

const props = defineProps<{ connection: ConnectionRecord; database?: string }>();
const message = useMessage();

const editor = ref<InstanceType<typeof SqlEditor> | null>(null);
const sql = ref('-- 在此输入 SQL；Ctrl/Cmd + Enter 运行（整段）\nSELECT * FROM information_schema.tables LIMIT 20;');
const dbs = ref<string[]>([]);
const dbSel = ref<string>('');
const running = ref(false);
const historyOpts = ref<{ label: string; key: string; sql: string }[]>([]);

async function refreshHistory() {
  try {
    const items = await idbHistory();
    historyOpts.value = items
      .slice()
      .reverse()
      .slice(0, 20)
      .map((it) => ({
        key: String(it.id),
        label: `${it.ok ? '✓' : '✗'} ${it.sql.replaceAll('\n', ' ').slice(0, 60)}`,
        sql: it.sql,
      }));
  } catch {
    historyOpts.value = [];
  }
}

function pickHistory(key: string) {
  const hit = historyOpts.value.find((o) => o.key === key);
  if (hit) {
    sql.value = hit.sql;
    message.info('已载入历史 SQL，可继续编辑或运行');
  }
}

type Out = { kind: 'set'; resultset: ResultSet; label: string } | { kind: 'msg'; text: string; label: string };
const outputs = ref<Out[]>([]);

onMounted(async () => {
  dbSel.value = props.database ?? props.connection.database ?? '';
  if (props.connection.engine === 'mysql' || props.connection.engine === 'postgres') {
    try {
      dbs.value = await loadDatabases(props.connection);
      if (!dbSel.value && dbs.value.length) dbSel.value = dbs.value[0];
    } catch (e) {
      message.error(zhMessage((e as ApiError).code, (e as ApiError).message));
    }
  }
});

const engineMysql = computed(() => props.connection.engine === 'mysql');

async function run(useSelection: boolean) {
  if (!editor.value) return;
  const text = useSelection ? editor.value.selectionOrAll() : sql.value;
  const target = text.trim();
  if (!target) return;
  running.value = true;
  outputs.value = [];
  const t0 = performance.now();
  try {
    const args: Record<string, unknown> = { sql: target };
    if (engineMysql.value && dbSel.value) args.database = dbSel.value;
    const res: OpResult = await execSql(props.connection, target, engineMysql.value ? dbSel.value : undefined);
    const dur = performance.now() - t0;
    collect(res, dur);
    idbPushHistory({ engine: props.connection.engine, connId: props.connection.id, database: dbSel.value, sql: target.slice(0, 4000), ok: true, durationMs: Math.round(dur), at: Date.now() }).catch(() => undefined);
  } catch (e) {
    const err = e as ApiError;
    message.error(zhMessage(err.code, err.message));
    if (err.detail) message.warning(err.detail.slice(0, 400), { duration: 8000 });
    idbPushHistory({ engine: props.connection.engine, connId: props.connection.id, sql: target.slice(0, 4000), ok: false, at: Date.now() }).catch(() => undefined);
  } finally {
    running.value = false;
  }
}

function collect(res: OpResult, durMs: number) {
  if (res.kind === 'resultset') {
    outputs.value.push({ kind: 'set', label: `查询 ${tsLabel(res.resultset.durationMs || durMs)}`, resultset: res.resultset });
    if (res.resultset.truncated) message.warning('结果超过上限，仅返回部分数据');
  } else if (res.kind === 'multiple') {
    let i = 0;
    for (const item of res.items) {
      i++;
      if (item.kind === 'resultset') outputs.value.push({ kind: 'set', label: `结果 #${i} ${tsLabel(item.resultset.durationMs)}`, resultset: item.resultset });
      else outputs.value.push({ kind: 'msg', label: `语句 #${i}`, text: item.message ?? `执行成功，影响 ${item.affectedRows ?? 0} 行` });
    }
  } else if (res.kind === 'ok') {
    outputs.value.push({ kind: 'msg', label: '结果', text: res.message ?? `执行成功，影响 ${res.affectedRows ?? 0} 行` });
  }
}
</script>

<template>
  <div class="console-tab">
    <div class="toolbar">
      <n-select v-if="engineMysql" v-model:value="dbSel" :options="dbs.map((d) => ({ label: d, value: d }))" size="small" style="width: 200px" placeholder="当前库" />
      <span v-else class="db-tag">{{ dbSel || connection.database || '默认库' }}</span>
      <div class="spacer" />
      <n-button size="small" secondary @click="run(true)">运行选中</n-button>
      <n-button size="small" type="primary" :loading="running" @click="run(false)">运行 (Ctrl+Enter)</n-button>
      <n-button size="small" quaternary @click="outputs = []">清空结果</n-button>
      <n-popover trigger="click" placement="bottom-end" :width="380" @update:show="(v: boolean) => v && refreshHistory()">
        <template #trigger>
          <n-button size="small" quaternary>历史</n-button>
        </template>
        <div class="hist">
          <div v-if="!historyOpts.length" class="hist-empty">暂无历史（运行过的 SQL 记录在本浏览器）</div>
          <div v-for="o in historyOpts" :key="o.key" class="hist-item" @click="pickHistory(o.key)">
            <span>{{ o.label }}</span>
          </div>
        </div>
      </n-popover>
    </div>

    <div class="editor-box">
      <SqlEditor
        ref="editor"
        v-model="sql"
        language="sql"
        :dialect="connection.engine === 'postgres' ? 'postgres' : 'mysql'"
        :dark="false"
        min-height="180px"
        @run="run(false)"
      />
    </div>

    <n-scrollbar class="results">
      <template v-if="outputs.length">
        <div v-for="(o, i) in outputs" :key="i" class="out">
          <div class="out-label">
            <span>{{ o.label }}</span>
          </div>
          <div v-if="o.kind === 'msg'" class="msg ok">{{ o.text }}</div>
          <ResultGrid v-else :columns="o.resultset.columns" :rows="o.resultset.rows" :loading="running" />
        </div>
      </template>
      <n-empty v-else description="运行 SQL 后结果将显示在这里" size="small" style="padding: 40px 0" />
    </n-scrollbar>
  </div>
</template>

<style scoped>
.console-tab { display: flex; flex-direction: column; height: 100%; }
.toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--n-divider-color, rgba(128,128,128,.16)); }
.spacer { flex: 1; }
.db-tag { font-size: 12px; opacity: .7; }
.editor-box { border-bottom: 1px solid var(--n-divider-color, rgba(128,128,128,.16)); }
.results { flex: 1; }
.out { margin: 8px 0 16px; }
.out-label { font-size: 12px; opacity: .6; padding: 2px 8px; }
.msg.ok { padding: 6px 12px; font-size: 13px; }
.hist { max-height: 260px; overflow: auto; }
.hist-empty { font-size: 12px; opacity: .6; padding: 8px; }
.hist-item { padding: 6px 8px; font-size: 12px; cursor: pointer; border-radius: 4px; font-family: ui-monospace, Consolas, monospace; }
.hist-item:hover { background: rgba(128,128,128,0.12); }
</style>
