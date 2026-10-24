import {
  ImageRenderable,
  normalizeTerminalPalette,
  RGBA,
  TextAttributes,
} from "@opentui/core"

// 透明插件：逐帧清理背景，包含 tab 条、面板、输入框阴影和模态遮罩。
// 实现来自 opencode-tui-extras 的透明模块，去掉了与本功能无关的部分。

const MIN_TEXT_CONTRAST = 4.5
const UPPER_HALF_BLOCK = "▀".codePointAt(0)!
const SPACE = " ".codePointAt(0)!
const MIN_PROMPT_SHADOW_WIDTH = 8
const BOX_DRAWING_START = 9472
const BOX_DRAWING_END = 9599

function luminance(channels: number[]) {
  const [red, green, blue] = channels.slice(0, 3).map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(first: number[], second: number[]) {
  const left = luminance(first)
  const right = luminance(second)
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05)
}

function readableTarget(background: number[], foreground: number[]) {
  if (contrast(background, foreground) >= MIN_TEXT_CONTRAST) return foreground
  const black = [0, 0, 0, 255]
  const white = [255, 255, 255, 255]
  return contrast(background, black) >= contrast(background, white) ? black : white
}

function readableTransparentForeground(foreground: number[], surface: any) {
  if (surface.adapt === false) return foreground
  const background = surface.background.toInts()
  if (foreground[3] === 0 || contrast(foreground, background) >= MIN_TEXT_CONTRAST)
    return foreground
  const target = readableTarget(background, surface.foreground.toInts())
  const chroma =
    Math.max(foreground[0], foreground[1], foreground[2]) -
    Math.min(foreground[0], foreground[1], foreground[2])
  if (chroma <= 24) return [target[0], target[1], target[2], foreground[3]]
  for (let step = 1; step <= 20; step += 1) {
    const amount = step / 20
    const candidate = [
      Math.round(foreground[0] * (1 - amount) + target[0] * amount),
      Math.round(foreground[1] * (1 - amount) + target[1] * amount),
      Math.round(foreground[2] * (1 - amount) + target[2] * amount),
      foreground[3],
    ]
    if (contrast(candidate, background) >= MIN_TEXT_CONTRAST) return candidate
  }
  return [target[0], target[1], target[2], foreground[3]]
}

function transparentSurface(background: any, foreground: any, mode: string) {
  const darkBackground = luminance(background.toInts()) < 0.5
  return {
    background,
    foreground,
    adapt: (mode === "light" && darkBackground) || (mode === "dark" && !darkBackground),
  }
}

function matches(channels: ArrayLike<number>, offset: number, color: number[]) {
  return (
    channels[offset] === color[0] &&
    channels[offset + 1] === color[1] &&
    channels[offset + 2] === color[2] &&
    channels[offset + 3] === color[3]
  )
}

function clearThemeBackgrounds(buffer: any, colors: any[], surface: any) {
  const { fg, bg } = buffer.buffers
  const targets = colors.map((color) => color.toInts())
  const foregrounds = new Map<string, number[]>()
  let cleared = 0

  for (let offset = 0; offset < bg.length; offset += 4) {
    const target = targets.some((value) => matches(bg, offset, value))
    const alreadyTransparent = bg[offset + 3] === 0
    if (target) {
      bg[offset] = 0
      bg[offset + 1] = 0
      bg[offset + 2] = 0
      bg[offset + 3] = 0
      cleared += 1
    }
    if (surface && (target || alreadyTransparent)) {
      const original = [fg[offset], fg[offset + 1], fg[offset + 2], fg[offset + 3]]
      const key = original.join(",")
      const readable = foregrounds.get(key) ?? readableTransparentForeground(original, surface)
      foregrounds.set(key, readable)
      fg[offset] = readable[0]
      fg[offset + 1] = readable[1]
      fg[offset + 2] = readable[2]
      fg[offset + 3] = readable[3]
    }
  }
  return cleared
}

function inside(rect: any, x: number, y: number) {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
}

function hasInternalBackground(renderable: any) {
  return "_backgroundColor" in renderable
}

