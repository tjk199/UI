# UI Template Manager

一个 SillyTavern 第三方扩展，用于管理 `rp-hub-ui-templates` 格式的 UI 模板，支持把模板绑定到角色，并通过监听 AI 消息中的 JSON 来动态更新模板状态。

## 功能特性

- 📦 **导入 / 导出**：支持导入 `rp-hub-ui-templates` 格式的 JSON 模板文件，也可导出单个模板
- 🎭 **角色绑定**：每个角色可以绑定一个专属的 UI 模板，切换角色自动切换
- 🤖 **消息驱动**：监听 AI 消息中的 JSON 代码块，自动解析并更新模板状态
- 🎨 **模板渲染**：支持 `{{key}}` 和 `{{nested.key}}` 变量替换，简单灵活
- 💾 **状态持久化**：模板、绑定关系、当前状态都会保存在扩展设置中

## 安装方法

1. 将整个 `UI-Template-Manager` 文件夹放入 SillyTavern 的 `public/scripts/extensions/third-party/` 目录下
2. 重启 SillyTavern 或在扩展面板中刷新扩展列表
3. 在 SillyTavern 的「扩展设置」面板中找到「UI Template Manager」即可使用

## 使用方法

### 1. 导入模板

点击「导入模板 JSON」按钮，选择符合 `rp-hub-ui-templates` 格式的 JSON 文件。

模板 JSON 格式示例：

```json
{
  "type": "rp-hub-ui-templates",
  "version": 1,
  "templates": [
    {
      "id": "character-status-card",
      "name": "角色状态卡",
      "html": "<div class=\"status-card\"><h2>{{name}}</h2><p>HP: {{hp}}/{{maxHp}}</p><p>MP: {{mp}}/{{maxMp}}</p></div>",
      "css": ".status-card { padding: 16px; background: #1e1e2e; border-radius: 8px; }",
      "defaultState": {
        "name": "未知角色",
        "hp": 100,
        "maxHp": 100,
        "mp": 50,
        "maxMp": 50
      }
    }
  ]
}
```

### 2. 绑定到角色

1. 选择你想要绑定模板的角色
2. 在模板列表中找到对应模板，点击「绑定」按钮
3. 绑定成功后，模板预览区域会显示使用默认状态渲染的效果

### 3. 让 AI 输出 JSON 来更新状态

在你的系统提示词（System Prompt）或角色卡中加入指令，让 AI 在回复时附带 JSON 数据来更新 UI 模板状态。

支持两种 JSON 包裹格式：

**格式一：代码块（推荐）**
````
```json
{
  "hp": 85,
  "mp": 30,
  "status": ["中毒", "虚弱"]
}
```
````

**格式二：XML 标签**
```
<json>{"hp": 85, "mp": 30}</json>
```

### 提示词示例

你可以在系统提示词中加入类似这样的内容：

```
在每次回复的末尾，请用 ```json 代码块输出当前角色状态的 JSON 数据，格式如下：
{
  "name": "角色名",
  "hp": 当前生命值,
  "maxHp": 最大生命值,
  "mp": 当前魔法值,
  "maxMp": 最大魔法值
}
只输出数值变化，不要输出未变化的字段。
```

## 模板变量语法

- 简单变量：`{{name}}` → 替换为 `state.name`
- 嵌套变量：`{{player.hp}}` → 替换为 `state.player.hp`
- 如果变量不存在，`{{key}}` 会原样保留，不会报错

## 已知限制

1. **模板渲染能力有限**：当前只支持简单的变量替换（`{{key}}`），不支持条件判断、循环等复杂逻辑
2. **JSON 解析策略宽松**：只要消息中包含合法 JSON 代码块就会合并到状态，可能会误解析非 UI 相关的 JSON
3. **单模板绑定**：每个角色只能绑定一个模板，不支持多个模板叠加
4. **无在线模板库**：当前仅支持本地 JSON 文件导入，没有内置模板市场
5. **安全考虑**：模板 HTML 直接通过 `innerHTML` 渲染，存在 XSS 风险，请只导入可信来源的模板
6. **状态合并策略**：使用深合并（deep merge），数组会被整体替换而非合并

## 调试

扩展会在 `window.UITemplateManager` 上暴露部分方法，可在浏览器控制台中调用：

```js
// 查看当前设置
UITemplateManager.getSettings()

// 手动重新渲染
UITemplateManager.renderUI()

// 获取当前绑定的模板
UITemplateManager.getCurrentTemplate()
```

## License

MIT
