# 贡献指南

感谢你对 Skills Manager 的关注！

## 开发流程

### 1. Fork 仓库

点击右上角的 Fork 按钮。

### 2. 克隆到本地

```bash
git clone https://github.com/YOUR_USERNAME/Skills-Manager.git
cd Skills-Manager
```

### 3. 创建分支

```bash
git checkout -b feat/your-feature-name
```

分支命名规范：
- `feat/` - 新功能
- `fix/` - Bug 修复
- `docs/` - 文档更新
- `refactor/` - 代码重构
- `test/` - 测试相关

### 4. 安装依赖

```bash
npm install
cd src-tauri
cargo build
```

### 5. 开发

```bash
npm run tauri dev
```

### 6. 测试

```bash
# 前端测试
npm test

# Rust 测试
cd src-tauri
cargo test
```

### 7. 提交代码

遵循 Conventional Commits 规范：

```bash
git commit -m "feat: add skill export feature"
git commit -m "fix: resolve symlink creation on Windows"
```

提交类型：
- `feat` - 新功能
- `fix` - Bug 修复
- `docs` - 文档
- `style` - 格式（不影响代码逻辑）
- `refactor` - 重构
- `test` - 测试
- `chore` - 构建/工具链

### 8. 推送并创建 PR

```bash
git push origin feat/your-feature-name
```

然后在 GitHub 上创建 Pull Request。

## PR 规范

**标题格式：**
```
feat: add AI translation caching
fix: resolve skill sync race condition
```

**描述模板：**
```markdown
## 变更说明
简要描述这个 PR 做了什么。

## 测试
- [ ] 本地测试通过
- [ ] 添加了单元测试
- [ ] 在 macOS 测试通过
- [ ] 在 Windows 测试通过（如适用）

## Screenshots（如果是 UI 变更）
![before](...)
![after](...)

## Checklist
- [ ] 遵循代码风格
- [ ] 更新了文档
- [ ] 通过了所有测试
- [ ] 没有引入新的警告
```

## 代码风格

### TypeScript/React
- 使用 2 空格缩进
- 使用函数组件和 Hooks
- 遵循 ESLint 规则

### Rust
- 遵循 `rustfmt` 格式
- 运行 `cargo clippy` 检查
- 添加必要的注释

## 提问与讨论

- 💬 [Discussions](https://github.com/jiweiyeah/Skills-Manager/discussions)
- 🐛 [Issues](https://github.com/jiweiyeah/Skills-Manager/issues)

## 行为准则

请尊重所有贡献者，保持友善和专业。
