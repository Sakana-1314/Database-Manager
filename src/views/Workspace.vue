<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useMessage } from 'naive-ui';
import { useAuth } from '../stores/auth';
import { useConns } from '../stores/conns';
import type { ConnectionRecord } from '../lib/idb';
import { loadDatabases, loadObjects, loadCollections } from '../lib/dbops';
import type { TableMeta } from '../lib/dbops';
import { zhMessage } from '../api/errors';
import { ApiError } from '../api/errors';
import { useSettings } from '../stores/settings';
import ConsoleTab from './ConsoleTab.vue';
import DataTab from './DataTab.vue';
import StructureTab from './StructureTab.vue';
import ConnectionModal from '../components/ConnectionModal.vue';

const router = useRouter();
const message = useMessage();
const auth = useAuth();
const conns = useConns();
const settings = useSettings();

interface DbGroup { name: string; expanded: boolean; loading: boolean; objects?: TableMeta[]; error?: string }
const groups = ref<DbGroup[]>([]);
const dbsLoading = ref(false);

type TabKind = 'data' | 'console' | 'struct';
interface Tab { key: string; connId: string; kind: TabKind; title: string; database?: string; table?: string; schema?: string }
const tabs = ref<Tab[]>([]);
const activeTab = ref<string | null>(null);
let tabSeq = 0;

const connFor = computed(() => conns.list.reduce<Record<string, ConnectionRecord>>((m, c) => ((m[c.id] = c), m), {}));
const connectionEngineIsSql = computed(() => {
  const c = current();
  return !!c && c.engine !== 'mongodb';
});

function current(): ConnectionRecord | null {
  return conns.activeOrFirst;
}

async function reloadDbList() {
  const conn = current();
  if (!conn) {
    groups.value = [];
    return;
  }
  dbsLoading.value = true;
  groups.value = [];
  try {
    const dbs = await loadDatabases(conn);
    groups.value = dbs.map((name) => ({ name, expanded: false, loading: false }));
  } catch (e) {
    message.error(zhMessage((e as ApiError).code, (e as ApiError).message));
  } finally {
    dbsLoading.value = false;
  }
}

async function toggleDb(g: DbGroup) {
  g.expanded = !g.expanded;
  if (g.expanded && g.objects === undefined && !g.loading) await loadDb(g);
}

async function loadDb(g: DbGroup) {
  const conn = current();
  if (!conn) return;
  g.loading = true;
  g.error = undefined;
  try {
    if (conn.engine === 'mongodb') {
      const cols = await loadCollections(conn, g.name);
      g.objects = cols.map((c) => ({ name: c, kind: 'table' as const }));
    } else {
      const tables = await loadObjects(conn, g.name, conn.schema, 'table');
      const views = await loadObjects(conn, g.name, conn.schema, 'view');
      g.objects = [...tables, ...views];
    }
  } catch (e) {
    g.error = zhMessage((e as ApiError).code, (e as ApiError).message);
  } finally {
    g.loading = false;
  }
}

function openTab(kind: TabKind, title: string, database?: string, table?: string, schema?: string) {
  const conn = current();
  if (!conn) return;
  const key = `${kind}-${database}-${table ?? ''}-${tabSeq++}`;
  const tab: Tab = { key, connId: conn.id, kind, title, database, table, schema };
  tabs.value.push(tab);
  activeTab.value = key;
}

function openStruct(database?: string, table?: string, schema?: string) {
  if (!table) return;
  openTab('struct', `${database ? database + '.' : ''}${table} 结构`, database, table, schema);
}

function connOf(tab: Tab): ConnectionRecord | null {
  return connFor.value[tab.connId] ?? null;
}

function closeTab(key: string) {
  const idx = tabs.value.findIndex((t) => t.key === key);
  if (idx >= 0) tabs.value.splice(idx, 1);
  if (activeTab.value === key) {
    const next = tabs.value[idx] ?? tabs.value[idx - 1];
    activeTab.value = next ? next.key : null;
  }
}