function suppressModalBackdropFrame(root: any, transparent: any, patched: Map<any, any>) {
  const active = new Set<any>()
  const queue = [...root.getChildren()]
  while (queue.length > 0) {
    const renderable: any = queue.shift()
    if (!renderable.visible || renderable.isDestroyed) continue
    const original = patched.get(renderable)
    if (original && hasInternalBackground(renderable)) {
      renderable._backgroundColor = transparent
      active.add(renderable)
    } else if (
      renderable.zIndex >= 3000 &&
      renderable.getChildrenCount() > 0 &&
      hasInternalBackground(renderable)
    ) {
      const channels = renderable._backgroundColor.toInts()
      if (
        channels[0] === 0 &&
        channels[1] === 0 &&
        channels[2] === 0 &&
        channels[3] > 0 &&
        channels[3] < 255
      ) {
        patched.set(renderable, renderable._backgroundColor)
        renderable._backgroundColor = transparent
        active.add(renderable)
      }
    }
    queue.push(...renderable.getChildren())
  }
  for (const [renderable, background] of patched) {
    if (active.has(renderable)) continue
    if (!renderable.isDestroyed && hasInternalBackground(renderable))
      renderable._backgroundColor = background
    patched.delete(renderable)
  }
  return active.size
}

function installModalBackdropSuppression(context: any, transparent: any) {
  const root = context.renderer.root
  const previous = root.onLifecyclePass
  const wasRegistered = context.renderer.getLifecyclePasses().has(root)
  const patched = new Map<any, any>()

  const lifecycle = function (this: any) {
    previous?.call(this)
    suppressModalBackdropFrame(root, transparent, patched)
  }

  root.onLifecyclePass = lifecycle
  if (!wasRegistered) context.renderer.registerLifecyclePass(root)

  return () => {
    if (root.onLifecyclePass === lifecycle) root.onLifecyclePass = previous
    if (!wasRegistered) context.renderer.unregisterLifecyclePass(root)
    for (const [renderable, background] of patched) {
      if (!renderable.isDestroyed && hasInternalBackground(renderable))
        renderable._backgroundColor = background
    }
    patched.clear()
  }
}

function clearOutsideRect(buffer: any, protectedRect: any, surface: any, dim = false) {
  const foregrounds = new Map<string, number[]>()
  const { fg, bg, attributes } = buffer.buffers
  let cleared = 0

  for (let y = 0; y < buffer.height; y += 1) {
    for (let x = 0; x < buffer.width; x += 1) {
      if (inside(protectedRect, x, y)) continue
      const cell = y * buffer.width + x
      const offset = cell * 4
      bg[offset] = 0
      bg[offset + 1] = 0
      bg[offset + 2] = 0
      bg[offset + 3] = 0
      const original = [fg[offset], fg[offset + 1], fg[offset + 2], fg[offset + 3]]
      const key = original.join(",")
      const readable = foregrounds.get(key) ?? readableTransparentForeground(original, surface)
      foregrounds.set(key, readable)
      fg[offset] = readable[0]
      fg[offset + 1] = readable[1]
      fg[offset + 2] = readable[2]
      fg[offset + 3] = readable[3]
      if (dim) attributes[cell] |= TextAttributes.DIM
      cleared += 1
    }
  }
  return cleared
}

function modalPanel(root: any, width: number, height: number) {
  const queue = [...root.getChildren()]
  while (queue.length > 0) {
    const node: any = queue.shift()
    if (!node.visible || node.isDestroyed) continue
    if (node.zIndex >= 3000 && node.width >= width && node.height >= height) {
      const panel = node.getChildren().find(
        (child: any) =>
          child.visible &&
          !child.isDestroyed &&
          child.width > 0 &&
          child.height > 0 &&
          (child.width < node.width || child.height < node.height),
      )
      if (panel) {
        const x = Math.max(0, Math.floor(panel.screenX))
        const y = Math.max(0, Math.floor(panel.screenY))
        return {
          renderable: panel,
          rect: {
            x,
            y,
            width: Math.max(0, Math.min(width - x, Math.ceil(panel.width))),
            height: Math.max(0, Math.min(height - y, Math.ceil(panel.height))),
          },
        }
      }
    }
    queue.push(...node.getChildren())
  }
  return undefined
}

function clearModalDecorations(buffer: any, protectedRect: any) {
  const { char, fg } = buffer.buffers
  let cleared = 0
  for (let y = 0; y < buffer.height; y += 1) {
    for (let x = 0; x < buffer.width; x += 1) {
      if (inside(protectedRect, x, y)) continue
      const cell = y * buffer.width + x
      const raw = char[cell] >>> 0
      if (raw >>> 30 !== 0) continue
      if (raw !== UPPER_HALF_BLOCK && (raw < BOX_DRAWING_START || raw > BOX_DRAWING_END)) continue
      char[cell] = SPACE
      fg[cell * 4 + 3] = 0
      cleared += 1
    }
  }
  return cleared
}

function descendants(root: any) {
  const result = new Set<any>()
  const queue = [root]
  while (queue.length > 0) {
    const node = queue.shift()
    result.add(node)
    queue.push(...node.getChildren())
  }
  return result
}

