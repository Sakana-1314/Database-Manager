<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useMessage } from 'naive-ui';
import { useAuth } from '../stores/auth';
import { zhMessage } from '../api/errors';
import { ApiError } from '../api/errors';

const router = useRouter();
const route = useRoute();
const message = useMessage();
const auth = useAuth();

const username = ref('admin');
const password = ref('');
const submitting = ref(false);

async function submit() {
  if (!password.value) {
    message.warning('请输入密码');
    return;
  }
  submitting.value = true;
  try {
    await auth.login(username.value, password.value);
    message.success('登录成功');
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    await router.replace(redirect);
  } catch (e) {
    const err = e as ApiError;
    message.error(zhMessage(err.code, err.message));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <n-card class="login-card" :bordered="false">
      <div class="brand">
        <div class="logo">🗄️</div>
        <h1>EdgeOne DB Admin</h1>
        <p class="sub">多数据库 Web 管理 · 连接信息只存本机</p>
      </div>
      <n-form @submit.prevent="submit">
        <n-form-item label="账号">
          <n-input v-model:value="username" placeholder="admin" :disabled="true" />
        </n-form-item>
        <n-form-item label="密码">
          <n-input
            v-model:value="password"
            type="password"
            show-password-on="click"
            placeholder="ADMIN_PASSWORD"
            @keydown.enter="submit"
          />
        </n-form-item>
        <n-button type="primary" block :loading="submitting" attr-type="submit" size="large">登 录</n-button>
      </n-form>
      <p class="hint">密码来自部署时的 ADMIN_PASSWORD 环境变量，登录凭证有效期为 7 天。</p>
    </n-card>
  </div>
</template>

<style scoped>
.login-wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(1200px 600px at 30% 0%, rgba(24, 160, 88, 0.12), transparent),
    radial-gradient(1000px 500px at 80% 100%, rgba(24, 119, 242, 0.12), transparent);
}
.login-card {
  width: 380px;
  padding: 8px 8px 0;
}
.brand {
  text-align: center;
  margin-bottom: 8px;
}
.brand .logo {
  font-size: 40px;
}
.brand h1 {
  margin: 6px 0 2px;
  font-size: 20px;
  letter-spacing: 0.5px;
}
.brand .sub {
  margin: 0 0 14px;
  opacity: 0.6;
  font-size: 12px;
}
.hint {
  margin-top: 14px;
  font-size: 12px;
  opacity: 0.55;
  text-align: center;
  line-height: 1.6;
}
</style>