watch(() => conns.activeId, () => reloadDbList());
onMounted(async () => {
  if (!conns.loaded) await conns.refresh();
  if (!conns.activeId && conns.list.length) conns.select(conns.list[0].id);
  reloadDbList();
});

const modalShow = ref(false);
const editing = ref<ConnectionRecord | null>(null);

function newConn() {
  editing.value = null;
  modalShow.value = true;
}
function editConn(c: ConnectionRecord) {
  editing.value = c;
  modalShow.value = true;
}
async function saved(rec: ConnectionRecord) {
  try {
    if (rec.id && rec.id !== '__new__' && conns.byId.has(rec.id)) await conns.update(rec);
    else await conns.create({ ...rec, id: undefined } as never);
    message.success('连接已保存');
  } catch (e) {
    message.error((e as Error).message);
  }
}
async function removeConn(id: string) {
  await conns.remove(id);
  reloadDbList();
}
function logout() {
  auth.logout();
  router.replace('/login');
}
</script>

<template>
  <n-layout has-sider class="ws">
    <n-layout-sider bordered width="270" :native-scrollbar="false">
      <div class="rail">
        <div class="rail-head">
          <span class="brand">🗄️ DB Admin</span>
          <n-button size="tiny" quaternary circle @click="settings.toggleDark()">{{ settings.isDark ? '🌙' : '☀️' }}</n-button>
        </div>

        <n-select
          v-if="conns.list.length"
          :value="conns.activeId"
          :options="conns.list.map((c) => ({ label: `${c.name} · ${c.engine}${c.ssh ? '·SSH' : ''}${c.tunnel?.baseUrl ? '·隧道' : ''}`, value: c.id }))"
          size="small"
          @update:value="(v: string) => conns.select(v)"
        />

        <div v-if="conns.list.length" class="db-list">
          <div class="row-actions">
            <n-button size="tiny" secondary :loading="dbsLoading" @click="reloadDbList">刷新库列表</n-button>
            <n-button size="tiny" secondary @click="openTab('console', '控制台', undefined)">SQL 控制台</n-button>
          </div>
          <div v-for="g in groups" :key="g.name" class="db">
            <div class="db-row" @click="toggleDb(g)">
              <span class="arrow" :class="{ open: g.expanded }">▸</span>
              <span class="db-icon">🗄️</span>
              <span class="db-name">{{ g.name }}</span>
              <span class="spacer" />
              <n-button size="tiny" quaternary @click.stop="openTab('console', `控制台 · ${g.name}`, g.name)">SQL</n-button>
            </div>
            <div v-if="g.expanded" class="tables">
              <div v-if="g.loading" class="hint">加载中…</div>
              <div v-else-if="g.error" class="hint err">{{ g.error }}</div>
              <template v-else-if="g.objects">
                <div v-for="t in g.objects" :key="t.name" class="table-row" @dblclick="openTab('data', `${g.name}.${t.name}`, g.name, t.name, undefined)">
                  <span class="t-icon">{{ t.kind === 'view' ? '🔍' : t.rows === 0 ? '▫️' : '📋' }}</span>
                  <span class="t-name">{{ t.name }}</span>
                  <span v-if="t.rows !== undefined" class="rows">{{ t.rows > 9999 ? '>10k' : t.rows }}</span>
                  <n-button v-if="connectionEngineIsSql" size="tiny" quaternary class="row-btn" @click.stop="openStruct(g.name, t.name)">🛠</n-button>
                </div>
              </template>
              <div v-else class="hint">空</div>
            </div>
          </div>
        </div>

        <div v-else class="hint" style="padding: 20px 12px">
          还没有连接。点右上「＋」添加 MySQL / PostgreSQL / MongoDB，支持 SSH 跳板与 php/fastapi 隧道。
        </div>
      </div>
      <div class="rail-actions">
        <n-button size="small" type="primary" @click="newConn">＋ 新建连接</n-button>
        <n-dropdown
          v-if="current()"
          trigger="click"
          :options="[
            { label: `编辑 ${current()?.name}`, key: 'edit' },
            { label: '删除此连接', key: 'del' },
            { label: '退出登录', key: 'logout' },
          ]"
          @select="(k: string) => {
            if (k === 'edit') editConn(current()!);
            else if (k === 'del') { removeConn(current()!.id); }
            else logout();
          }"
        >
          <n-button size="small" quaternary>管理 ▾</n-button>
        </n-dropdown>
      </div>
    </n-layout-sider>

    <n-layout>
      <n-tabs v-model:value="activeTab" type="card" closable class="tabsbar" @close="closeTab">
        <n-tab-pane
          v-for="tab in tabs"
          :key="tab.key"
          :name="tab.key"
          :tab="tab.title"
          :display-directive="'show'"
        >
          <div class="tab-body">
            <template v-if="tab.kind === 'console'">
              <ConsoleTab v-if="connOf(tab)" :key="tab.key" :connection="connOf(tab)!" :database="tab.database" />
            </template>
            <template v-else-if="tab.kind === 'struct'">
              <StructureTab v-if="connOf(tab)" :key="tab.key" :connection="connOf(tab)!" :database="tab.database" :table="tab.table!" :schema="tab.schema" />
              <n-empty v-else description="连接已被删除" style="margin-top: 40px" />
            </template>
            <template v-else>
              <DataTab
                v-if="connOf(tab)"
                :key="tab.key"
                :connection="connOf(tab)!"
                :database="tab.database"
                :table="tab.table!"
                :schema="tab.schema"
                @structure="openStruct(tab.database, tab.table, tab.schema)"
              />
              <n-empty v-else description="连接已被删除" style="margin-top: 40px" />
            </template>
          </div>
        </n-tab-pane>
      </n-tabs>
      <div v-if="!activeTab" class="welcome">
        <h2>开始之前</h2>
        <p>左侧选择或新建一个数据库连接；双击「库 → 表」浏览数据，或点「SQL」打开控制台。</p>
        <p class="dim">数据库口令只保存在本浏览器 IndexedDB；登录态为 7 天 JWT。</p>
      </div>
    </n-layout>
  </n-layout>

  <ConnectionModal :show="modalShow" :editing="editing" @update:show="(v: boolean) => (modalShow = v)" @saved="saved" />
