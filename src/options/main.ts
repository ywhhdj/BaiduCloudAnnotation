import { createApp } from 'vue';
import App from './App.vue';
import cssText from '../styles/galgame.css?inline';

const style = document.createElement('style');
style.textContent = cssText;
document.head.appendChild(style);
document.body.classList.add('pc-body');
createApp(App).mount('#app');
