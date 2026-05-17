# FactorioWebTS Mod管理系统 - 问题分析与重构计划

## 一、已识别的关键问题

### 🔴 严重问题 (P0 - 必须修复)

#### 1. **前端错误处理缺陷**
- **位置**: [mod.html:103](file:///home/air/Documents/FactorioWebTS/public/pages/mod.html#L103), [mod.html:160](file:///home/air/Documents/FactorioWebTS/public/pages/mod.html#L160)
- **问题**: `catch(e) {}` 空捕获块，用户无任何错误反馈
- **影响**: 网络故障、服务器错误时用户完全不知道发生了什么
- **修复方案**: 统一错误处理，显示友好的错误消息

#### 2. **后端uninstall接口缺少Schema验证**
- **位置**: [mod.routes.ts:43-44](file:///home/air/Documents/FactorioWebTS/src/modules/mod/mod.routes.ts#L43-L44)
- **问题**: 使用手动类型断言 `(request.body || {}) as { mod_id?: number }` 而非Zod schema
- **影响**: 输入验证不一致，可能接收非法数据
- **修复方案**: 创建uninstallSchema并统一验证流程

#### 3. **冲突检测逻辑错误**
- **位置**: [mod.service.ts:110](file:///home/air/Documents/FactorioWebTS/src/modules/mod/mod.service.ts#L110)
- **问题**: `!installedNames.has(name) && !selectedNames.has(name)` 逻辑有误
- **影响**: 无法正确检测必需依赖缺失的情况
- **修复方案**: 应该检查 `!installedNames.has(name)` 即可，因为selectedNames是installedNames的子集

### 🟠 中等问题 (P1 - 应该修复)

#### 4. **缺少加载状态指示器**
- **位置**: [mod.html:98-104](file:///home/air/Documents/FactorioWebTS/public/pages/mod.html#L98-L104)
- **问题**: 异步操作期间用户无法知道是否正在处理
- **影响**: 用户体验差，可能导致重复操作
- **修复方案**: 添加loading状态和禁用按钮

#### 5. **缺少搜索和过滤功能**
- **位置**: [mod.html:47-67](file:///home/air/Documents/FactorioWebTS/public/pages/mod.html#L47-L67)
- **问题**: 只能查看全部mod列表，无法按名称、版本、状态筛选
- **影响**: mod数量多时难以管理
- **修复方案**: 添加搜索框和过滤器组件

#### 6. **性能问题：串行更新检查**
- **位置**: [mod.service.ts:126-140](file:///home/air/Documents/FactorioWebTS/src/modules/mod/mod.service.ts#L126-L140)
- **问题**: 逐个调用Factorio API检查更新，无并发控制
- **影响**: 10个mod需要10次串行请求，耗时较长
- **修复方案**: 使用Promise.allSettled并行请求，限制并发数

#### 7. **sync功能不完整**
- **位置**: [mod.service.ts:236-278](file:///home/air/Documents/FactorioWebTS/src/modules/mod/mod.service.ts#L236-L278)
- **问题**: 同步时不清理数据库中已删除的mod记录
- **影响**: 数据库与文件系统不同步，出现幽灵记录
- **修复方案**: 检测并删除不再存在的mod记录

#### 8. **ZIP解析代码缺乏健壮性**
- **位置**: [mod.service.ts:160-234](file:///home/air/Documents/FactorioWebTS/src/modules/mod/mod.service.ts#L160-L234)
- **问题**:
  - 无文件大小限制检查
  - 无超时机制
  - 错误信息不够详细
  - 缺少对malformed zip的处理
- **影响**: 大文件或损坏zip可能导致内存溢出或崩溃
- **修复方案**: 添加安全限制和详细的错误日志

### 🟡 改进建议 (P2 - 建议优化)

#### 9. **前端功能缺失**
- ❌ 缺少mod安装功能（从URL上传/portal下载）
- ❌ 缺少mod详情页面
- ❌ 缺少批量操作（批量启用/禁用/卸载）
- ❌ 缺少导出mod列表功能
- ❌ 缺少mod配置编辑功能

#### 10. **用户体验问题**
- 依赖展示格式过于简单，应该可视化依赖树
- 操作确认对话框可以更详细（显示影响范围）
- 应该添加操作历史记录
- 应该支持键盘快捷键

#### 11. **代码质量问题**
- Service层缺少日志记录（成功/失败/性能指标）
- 错误消息不够国际化友好
- 魔法数字未提取为常量
- 注释不够充分，特别是ZIP解析部分

#### 12. **测试覆盖不足**
- ❌ 缺少sync功能的集成测试
- ❌ 缺少check-updates的mock测试
- ❌ 缺少ZIP解析的单元测试
- ❌ 缺少边界条件测试（空列表、特殊字符、并发操作）

## 二、重构计划

### Phase 1: 关键问题修复 (P0)
1. ✅ 完善前端错误处理机制
2. ✅ 统一后端输入验证（添加uninstall/check-conflicts schema）
3. ✅ 修复冲突检测逻辑bug

### Phase 2: 功能增强 (P1)
4. ✅ 添加加载状态和用户反馈
5. ✅ 实现搜索过滤功能
6. ✅ 优化更新检查性能（并发请求）
7. ✅ 完善sync逻辑（清理孤儿记录）
8. ✅ 增强ZIP解析安全性

### Phase 3: 体验优化 (P2)
9. 📋 添加mod安装功能
10. 📋 实现批量操作
11. 📋 改进UI/UX设计
12. 📋 补充测试用例

## 三、技术改进点

### 架构层面
- 引入统一的响应包装器
- 实现中间件复用（认证/授权/日志）
- 抽取公共工具函数
- 建立错误码体系

### 数据层面
- 添加数据库索引优化查询
- 实现数据版本控制
- 添加操作审计日志
- 支持数据备份恢复

### 安全层面
- 速率限制（防止API滥用）
- 输入消毒（防XSS/注入）
- 文件上传大小限制
- 操作权限细化

### 可维护性
- TypeScript严格模式
- ESLint规则统一
- 自动化CI/CD流程
- API文档自动生成

---

**生成时间**: 2026-05-16
**分析范围**: FactorioWebTS v1.0 vs FactorioWeb (参考项目)
**下一步**: 开始Phase 1关键问题修复实施
