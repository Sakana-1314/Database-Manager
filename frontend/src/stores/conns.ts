import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { idbListConnections, idbSaveConnection, idbDeleteConnection, type ConnectionRecord } from '../lib/idb';

function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const useConns = defineStore('conns', () => {
  const list = ref<ConnectionRecord[]>([]);
  const activeId = ref<string | null>(null);
  const loaded = ref(false);

  const byId = computed(() => new Map(list.value.map((c) => [c.id, c])));
  const active = computed<ConnectionRecord | null>(() => (activeId.value ? byId.value.get(activeId.value) ?? null : null));
  const activeOrFirst = computed(() => active.value ?? list.value[0] ?? null);

  async function refresh() {
    list.value = await idbListConnections();
    loaded.value = true;
  }

  async function create(partial: Omit<ConnectionRecord, 'id' | 'updatedAt'>): Promise<ConnectionRecord> {
    const rec: ConnectionRecord = { ...partial, id: uid(), updatedAt: Date.now() };
    await idbSaveConnection(rec);
    await refresh();
    activeId.value = rec.id;
    return rec;
  }

  async function update(rec: ConnectionRecord): Promise<void> {
    await idbSaveConnection(rec);
    await refresh();
  }

  async function remove(id: string): Promise<void> {
    await idbDeleteConnection(id);
    if (activeId.value === id) activeId.value = null;
    await refresh();
  }

  function select(id: string) {
    activeId.value = id;
  }

  return { list, activeId, byId, active, activeOrFirst, loaded, refresh, create, update, remove, select };
});
