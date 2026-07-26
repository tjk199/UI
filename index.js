// =============================================================================
// UI Template Manager - SillyTavern Third-Party Extension
// =============================================================================
// 功能：
//   1. 导入 / 导出 rp-hub-ui-templates 格式的 JSON 模板
//   2. 将模板绑定到当前角色
//   3. 监听 AI 消息中的 JSON 片段，更新模板状态并重新渲染
// =============================================================================

import { getContext, extension_settings, saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';
import { getApiUrl, getRequestHeaders } from '../../../../script.js';

// 扩展设置键名
const SETTINGS_KEY = 'ui-template-manager';

// 模板类型标识（导入时校验用）
const TEMPLATE_TYPE = 'rp-hub-ui-templates';

// -----------------------------------------------------------------------------
// 初始化扩展设置
// -----------------------------------------------------------------------------
function initSettings() {
    if (!extension_settings[SETTINGS_KEY]) {
        extension_settings[SETTINGS_KEY] = {
            templates: {},          // { templateId: { id, name, html, css, defaultState } }
            characterBindings: {},  // { characterId: templateId }
            currentState: {},       // 当前模板的状态数据
        };
    }
    // 兼容旧版本/缺省字段
    const s = extension_settings[SETTINGS_KEY];
    s.templates = s.templates || {};
    s.characterBindings = s.characterBindings || {};
    s.currentState = s.currentState || {};
}

// -----------------------------------------------------------------------------
// 获取当前角色 ID
// -----------------------------------------------------------------------------
function getCurrentCharacterId() {
    const context = getContext();
    if (!context || !context.characters || context.characters.length === 0) return null;
    const ch = context.characters[context.characterId];
    return ch ? ch.avatar : null;
}

// -----------------------------------------------------------------------------
// 获取当前绑定的模板
// -----------------------------------------------------------------------------
function getCurrentTemplate() {
    const charId = getCurrentCharacterId();
    if (!charId) return null;
    const s = extension_settings[SETTINGS_KEY];
    const templateId = s.characterBindings[charId];
    return templateId ? s.templates[templateId] || null : null;
}

// -----------------------------------------------------------------------------
// 从消息文本中提取 JSON
// 支持格式：
//   ```json
//   { ... }
//   ```
// 或：
//   <json>...</json>
// -----------------------------------------------------------------------------
function extractJsonFromMessage(text) {
    if (!text || typeof text !== 'string') return null;

    // 匹配 ```json ... ```
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/i;
    const codeMatch = text.match(codeBlockRegex);
    if (codeMatch && codeMatch[1]) {
        try {
            return JSON.parse(codeMatch[1].trim());
        } catch (_) {
            // 继续尝试其他格式
        }
    }

    // 匹配 <json>...</json>
    const tagRegex = /<json>([\s\S]*?)<\/json>/i;
    const tagMatch = text.match(tagRegex);
    if (tagMatch && tagMatch[1]) {
        try {
            return JSON.parse(tagMatch[1].trim());
        } catch (_) {
            // 忽略解析错误
        }
    }

    return null;
}

// -----------------------------------------------------------------------------
// 深合并两个对象（用于更新 currentState）
// -----------------------------------------------------------------------------
function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (
            source[key] &&
            typeof source[key] === 'object' &&
            !Array.isArray(source[key]) &&
            result[key] &&
            typeof result[key] === 'object' &&
            !Array.isArray(result[key])
        ) {
            result[key] = deepMerge(result[key], source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

// -----------------------------------------------------------------------------
// 简单的 {{key}} 模板替换（支持嵌套 key，如 {{player.name}}）
// -----------------------------------------------------------------------------
function renderTemplateString(html, state) {
    return html.replace(/\{\{([^{}]+)\}\}/g, (match, path) => {
        const keys = path.trim().split('.');
        let value = state;
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return match;
            }
        }
        return (value !== undefined && value !== null) ? String(value) : match;
    });
}

// -----------------------------------------------------------------------------
// 渲染 UI 面板
// -----------------------------------------------------------------------------
function renderUI() {
    const panel = document.getElementById('ui-template-manager-panel');
    if (!panel) return;

    const template = getCurrentTemplate();
    const s = extension_settings[SETTINGS_KEY];

    if (!template) {
        panel.innerHTML = `
            <div class="ut-empty">
                <p>当前角色未绑定 UI 模板。</p>
                <p class="ut-hint">请先导入模板，然后在下方选择模板并绑定到当前角色。</p>
            </div>
        `;
        return;
    }

    // 合并默认状态 + 当前状态
    const state = deepMerge(template.defaultState || {}, s.currentState || {});

    try {
        const renderedHtml = renderTemplateString(template.html, state);
        panel.innerHTML = `<div class="ut-template-wrapper">${renderedHtml}</div>`;
    } catch (err) {
        console.error('[UI Template Manager] 渲染失败:', err);
        panel.innerHTML = `<div class="ut-error">模板渲染失败: ${err.message}</div>`;
    }
}

// -----------------------------------------------------------------------------
// 处理 AI 消息事件：提取 JSON 并更新状态
// -----------------------------------------------------------------------------
function onMessageReceived(data) {
    if (!data || !data.message) return;

    const jsonData = extractJsonFromMessage(data.message);
    if (!jsonData) return;

    const s = extension_settings[SETTINGS_KEY];

    // 只更新与 UI 模板相关的状态（如果 JSON 中有 type 字段且匹配则更严格）
    // 这里采用宽松策略：任何 JSON 都合并到 currentState
    s.currentState = deepMerge(s.currentState || {}, jsonData);
    saveSettingsDebounced();

    // 触发重新渲染
    renderUI();
    renderFloatingUI();

    if (typeof toastr !== 'undefined') {
        toastr.success('UI 模板状态已更新', 'UI Template Manager');
    }
}

// -----------------------------------------------------------------------------
// 角色切换 / 聊天切换时重置状态并重新渲染
// -----------------------------------------------------------------------------
function onCharacterChanged() {
    const s = extension_settings[SETTINGS_KEY];
    const template = getCurrentTemplate();

    // 切换角色时重置为模板默认状态
    s.currentState = template ? { ...(template.defaultState || {}) } : {};
    saveSettingsDebounced();
    renderUI();
    renderTemplateList();
    renderBindingInfo();
    renderFloatingUI();
    injectTemplateStyles();
}

// -----------------------------------------------------------------------------
// 导入模板 JSON 文件
// -----------------------------------------------------------------------------
async function importTemplateFile(file) {
    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (data.type !== TEMPLATE_TYPE) {
            throw new Error(`文件类型不匹配，需要 "${TEMPLATE_TYPE}"，实际为 "${data.type}"`);
        }

        if (!data.templates || !Array.isArray(data.templates)) {
            throw new Error('JSON 格式错误：缺少 templates 数组');
        }

        const s = extension_settings[SETTINGS_KEY];
        let count = 0;

        for (const tpl of data.templates) {
            if (!tpl.id || !tpl.name) {
                console.warn('[UI Template Manager] 跳过无效模板:', tpl);
                continue;
            }
            // 如果 ID 已存在，加上时间戳后缀避免覆盖
            let id = tpl.id;
            if (s.templates[id]) {
                id = `${tpl.id}_${Date.now()}`;
            }
            s.templates[id] = {
                id: id,
                name: tpl.name,
                html: tpl.html || '',
                css: tpl.css || '',
                defaultState: tpl.defaultState || {},
            };
            count++;
        }

        saveSettingsDebounced();
        renderTemplateList();

        if (typeof toastr !== 'undefined') {
            toastr.success(`成功导入 ${count} 个模板`, 'UI Template Manager');
        }
    } catch (err) {
        console.error('[UI Template Manager] 导入失败:', err);
        if (typeof toastr !== 'undefined') {
            toastr.error(`导入失败: ${err.message}`, 'UI Template Manager');
        }
    }
}

