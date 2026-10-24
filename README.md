# opencode-transparent

让 OpenCode 的背景透明、标签（tab）也透明，透过终端看到桌面壁纸。

> 前提：你的终端本身已经开启透明效果。插件只负责清掉 OpenCode 自己的背景色，能不能看见壁纸由终端决定。

## 效果

- OpenCode 主背景透明
- 标签栏透明
- 面板、输入框阴影、弹窗遮罩一起处理，不会留下半透明灰块
- 文字对比度自动维持在 4.5:1 以上，透明之后也不会看不清

## 安装

### 方式一：git clone（推荐）

```bash
git clone https://github.com/linxuan-sys/opencode-transparent.git ~/.config/opencode/plugins/transparent
```

SSH 也可以：

```bash
git clone git@github.com:linxuan-sys/opencode-transparent.git ~/.config/opencode/plugins/transparent
```

### 方式二：只下载一个文件

1. 在仓库里点开 `tui.ts`
2. 点右上角 **Raw**
3. 右键另存为，文件名必须是 `tui.ts`
4. 放到这里：

```text
~/.config/opencode/plugins/transparent/tui.ts
```

**`transparent` 这个文件夹要自己新建。** 不能把 `tui.ts` 直接丢在 `plugins/` 根目录下，OpenCode 只会在 `plugins/` 的**子目录**里找 TUI 插件。

### 方式三：下载 ZIP

网页上 **Code → Download ZIP**，解压后把整个文件夹放进 `~/.config/opencode/plugins/`，文件夹名随意。

## 装好之后

目录结构应该是这样：

```text
~/.config/opencode/
└── plugins/
    └── transparent/
        ├── tui.ts       ← 插件本体，必须有
        ├── README.md
        └── LICENSE
```

然后**完全退出 OpenCode 再重新打开**（不是新开窗口）。

不需要改 `opencode.json` 或 `cli.json`，放在 `plugins/` 下会被自动发现。

## 背景还是不透明？按顺序排查

1. **终端没开透明**（最常见）

   | 终端 | 配置项 |
   |---|---|
   | kitty | `background_opacity 0.85` |
   | alacritty | `window.opacity = 0.85` |
   | wezterm | `window_background_opacity = 0.85` |
   | ghostty | `background-opacity = 0.85` |

2. **终端开了模糊** —— 部分终端把透明换算成毛玻璃，看起来像灰色，把 blur 关掉试试
3. **没有重启 OpenCode** —— 改完插件必须完全退出重开

## 和其他插件共存

`plugins/` 下每个插件各自一个子目录，互不影响，比如侧栏宠物 `pet`。

## 实现说明

单文件插件，不需要 `npm install`，没有额外依赖。`@opentui/core` 由 OpenCode 运行时提供，不要自己装。

做法是逐帧清理背景色，并按透明度还原需要显示的图片和弹窗遮罩，避免透明模式下图被一起擦掉。

## 许可

MIT，见 [LICENSE](./LICENSE)。
