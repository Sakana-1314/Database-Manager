import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuth } from '../stores/auth';

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('../views/Login.vue'), meta: { public: true } },
  { path: '/', component: () => import('../views/Workspace.vue'), meta: { public: false } },
  { path: '/ws/:connId', component: () => import('../views/Workspace.vue'), meta: { public: false } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuth();
  if (!to.meta.public && !auth.isAuthed) return { name: 'login', query: { redirect: to.fullPath } };
  if (to.name === 'login' && auth.isAuthed) return '/';
  return true;
});
