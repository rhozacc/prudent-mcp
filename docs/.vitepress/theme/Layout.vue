<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import PrudentMetal from "./PrudentMetal.vue";

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #home-hero-image>
      <PrudentMetal />
    </template>
  </Layout>
</template>
