<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useMessage } from 'naive-ui';
import type { ConnectionRecord } from '../lib/idb';
import type { ResultSet } from '@shared/index';
import { gridPage, loadColumns } from '../lib/dbops';
import { zhMessage } from '../api/errors';
import { ApiError } from '../api/errors';
import ResultGrid from '../components/ResultGrid.vue';

const props = defineProps<{ connection: ConnectionRecord; database?: string; table: string; schema?: string }>();
const message = useMessage();

const loading = ref(false);
const page = ref(1);
const pageSize = ref(200);
const total = ref<number | null>(null);
const resultset = ref<ResultSet>({ columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 0 });
const hasMore = ref(false);
const pkCols = ref<string[]>([]);

const engineLabel = computed(() => `${props.connection.engine} · ${props.table}`);

async function load() {
  loading.value = true;
  try {
    const out = await gridPage(props.connection, props.database, props.table, page.value, pageSize.value, { schema: props.schema });
    resultset.value = out.resultset;
    hasMore.value = out.hasMore;
    total.value = out.total ?? null;
    if (!pkCols.value.length) {
      try {
        const cols = await loadColumns(props.connection, props.database, props.table, props.schema);
        pkCols.value = cols.filter((c) => c.key?.toUpperCase().includes('PRI') || c.extra === 'identity').map((c) => c.name);
      } catch {
        pkCols.value = [];
      }
    }
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
</script>

<template>
  <div class="data-tab">
    <div class="toolbar">
      <span class="title">{{ engineLabel }}</span>
      <n-tag v-if="total !== null" size="small" type="info" :bordered="false">约 {{ total }} 行</n-tag>
      <div class="spacer" />
      <n-button size="small" secondary :loading="loading" @click="load">刷新</n-button>
    </div>
    <div class="grid">
      <ResultGrid :columns="resultset.columns" :rows="resultset.rows" :loading="loading" />
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
  </div>
</template>

<style scoped>
.data-tab { display: flex; flex-direction: column; height: 100%; }
.toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 8px; }
.title { font-weight: 600; }
.spacer { flex: 1; }
.grid { flex: 1; overflow: auto; }
.pager { padding: 8px; display: flex; justify-content: flex-end; }
</style>
