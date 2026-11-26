import { createApp } from 'vue';
import App from './App.vue';
import cssText from '../styles/galgame.css?inline';

function mount() {
  if (document.getElementById('pc-assist-host')) return;
  const host = document.createElement('div');
  host.id = 'pc-assist-host';
  host.style.cssText = 'all: initial; position: relative; z-index: 2147483000;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = cssText;
  shadow.appendChild(style);
  const root = document.createElement('div');
  shadow.appendChild(root);
  (document.body || document.documentElement).appendChild(host);
  createApp(App).mount(root);
}

if (document.documentElement) mount();
else document.addEventListener('DOMContentLoaded', mount, { once: true });