// -----------------------------------------------------------------------------
// 导出指定模板为 JSON 文件
// -----------------------------------------------------------------------------
function exportTemplate(templateId) {
    const s = extension_settings[SETTINGS_KEY];
    const template = s.templates[templateId];

    if (!template) {
        if (typeof toastr !== 'undefined') {
            toastr.error('模板不存在', 'UI Template Manager');
        }
        return;
    }

    const exportData = {
        type: TEMPLATE_TYPE,
        version: 1,
        exportedAt: new Date().toISOString(),
        templates: [
            {
                id: template.id,
                name: template.name,
                html: template.html,
                css: template.css,
                defaultState: template.defaultState,
            },
        ],
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.name.replace(/[^a-z0-9_-]/gi, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// -----------------------------------------------------------------------------
// 绑定模板到当前角色
// -----------------------------------------------------------------------------
function bindTemplateToCurrentCharacter(templateId) {
    const charId = getCurrentCharacterId();
    if (!charId) {
        if (typeof toastr !== 'undefined') {
            toastr.error('当前没有选中的角色', 'UI Template Manager');
        }
        return;
    }

    const s = extension_settings[SETTINGS_KEY];

    if (templateId && !s.templates[templateId]) {
        if (typeof toastr !== 'undefined') {
            toastr.error('模板不存在', 'UI Template Manager');
        }
        return;
    }

    if (templateId) {
        s.characterBindings[charId] = templateId;
        // 绑定时重置状态为默认
        const tpl = s.templates[templateId];
        s.currentState = { ...(tpl.defaultState || {}) };
    } else {
        delete s.characterBindings[charId];
        s.currentState = {};
    }

    saveSettingsDebounced();
    renderUI();
    renderBindingInfo();

    if (typeof toastr !== 'undefined') {
        toastr.success(templateId ? '已绑定模板到当前角色' : '已解除绑定', 'UI Template Manager');
    }
}

// -----------------------------------------------------------------------------
// 删除模板
// -----------------------------------------------------------------------------
function deleteTemplate(templateId) {
    const s = extension_settings[SETTINGS_KEY];
    if (!s.templates[templateId]) return;

    if (!confirm(`确定要删除模板 "${s.templates[templateId].name}" 吗？`)) return;

    // 清除所有使用该模板的角色绑定
    for (const charId of Object.keys(s.characterBindings)) {
        if (s.characterBindings[charId] === templateId) {
            delete s.characterBindings[charId];
        }
    }

    delete s.templates[templateId];
    saveSettingsDebounced();
    renderTemplateList();
    renderUI();
    renderBindingInfo();

    if (typeof toastr !== 'undefined') {
        toastr.info('模板已删除', 'UI Template Manager');
    }
}

// -----------------------------------------------------------------------------
// 渲染模板列表（管理面板）
// -----------------------------------------------------------------------------
function renderTemplateList() {
    const listEl = document.getElementById('ui-template-manager-list');
    if (!listEl) return;

    const s = extension_settings[SETTINGS_KEY];
    const templates = Object.values(s.templates);

    if (templates.length === 0) {
        listEl.innerHTML = `<div class="ut-empty">暂无模板，请先导入。</div>`;
        return;
    }

    let html = '<div class="ut-template-list">';
    for (const tpl of templates) {
        html += `
            <div class="ut-template-item" data-id="${tpl.id}">
                <div class="ut-template-name">${escapeHtml(tpl.name)}</div>
                <div class="ut-template-actions">
                    <button class="ut-btn ut-btn-sm ut-btn-primary" data-action="bind" data-id="${tpl.id}">绑定</button>
                    <button class="ut-btn ut-btn-sm" data-action="export" data-id="${tpl.id}">导出</button>
                    <button class="ut-btn ut-btn-sm ut-btn-danger" data-action="delete" data-id="${tpl.id}">删除</button>
                </div>
            </div>
        `;
    }
    html += '</div>';
    listEl.innerHTML = html;

    // 绑定事件
    listEl.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const id = e.currentTarget.dataset.id;
            switch (action) {
                case 'bind':
                    bindTemplateToCurrentCharacter(id);
                    break;
                case 'export':
                    exportTemplate(id);
                    break;
                case 'delete':
                    deleteTemplate(id);
                    break;
            }
        });
    });
}

