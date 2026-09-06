<script setup lang="ts">
import { ref, watch } from 'vue';
import { useMessage } from 'naive-ui';
import type { Engine } from '@shared/spec';
import { ConnectionRecord } from '../lib/idb';
import { testConnection } from '../lib/dbops';
import { zhMessage } from '../api/errors';
import { ApiError } from '../api/errors';

const props = defineProps<{ show: boolean; editing?: ConnectionRecord | null }>();
const emit = defineEmits<{ (e: 'update:show', v: boolean): void; (e: 'saved', rec: ConnectionRecord): void }>();
const message = useMessage();

const transport = ref<'direct' | 'ssh' | 'http-tunnel'>('direct');
const engine = ref<Engine>('mysql');
const name = ref('');
const host = ref('127.0.0.1');
const port = ref<number | null>(3306);
const database = ref('');
const schema = ref('');
const authSource = ref('admin');
const user = ref('root');
const password = ref('');
const sshHost = ref('');
const sshPort = ref<number | null>(22);
const sshUser = ref('root');
const sshAuth = ref<'password' | 'privateKey'>('password');
const sshPassword = ref('');
const sshPrivateKey = ref('');
const sshPassphrase = ref('');
const tunnelBase = ref('');
const tunnelProfile = ref('');
const tunnelSecret = ref('');
const testing = ref(false);

const ENGINES: Engine[] = ['mysql', 'postgres', 'mongodb'];
function defaultPort(e: Engine): number {
  return e === 'postgres' ? 5432 : e === 'mongodb' ? 27017 : 3306;
}

function syncFrom(rec: ConnectionRecord) {
  name.value = rec.name ?? '';
  engine.value = rec.engine;
  host.value = rec.host;
  port.value = rec.port || defaultPort(rec.engine);
  database.value = rec.database ?? '';
  schema.value = rec.schema ?? '';
  authSource.value = rec.authSource ?? 'admin';
  user.value = rec.user;
  password.value = rec.password ?? '';
  transport.value = rec.ssh ? 'ssh' : rec.tunnel?.baseUrl ? 'http-tunnel' : 'direct';
  sshHost.value = rec.ssh?.host ?? '';
  sshPort.value = rec.ssh?.port ?? 22;
  sshUser.value = rec.ssh?.user ?? 'root';
  sshAuth.value = rec.ssh?.auth ?? 'password';
  sshPassword.value = rec.ssh?.password ?? '';
  sshPrivateKey.value = rec.ssh?.privateKey ?? '';
  sshPassphrase.value = rec.ssh?.passphrase ?? '';
  tunnelBase.value = rec.tunnel?.baseUrl ?? '';
  tunnelProfile.value = rec.tunnel?.profile ?? '';
  tunnelSecret.value = rec.tunnel?.sharedSecret ?? '';
}

watch(
  () => props.show,
  (v) => {
    if (v) syncFrom(props.editing ?? ({} as ConnectionRecord));
  },
  { immediate: true },
);

function watchPort() {
  if (!port.value && transport.value === 'direct') port.value = defaultPort(engine.value);
}

function buildSpec(): ConnectionRecord {
  const rec: ConnectionRecord = {
    id: props.editing?.id ?? '__new__',
    updatedAt: Date.now(),
    name: name.value || `${engine.value}@${host.value}`,
    engine: engine.value,
    host: host.value,
    port: port.value || defaultPort(engine.value),
    user: user.value,
    password: transport.value === 'http-tunnel' ? undefined : password.value,
    database: database.value || undefined,
    schema: engine.value === 'postgres' ? schema.value || 'public' : undefined,
    authSource: engine.value === 'mongodb' ? authSource.value || 'admin' : undefined,
  };
  if (transport.value === 'ssh') {
    rec.ssh = {
      host: sshHost.value,
      port: sshPort.value || 22,
      user: sshUser.value,
      auth: sshAuth.value,
      password: sshAuth.value === 'password' ? sshPassword.value : undefined,
      privateKey: sshAuth.value === 'privateKey' ? sshPrivateKey.value : undefined,
      passphrase: sshPassphrase.value || undefined,
    };
  } else if (transport.value === 'http-tunnel') {
    rec.tunnel = { baseUrl: tunnelBase.value, profile: tunnelProfile.value, sharedSecret: tunnelSecret.value || undefined };
  }
  return rec;
}

async function doTest() {
  testing.value = true;
  try {
    const rec = buildSpec();
    if (rec.id === '__new__') rec.id = '';
    const out = await testConnection(rec as ConnectionRecord);
    if (out.reachable) message.success(`连接成功：${out.version ?? out.engine ?? 'OK'}`);
    else message.error('连接失败');
  } catch (e) {
    const err = e as ApiError;
    message.error(zhMessage(err.code, err.message));
    if (err.detail) message.warning(err.detail.slice(0, 300), { duration: 6000 });
  } finally {
    testing.value = false;
  }
}

