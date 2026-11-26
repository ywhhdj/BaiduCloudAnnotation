<script setup lang="ts">
import { computed } from 'vue';
import { useAssist } from '../shared/useAssist';
import type { AssistConfig } from '../shared/types';

const { status, config, patchConfig, action } = useAssist();
const frameCount = computed(() => status.value.task?.frameCount || 5);

const setBool = (key: keyof AssistConfig, e: Event) =>
  patchConfig({ [key]: (e.target as HTMLInputElement).checked } as any);
const setNum = (key: keyof AssistConfig, e: Event) =>
  patchConfig({ [key]: Number((e.target as HTMLInputElement).value) } as any);
const setTheme = (e: Event) =>
  patchConfig({ theme: (e.target as HTMLSelectElement).value as AssistConfig['theme'] });
const act = (a: string) => action(a);
</script>

<template>
  <div class="pc-root pc-page" :class="`theme-${config.theme}`">
    <div class="pc-title">点云贴边助手 · 设置</div>
    <div class="pc-sub">所有改动自动保存并即时下发到标注页 · 当前题目 {{ frameCount }} 帧 / 候选 {{ status.candidateCount }} / 待审 {{ status.pendingCount }} / 守护 {{ status.guardCount }}</div>

    <div class="pc-section">
      <h3>① 自动框选 + 人工审批（核心流程）</h3>
      <div class="pc-row">
        <div class="pc-label">打开页面自动框选<small>点云加载后自动检测大部分目标、贴边生成候选框；人工只做审批与微调</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.autoDetectOnOpen" @change="setBool('autoDetectOnOpen', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">自动框选覆盖多帧<small>一次跑完 toolConfig.frameCount 帧，并按中心距离关联同一轨迹</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.autoDetectMultiFrame" @change="setBool('autoDetectMultiFrame', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">已有框数阈值<small>答案里已有框 ≥ 此值时不再自动出框，避免覆盖已有成果</small></div>
        <input type="number" min="0" max="50" step="1" :value="config.autoDetectIfFewerThan" @change="setNum('autoDetectIfFewerThan', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">高置信度自动通过<small>其余候选留在待审列表；自动通过的框仍可被人工修改</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.autoApproveHighConfidence" @change="setBool('autoApproveHighConfidence', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">自动通过阈值<small>仅对置信度 ≥ 此值的候选生效</small></div>
        <div><input type="range" min="0.5" max="0.98" step="0.02" :value="config.autoApproveThreshold" @input="setNum('autoApproveThreshold', $event)" /> <b>{{ config.autoApproveThreshold.toFixed(2) }}</b></div>
      </div>
      <div class="pc-row">
        <div class="pc-label">候选最低置信度<small>低于此值不出框；调低 = 更多候选但误检增多</small></div>
        <div><input type="range" min="0.2" max="0.8" step="0.02" :value="config.detectConfidenceMin" @input="setNum('detectConfidenceMin', $event)" /> <b>{{ config.detectConfidenceMin.toFixed(2) }}</b></div>
      </div>
      <div class="pc-row">
        <div class="pc-label">体素边长 (m)<small>越大越快、越粗；车身细节多时调小</small></div>
        <div><input type="range" min="0.2" max="0.8" step="0.04" :value="config.detectVoxel" @input="setNum('detectVoxel', $event)" /> <b>{{ config.detectVoxel.toFixed(2) }}</b></div>
      </div>
      <div class="pc-row">
        <div class="pc-label">地面分位<small>取该分位 z 作为地平面基准，剔除路面点</small></div>
        <div><input type="range" min="0.02" max="0.2" step="0.01" :value="config.detectGroundPercentile" @input="setNum('detectGroundPercentile', $event)" /> <b>{{ config.detectGroundPercentile.toFixed(2) }}</b></div>
      </div>
      <div class="pc-row">
        <div class="pc-label">单簇最少点数</div>
        <input type="number" min="4" max="200" step="2" :value="config.detectMinPoints" @change="setNum('detectMinPoints', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">每帧最多候选数</div>
        <input type="number" min="5" max="200" step="5" :value="config.detectMaxClusters" @change="setNum('detectMaxClusters', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">类别尺寸先验<small>按小汽车 / 大车 / 二轮车 / 行人等尺寸给候选打建议类别与置信度</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.detectClassPriors" @change="setBool('detectClassPriors', $event)" />
      </div>
      <div class="pc-options" style="margin-top: 10px">
        <button class="pc-btn primary" @click="act('autoDetect')">◎ 立即自动框选</button>
        <button class="pc-btn primary" @click="act('approveAll')">✓ 全部通过</button>
        <button class="pc-btn" @click="act('approveHigh')">✓ 高置信通过</button>
        <button class="pc-btn" @click="act('rejectAll')">✕ 全部拒绝</button>
        <button class="pc-btn" @click="act('showApprovals')">⌁ 审批清单</button>
      </div>
      <div class="pc-note" style="margin-top: 10px">
        审批闭环：自动候选标记为「待审」→ 人工微调框（几何一变即自动判定通过并加守护）或点「全部通过」→ 通过的框从此不再被任何自动逻辑改动；点「全部拒绝」会把候选从答案里删掉。
      </div>
    </div>

    <div class="pc-section">
      <h3>② 贴合策略</h3>
      <div class="pc-row">
        <div class="pc-label">启用助手<small>关闭后插件只读不写，不改写平台任何配置</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.enabled" @change="setBool('enabled', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">平台原生自动贴合（主路径）<small>改写 topic-schema 的 autoFitBox；由平台自己贴边，性能与精度最优</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.nativeAutoFit" @change="setBool('nativeAutoFit', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">平台多帧标注模式<small>改写 multiFrameMarkMode；帧数沿用题目 toolConfig.frameCount</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.nativeMultiFrame" @change="setBool('nativeMultiFrame', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">增强贴合（Worker 通道）<small>ROI 点云 + PCA/OBB 自主贴合，平台原生贴合不可用时使用</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.enhancedFit" @change="setBool('enhancedFit', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">多帧批量<small>「多帧贴边」按钮一次处理所有帧（默认 {{ frameCount }} 帧）</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.multiFrameBatch" @change="setBool('multiFrameBatch', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">贴合阈值<small>越大越保守（只做部分收缩），越小越紧贴点云边界</small></div>
        <div><input type="range" min="0" max="0.9" step="0.05" :value="config.fitThreshold" @input="setNum('fitThreshold', $event)" /> <b>{{ config.fitThreshold.toFixed(2) }}</b></div>
      </div>
      <div class="pc-row">
        <div class="pc-label">离群点裁剪分位<small>按 z / xy 分位数剔除地面残点与拖尾噪点</small></div>
        <div><input type="range" min="0" max="0.15" step="0.01" :value="config.outlierPercentile" @input="setNum('outlierPercentile', $event)" /> <b>{{ config.outlierPercentile.toFixed(2) }}</b></div>
      </div>
    </div>

    <div class="pc-section">
      <h3>③ 人工修改守护</h3>
      <div class="pc-row">
        <div class="pc-label">守护人工修改过的框<small>带 manual/edited 字段，或用户交互窗口内改动的框，此后永不自动改动；平台误改会自动还原</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.guardManual" @change="setBool('guardManual', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">整轨守护<small>同一 trackId 只要有一帧被人工改过，整条轨迹都锁定；默认只锁该帧</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.guardWholeTrack" @change="setBool('guardWholeTrack', $event)" />
      </div>
      <div class="pc-options" style="margin-top: 10px">
        <button class="pc-btn" @click="act('showGuards')">查看守护名单</button>
        <button class="pc-btn" @click="act('clearGuards')">清空守护名单</button>
      </div>
    </div>

    <div class="pc-section">
      <h3>④ 性能</h3>
      <div class="pc-row">
        <div class="pc-label">单框 ROI 最大点数<small>后台做 OBB 粗筛 + 均匀抽稀后再交给贴合 Worker</small></div>
        <input type="number" min="500" max="60000" step="500" :value="config.maxPointsPerBox" @change="setNum('maxPointsPerBox', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">自动框选全帧点数上限<small>后台抽稀后交给框选 Worker，再由体素网格二次压缩</small></div>
        <input type="number" min="5000" max="200000" step="5000" :value="config.detectMaxPoints" @change="setNum('detectMaxPoints', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">空闲时间片 (ms)<small>每帧处理前让出主线程，避免卡顿点云渲染</small></div>
        <input type="number" min="0" max="60" step="2" :value="config.idleSliceMs" @change="setNum('idleSliceMs', $event)" />
      </div>
      <div class="pc-note" style="margin-top: 8px">
        点云拉取与 ZIP 解压在扩展后台完成，帧点云 LRU 缓存 6 帧；Worker 通过 Transferable ArrayBuffer 接收数据，主线程不做几何运算，UI 无常驻动画循环。
      </div>
    </div>

    <div class="pc-section">
      <h3>⑤ Galgame 界面</h3>
      <div class="pc-row">
        <div class="pc-label">配色主题</div>
        <select :value="config.theme" @change="setTheme">
          <option value="midnight">午夜蓝（默认）</option>
          <option value="sakura">樱色</option>
          <option value="mint">薄荷</option>
        </select>
      </div>
      <div class="pc-row">
        <div class="pc-label">显示立绘<small>纯 CSS/SVG 绘制，不加载任何外部图片</small></div>
        <input class="pc-switch" type="checkbox" :checked="config.showAvatar" @change="setBool('showAvatar', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">打字速度 (ms/字)<small>遵循系统「减少动态效果」时直接全量显示</small></div>
        <input type="number" min="0" max="120" step="4" :value="config.typeSpeed" @change="setNum('typeSpeed', $event)" />
      </div>
      <div class="pc-row">
        <div class="pc-label">默认折叠成小球</div>
        <input class="pc-switch" type="checkbox" :checked="config.collapsed" @change="setBool('collapsed', $event)" />
      </div>
    </div>

    <div class="pc-section">
      <h3>⑥ 平台配置生效</h3>
      <div class="pc-row">
        <div class="pc-label">重新下发并刷新页面<small>页面若在插件改写配置前就完成了初始化，需要刷新才会读取 autoFitBox / multiFrameMarkMode</small></div>
        <button class="pc-btn" @click="act('reloadConfig')">重载配置</button>
      </div>
      <div class="pc-note">
        刷新会重新加载页面，请先保存平台答案。插件不会替你提交答案，也不会修改框的类别 / 属性 / 来源字段。
      </div>
    </div>

    <div class="pc-note">
      当前状态：{{ status.lastDetail }}<br />
      钩子：{{ status.hookReady ? '已就绪' : '等待注入' }} · 自动框选 {{ status.autoDetected ? '已执行' : '待执行' }} · 原生贴合 {{ status.nativeAutoFit ? 'ON' : 'OFF' }} · 增强贴合 {{ status.enhancedFit ? 'ON' : 'OFF' }}
    </div>
  </div>
</template>