// -----------------------------------------------------------------------------
// 渲染当前绑定信息
// -----------------------------------------------------------------------------
function renderBindingInfo() {
    const infoEl = document.getElementById('ui-template-manager-binding');
    if (!infoEl) return;

    const charId = getCurrentCharacterId();
    const s = extension_settings[SETTINGS_KEY];

    if (!charId) {
        infoEl.innerHTML = '<span class="ut-muted">（未选择角色）</span>';
        return;
    }

    const templateId = s.characterBindings[charId];
    if (templateId && s.templates[templateId]) {
        infoEl.innerHTML = `
            <span>已绑定：<strong>${escapeHtml(s.templates[templateId].name)}</strong></span>
            <button class="ut-btn ut-btn-sm ut-btn-danger" id="ut-unbind-btn">解除绑定</button>
        `;
        document.getElementById('ut-unbind-btn').addEventListener('click', () => {
            bindTemplateToCurrentCharacter(null);
        });
    } else {
        infoEl.innerHTML = '<span class="ut-muted">未绑定任何模板</span>';
    }
}

// -----------------------------------------------------------------------------
// 工具函数：HTML 转义
// -----------------------------------------------------------------------------
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// -----------------------------------------------------------------------------
// 构建扩展面板 HTML（注入到 SillyTavern UI）
// -----------------------------------------------------------------------------
function buildExtensionPanel() {
    // 检查是否已存在
    if (document.getElementById('ui-template-manager-extension')) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'ui-template-manager-extension';
    wrapper.className = 'ut-extension-container';
    wrapper.innerHTML = `
        <div class="ut-header">
            <h3>UI Template Manager</h3>
            <div class="ut-subtitle">管理角色 UI 模板与状态</div>
        </div>

        <!-- 模板预览/渲染区域 -->
        <div class="ut-section">
            <div class="ut-section-title">模板预览</div>
            <div id="ui-template-manager-panel" class="ut-panel">
                <div class="ut-empty">加载中...</div>
            </div>
        </div>

        <!-- 当前绑定信息 -->
        <div class="ut-section">
            <div class="ut-section-title">当前角色绑定</div>
            <div id="ui-template-manager-binding" class="ut-binding-info">
                <span class="ut-muted">读取中...</span>
            </div>
        </div>

        <!-- 导入 / 管理 -->
        <div class="ut-section">
            <div class="ut-section-title">模板管理</div>
            <div class="ut-import-row">
                <input type="file" id="ut-import-input" accept=".json" style="display:none">
                <button class="ut-btn ut-btn-primary" id="ut-import-btn">导入模板 JSON</button>
            </div>
            <div id="ui-template-manager-list" class="ut-list-container">
                <div class="ut-empty">加载中...</div>
            </div>
        </div>
    `;

    // 把面板注入到 extensions 区域
    const extensionsArea = document.getElementById('extensions-settings');
    if (extensionsArea) {
        extensionsArea.appendChild(wrapper);
    } else {
        // 备选：注入到 body
        document.body.appendChild(wrapper);
    }

    // 绑定导入按钮
    const importBtn = document.getElementById('ut-import-btn');
    const importInput = document.getElementById('ut-import-input');
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) importTemplateFile(file);
        importInput.value = '';
    });
}