function save() {
  if (transport.value === 'ssh' && !sshHost.value) return message.warning('请填写跳板机地址');
  if (transport.value === 'http-tunnel' && (!tunnelBase.value || !tunnelProfile.value)) return message.warning('请填写隧道地址与 profile');
  const rec = buildSpec();
  emit('saved', rec);
  emit('update:show', false);
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    style="width: 560px"
    :title="editing ? '编辑连接' : '新建连接'"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <n-form label-placement="left" :label-width="92">
      <n-form-item label="名称">
        <n-input v-model:value="name" placeholder="如：生产 MySQL" />
      </n-form-item>
      <n-form-item label="引擎">
        <n-select v-model:value="engine" :options="ENGINES.map((e) => ({ label: e, value: e }))" @update:value="watchPort" />
      </n-form-item>

      <n-form-item label="传输方式">
        <n-radio-group v-model:value="transport">
          <n-radio value="direct">直连</n-radio>
          <n-radio value="ssh">SSH 跳板</n-radio>
          <n-radio value="http-tunnel">隧道(php/fastapi)</n-radio>
        </n-radio-group>
      </n-form-item>

      <template v-if="transport !== 'http-tunnel'">
        <n-form-item label="主机">
          <n-input v-model:value="host" placeholder="目标库地址" />
        </n-form-item>
        <n-form-item label="端口">
          <n-input-number v-model:value="port" :min="1" :max="65535" style="width: 140px" />
        </n-form-item>
        <n-form-item label="用户名">
          <n-input v-model:value="user" />
        </n-form-item>
        <n-form-item label="密码">
          <n-input v-model:value="password" type="password" show-password-on="click" />
        </n-form-item>
        <n-form-item v-if="engine === 'postgres'" label="默认库">
          <n-input v-model:value="database" placeholder="postgres" />
        </n-form-item>
        <n-form-item v-else-if="engine === 'mongodb'" label="数据库">
          <n-input v-model:value="database" />
        </n-form-item>
        <n-form-item v-else label="默认库(可选)">
          <n-input v-model:value="database" />
        </n-form-item>
        <n-form-item v-if="engine === 'postgres'" label="Schema">
          <n-input v-model:value="schema" placeholder="public" />
        </n-form-item>
      </template>

      <template v-if="transport === 'ssh'">
        <n-divider title-placement="left">跳板机</n-divider>
        <n-form-item label="SSH 主机">
          <n-input v-model:value="sshHost" placeholder="跳板机公网地址" />
        </n-form-item>
        <n-form-item label="SSH 端口">
          <n-input-number v-model:value="sshPort" :min="1" :max="65535" style="width: 140px" />
        </n-form-item>
        <n-form-item label="SSH 用户">
          <n-input v-model:value="sshUser" />
        </n-form-item>
        <n-form-item label="认证方式">
          <n-radio-group v-model:value="sshAuth">
            <n-radio value="password">密码</n-radio>
            <n-radio value="privateKey">私钥</n-radio>
          </n-radio-group>
        </n-form-item>
        <n-form-item v-if="sshAuth === 'password'" label="SSH 密码">
          <n-input v-model:value="sshPassword" type="password" show-password-on="click" />
        </n-form-item>
        <template v-else>
          <n-form-item label="私钥(PEM)">
            <n-input v-model:value="sshPrivateKey" type="textarea" :rows="4" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----…" />
          </n-form-item>
          <n-form-item label="私钥口令">
            <n-input v-model:value="sshPassphrase" type="password" show-password-on="click" placeholder="(可选)" />
          </n-form-item>
        </template>
        <p class="tip">经跳板机 SSH 通道转发到上方「主机/端口」（可为内网地址）。MongoDB 暂不支持经 SSH，请用隧道。</p>
      </template>

      <template v-if="transport === 'http-tunnel'">
        <n-divider title-placement="left">隧道</n-divider>
        <n-form-item label="隧道地址">
          <n-input v-model:value="tunnelBase" placeholder="https://host/tunnel.php 或 https://host:9000" />
        </n-form-item>
        <n-form-item label="Profile">
          <n-input v-model:value="tunnelProfile" placeholder="服务端配置的连接别名" />
        </n-form-item>
        <n-form-item label="共享密钥(可选)">
          <n-input v-model:value="tunnelSecret" placeholder="默认取服务端 TUNNEL_SHARED_SECRET" />
        </n-form-item>
        <p class="tip">edge 会先验证你的登录态，再把操作转发给隧道执行；数据库口令只存在于隧道所在机器。</p>
      </template>

      <n-form-item label=" ">
        <n-space>
          <n-button :loading="testing" @click="doTest">测试连接</n-button>
          <n-button type="primary" @click="save">保存</n-button>
        </n-space>
      </n-form-item>
    </n-form>
  </n-modal>
</template>

<style scoped>
.tip { font-size: 12px; opacity: .6; margin: -4px 0 8px 0; line-height: 1.6; }
</style>
