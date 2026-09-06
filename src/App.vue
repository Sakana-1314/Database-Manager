<script setup lang="ts">
import { NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider, darkTheme, zhCN, dateZhCN, type GlobalTheme } from 'naive-ui';
import { ref } from 'vue';
import { useSettings } from './stores/settings';

const settings = useSettings();
const theme = ref<GlobalTheme | null>(settings.isDark ? darkTheme : null);
</script>

<template>
  <n-config-provider
    :theme="theme"
    :locale="zhCN"
    :date-locale="dateZhCN"
    :theme-overrides="{ common: { fontFamily: 'inherit' } }"
    style="height: 100%"
  >
    <n-message-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <router-view />
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