// -----------------------------------------------------------------------------
// 悬浮球：状态变量
// -----------------------------------------------------------------------------
let floatingBall = null;
let floatingPanel = null;
let isPanelOpen = false;
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let hasMoved = false;

// -----------------------------------------------------------------------------
// 创建悬浮球
// -----------------------------------------------------------------------------
function createFloatingBall() {
    if (document.getElementById('ut-floating-ball')) return;

    // 悬浮球
    floatingBall = document.createElement('div');
    floatingBall.id = 'ut-floating-ball';
    floatingBall.className = 'ut-floating-ball';
    floatingBall.title = 'UI Template Manager';
    floatingBall.innerHTML = `<span class="ut-ball-icon">📋</span>`;
    document.body.appendChild(floatingBall);

    // 浮动面板
    floatingPanel = document.createElement('div');
    floatingPanel.id = 'ut-floating-panel';
    floatingPanel.className = 'ut-floating-panel';
    floatingPanel.innerHTML = `
        <div class="ut-floating-header">
            <span class="ut-floating-title">UI 模板</span>
            <button class="ut-floating-close" id="ut-floating-close">×</button>
        </div>
        <div id="ui-template-manager-floating-panel" class="ut-floating-content">
            <div class="ut-empty">加载中...</div>
        </div>
    `;
    document.body.appendChild(floatingPanel);

    // 关闭按钮
    document.getElementById('ut-floating-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closeFloatingPanel();
    });

    // 拖拽逻辑
    floatingBall.addEventListener('mousedown', onDragStart);
    floatingBall.addEventListener('touchstart', onDragStart, { passive: false });

    // 点击展开/收起（区分点击和拖拽）
    floatingBall.addEventListener('click', (e) => {
        if (!hasMoved) {
            toggleFloatingPanel();
        }
    });

    // 从设置中恢复位置
    const s = extension_settings[SETTINGS_KEY];
    if (s.ballPosition) {
        floatingBall.style.left = s.ballPosition.left + 'px';
        floatingBall.style.top = s.ballPosition.top + 'px';
    } else {
        // 默认位置：右下角
        floatingBall.style.right = '20px';
        floatingBall.style.bottom = '100px';
    }

    // 注入模板自定义 CSS
    injectTemplateStyles();
}

