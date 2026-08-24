import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
    { path: '/editor', name: 'editor', component: () => import('@/views/EditorView.vue') },
    { path: '/play', name: 'play', component: () => import('@/views/PlayView.vue') },
    { path: '/play/save', name: 'conversation', component: () => import('@/views/ConversationView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
    { path: '/library', name: 'library', component: () => import('@/views/LibraryView.vue') },
    { path: '/storage-test', name: 'storage-test', component: () => import('@/views/StorageTestView.vue') },
  ],
})

export default router