</template>

<style scoped>
.ws { height: 100%; }
.rail { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.rail-head { display: flex; justify-content: space-between; align-items: center; }
.brand { font-weight: 700; }
.db-list { display: flex; flex-direction: column; gap: 2px; overflow: auto; }
.row-actions { display: flex; gap: 6px; margin-bottom: 6px; }
.db-row { display: flex; align-items: center; gap: 4px; padding: 3px 4px; cursor: pointer; border-radius: 4px; }
.db-row:hover { background: rgba(128, 128, 128, 0.1); }
.arrow { display: inline-block; transition: transform 0.12s; font-size: 11px; }
.arrow.open { transform: rotate(90deg); }
.db-name { font-weight: 600; font-size: 13px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spacer { flex: 1; }
.tables { padding-left: 18px; }
.table-row { display: flex; gap: 6px; align-items: center; padding: 2px 4px; font-size: 13px; border-radius: 4px; cursor: pointer; }
.table-row:hover { background: rgba(128, 128, 128, 0.12); }
.t-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rows { font-size: 11px; opacity: 0.55; }
.hint { font-size: 12px; opacity: 0.6; padding: 4px 6px; }
.hint.err { color: #d03050; }
.rail-actions { display: flex; gap: 8px; padding: 8px; border-top: 1px solid var(--n-divider-color, rgba(128,128,128,.16)); }
.tabsbar { height: 100%; }
.tab-body { height: calc(100% - 40px); padding: 0 4px; }
.welcome { padding: 60px 40px; }
.welcome h2 { margin: 0 0 8px; }
.dim { opacity: 0.55; font-size: 13px; }
</style>