// -----------------------------------------------------------------------------
// 拖拽开始
// -----------------------------------------------------------------------------
function onDragStart(e) {
    isDragging = true;
    hasMoved = false;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const rect = floatingBall.getBoundingClientRect();
    dragOffsetX = clientX - rect.left;
    dragOffsetY = clientY - rect.top;

    // 清除 right/bottom，改用 left/top
    floatingBall.style.right = 'auto';
    floatingBall.style.bottom = 'auto';

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);

    e.preventDefault();
}

// -----------------------------------------------------------------------------
// 拖拽移动
// -----------------------------------------------------------------------------
function onDragMove(e) {
    if (!isDragging) return;

    hasMoved = true;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    let left = clientX - dragOffsetX;
    let top = clientY - dragOffsetY;

    // 边界限制
    const maxLeft = window.innerWidth - floatingBall.offsetWidth;
    const maxTop = window.innerHeight - floatingBall.offsetHeight;
    left = Math.max(0, Math.min(left, maxLeft));
    top = Math.max(0, Math.min(top, maxTop));

    floatingBall.style.left = left + 'px';
    floatingBall.style.top = top + 'px';

    // 如果面板已打开，同步更新面板位置
    if (isPanelOpen) {
        updatePanelPosition();
    }

    e.preventDefault();
}

// -----------------------------------------------------------------------------
// 拖拽结束
// -----------------------------------------------------------------------------
function onDragEnd() {
    isDragging = false;

    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('touchend', onDragEnd);

    // 保存位置
    const s = extension_settings[SETTINGS_KEY];
    s.ballPosition = {
        left: floatingBall.offsetLeft,
        top: floatingBall.offsetTop,
    };
    saveSettingsDebounced();
}

// -----------------------------------------------------------------------------
// 切换浮动面板显示/隐藏
// -----------------------------------------------------------------------------
function toggleFloatingPanel() {
    if (isPanelOpen) {
        closeFloatingPanel();
    } else {
        openFloatingPanel();
    }
}

// -----------------------------------------------------------------------------
// 打开浮动面板
// -----------------------------------------------------------------------------
function openFloatingPanel() {
    isPanelOpen = true;
    floatingPanel.classList.add('ut-floating-panel-open');
    updatePanelPosition();
    renderFloatingUI();
}

// -----------------------------------------------------------------------------
// 关闭浮动面板
// -----------------------------------------------------------------------------
function closeFloatingPanel() {
    isPanelOpen = false;
    floatingPanel.classList.remove('ut-floating-panel-open');
}

