import {h} from 'vue';
import DefaultTheme from 'vitepress/theme';
import PageActions from './PageActions.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, {
    'doc-before': () => h(PageActions),
  }),
};
