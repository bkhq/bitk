# FEAT-006 添加 Notes 笔记功能

- **status**: completed
- **priority**: P1
- **owner**: claude
- **created**: 2026-03-05
- **plan**: PLAN-010

## 描述

在 AppSidebar 底部的终端按钮下方添加 Notes（笔记）入口。点击后打开一个 Drawer 面板，用户可以在其中编写和保存笔记。笔记数据持久化到 SQLite 数据库。

## 验收标准

- [x] Sidebar 中终端按钮下方出现笔记图标按钮
- [x] 点击按钮打开 NotesDrawer 面板（与 TerminalDrawer 风格一致）
- [x] 支持创建、编辑、删除笔记
- [x] 笔记内容持久化到数据库
- [x] 支持 i18n（中英文）