// -----------------------------------------------------------------------------
// 更新浮动面板位置（跟随悬浮球）
// -----------------------------------------------------------------------------
function updatePanelPosition() {
    if (!floatingBall || !floatingPanel) return;

    const ballRect = floatingBall.getBoundingClientRect();
    const panelWidth = 320;
    const panelHeight = 400;
    const gap = 10;

    // 优先显示在悬浮球左侧
    let left = ballRect.left - panelWidth - gap;
    let top = ballRect.top;

    // 如果左侧空间不够，显示在右侧
    if (left < 10) {
        left = ballRect.right + gap;
    }

    // 垂直方向边界检查
    if (top + panelHeight > window.innerHeight - 10) {
        top = window.innerHeight - panelHeight - 10;
    }
    if (top < 10) {
        top = 10;
    }

    floatingPanel.style.left = left + 'px';
    floatingPanel.style.top = top + 'px';
}

// -----------------------------------------------------------------------------
// 渲染浮动面板中的 UI 模板
// -----------------------------------------------------------------------------
function renderFloatingUI() {
    const panel = document.getElementById('ui-template-manager-floating-panel');
    if (!panel) return;

    const template = getCurrentTemplate();
    const s = extension_settings[SETTINGS_KEY];

    if (!template) {
        panel.innerHTML = `
            <div class="ut-empty">
                <p>当前角色未绑定 UI 模板。</p>
                <p class="ut-hint">请在扩展设置中导入并绑定模板。</p>
            </div>
        `;
        return;
    }

    const state = deepMerge(template.defaultState || {}, s.currentState || {});

    try {
        const renderedHtml = renderTemplateString(template.html, state);
        panel.innerHTML = `<div class="ut-template-wrapper">${renderedHtml}</div>`;
    } catch (err) {
        console.error('[UI Template Manager] 浮动面板渲染失败:', err);
        panel.innerHTML = `<div class="ut-error">模板渲染失败: ${err.message}</div>`;
    }
}

// -----------------------------------------------------------------------------
// 注入当前模板的自定义 CSS
// -----------------------------------------------------------------------------
function injectTemplateStyles() {
    const template = getCurrentTemplate();
    if (!template || !template.css) return;

    let styleEl = document.getElementById('ut-template-dynamic-style');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'ut-template-dynamic-style';
        document.head.appendChild(styleEl);
    }

    // 给模板 CSS 加上作用域前缀，避免影响全局
    const scopedCss = template.css
        .split('\n')
        .map(line => {
            // 简单地给每个选择器加上 .ut-template-wrapper 前缀
            return line.replace(/^([^{]+)\{/g, (match, selector) => {
                const scopedSelectors = selector
                    .split(',')
                    .map(s => '.ut-template-wrapper ' + s.trim())
                    .join(', ');
                return scopedSelectors + ' {';
            });
        })
        .join('\n');

    styleEl.textContent = scopedCss;
}

// -----------------------------------------------------------------------------
// 入口：扩展加载
// -----------------------------------------------------------------------------
function init() {
    initSettings();

    // 构建 UI 面板
    buildExtensionPanel();

    // 创建悬浮球
    createFloatingBall();

    // 初始渲染
    renderTemplateList();
    renderBindingInfo();
    renderUI();
    renderFloatingUI();
    injectTemplateStyles();

    // 注册事件监听
    if (eventSource && eventSource.addEventListener) {
        // 收到新消息 → 解析 JSON 更新状态
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

        // 角色切换 → 重置状态并重渲染
        eventSource.on(event_types.CHARACTER_CHANGED, onCharacterChanged);

        // 聊天切换 → 同上
        eventSource.on(event_types.CHAT_CHANGED, onCharacterChanged);
    }

    // 窗口大小变化时重新定位面板
    window.addEventListener('resize', () => {
        if (isPanelOpen) {
            updatePanelPosition();
        }
    });

    console.log('[UI Template Manager] 扩展已加载');
}

// 等待 DOM 就绪后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// 暴露部分方法便于调试（可选）
window.UITemplateManager = {
    getSettings: () => extension_settings[SETTINGS_KEY],
    renderUI,
    importTemplateFile,
    exportTemplate,
    bindTemplateToCurrentCharacter,
    getCurrentTemplate,
    renderFloatingUI,
    toggleFloatingPanel,
    openFloatingPanel,
    closeFloatingPanel,
};