function syncModalImageOpacity(
  root: any,
  panel: any,
  hidden: Map<any, any>,
  isImage: (r: any) => boolean = (r) => r instanceof ImageRenderable,
) {
  const panelTree = panel ? descendants(panel) : new Set<any>()
  const all = descendants(root)
  for (const renderable of all) {
    if (!isImage(renderable)) continue
    if (panelTree.has(renderable)) {
      const opacity = hidden.get(renderable)
      if (opacity !== undefined) {
        renderable.opacity = opacity
        hidden.delete(renderable)
      }
      continue
    }
    if (panel && !hidden.has(renderable)) {
      hidden.set(renderable, renderable.opacity)
      renderable.opacity = 0
    }
  }
  for (const [renderable, opacity] of hidden) {
    if (panel && all.has(renderable) && !panelTree.has(renderable)) continue
    if (!renderable.isDestroyed) renderable.opacity = opacity
    hidden.delete(renderable)
  }
}

function clearPromptShadow(buffer: any, color: any) {
  const { char, fg } = buffer.buffers
  const target = color.toInts()
  let cleared = 0

  for (let y = 0; y < buffer.height; y += 1) {
    let start = -1
    for (let x = 0; x <= buffer.width; x += 1) {
      const cell = y * buffer.width + x
      const offset = cell * 4
      const matchesShadow =
        x < buffer.width && char[cell] === UPPER_HALF_BLOCK && matches(fg, offset, target)
      if (matchesShadow && start === -1) {
        start = x
        continue
      }
      if (matchesShadow || start === -1) continue
      if (x - start >= MIN_PROMPT_SHADOW_WIDTH) {
        for (let shadowX = start; shadowX < x; shadowX += 1) {
          const shadowCell = y * buffer.width + shadowX
          char[shadowCell] = SPACE
          fg[shadowCell * 4 + 3] = 0
          cleared += 1
        }
      }
      start = -1
    }
  }
  return cleared
}

export default {
  id: "transparent-tabs",
  setup(context: any) {
    const transparent = RGBA.fromInts(0, 0, 0, 0)
    let terminalSurface = transparentSurface(
      RGBA.defaultBackground(),
      RGBA.defaultForeground(),
      context.themeMode,
    )
    let activeTheme = context.theme
    let activeMode = context.themeMode
    let disposed = false
    let backgroundSyncQueued = false
    const hiddenImages = new Map<any, any>()

    const disposeModal = installModalBackdropSuppression(context, transparent)

    const syncTerminalSurface = () => {
      void context.renderer.getPalette({ timeout: 250 }).then(
        (detected: any) => {
          if (disposed) return
          const normalized = normalizeTerminalPalette(detected)
          terminalSurface = transparentSurface(
            normalized.defaultBackground,
            normalized.defaultForeground,
            context.themeMode,
          )
          context.renderer.requestRender()
        },
        () => {},
      )
    }

    const syncRendererBackground = () => {
      if (disposed || backgroundSyncQueued) return
      backgroundSyncQueued = true
      queueMicrotask(() => {
        backgroundSyncQueued = false
        if (!disposed) context.renderer.setBackgroundColor(transparent)
      })
    }

    const postProcess = (buffer: any) => {
      const theme = context.theme
      const mode = context.themeMode

      if (theme !== activeTheme || mode !== activeMode) {
        activeTheme = theme
        activeMode = mode
        terminalSurface = transparentSurface(
          terminalSurface.background,
          terminalSurface.foreground,
          mode,
        )
        syncRendererBackground()
        syncTerminalSurface()
      }

      const promptBackground = theme.decrease(theme.background.raised.base)
      clearPromptShadow(buffer, promptBackground)

      const modal =
        context.keymap.mode.current() === "modal"
          ? modalPanel(context.renderer.root, buffer.width, buffer.height)
          : undefined

      if (modal) {
        syncModalImageOpacity(context.renderer.root, modal.renderable, hiddenImages)
        clearOutsideRect(buffer, modal.rect, terminalSurface, true)
        clearModalDecorations(buffer, modal.rect)
        return
      }

      syncModalImageOpacity(context.renderer.root, undefined, hiddenImages)
      clearThemeBackgrounds(
        buffer,
        [
          theme.background.base,
          theme.background.raised.base,
          theme.decrease(theme.background.base),
          promptBackground,
        ],
        terminalSurface,
      )
    }

    context.renderer.setBackgroundColor(transparent)
    context.renderer.addPostProcessFn(postProcess)
    syncTerminalSurface()

    return () => {
      disposed = true
      disposeModal()
      syncModalImageOpacity(context.renderer.root, undefined, hiddenImages)
      context.renderer.removePostProcessFn(postProcess)
      context.renderer.setBackgroundColor(context.theme.background.base)
    }
  },
}
