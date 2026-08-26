<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {useData, useRoute} from 'vitepress';

const {page, frontmatter} = useData();
const route = useRoute();
const copyStatus = ref<'idle' | 'copied' | 'error'>('idle');
const isDoc = computed(() => frontmatter.value.layout !== 'home' && page.value.relativePath.endsWith('.md'));
const markdownUrl = computed(() => `/markdown/${page.value.relativePath}`);

watch(() => route.path, () => {
  copyStatus.value = 'idle';
});

async function copyMarkdown() {
  try {
    const response = await fetch(markdownUrl.value);
    if (!response.ok) throw new Error(`Could not load Markdown (${response.status})`);
    await navigator.clipboard.writeText(await response.text());
    copyStatus.value = 'copied';
  } catch {
    copyStatus.value = 'error';
  }

  window.setTimeout(() => {
    copyStatus.value = 'idle';
  }, 1800);
}
</script>

<template>
  <div v-if="isDoc" class="page-actions" aria-label="Page actions">
    <button type="button" @click="copyMarkdown">
      <span aria-live="polite">
        {{ copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Copy failed' : 'Copy Markdown' }}
      </span>
    </button>
    <a :href="markdownUrl" target="_blank" rel="noopener">View raw</a>
  </div>
</template>
