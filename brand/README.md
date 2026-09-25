# NodeByte 品牌图标 —— 「字节光轨 The Signal Trail」

## 设计概念

一条青→紫极光色的光轨在深空色超椭圆底上一笔画出字母 **N**（NodeByte 首字母）：

- **三个转折点**各是一颗发光的**节点（Node）**——浏览器是网络节点的载体；
- **收笔处**一颗**字节光点（Byte）**正拖着尾迹飞离轨道——数据在节点间流动；
- **右上一段淡轨道弧**上还有一颗小节点，呼应互联网络。

与 Edge（流动的 e）、Chrome（三色环）完全不同源，原创图形，品牌故事可完整讲述。

## 色彩体系

| 用途 | 颜色 |
|------|------|
| 背景（深空渐变） | `#101736 → #060A1C` |
| 光轨渐变（极光） | `#22D3EE → #4F7DFF → #A855F7` |
| 内芯高光 | `#F2FAFF` |
| 节点亮核 | `#FFFFFF` |

## 尺寸分级（可辨识度优先）

| 尺寸 | 细节等级 | 说明 |
|------|----------|------|
| 512 / 256 / 192 / 144 / 128 / 96 | full | 全要素：轨道弧、三层辉光、节点球、飞出光点 |
| 72 / 64 / 48 | mid | 去轨道弧，保留光点与双层辉光 |
| 32 | low | 粗光轨 + 节点亮斑，无飞点 |
| 16 | tiny | 纯 N 光轨，粗笔画保证小尺寸辨识 |

## 文件清单

- `icon-master.svg` — 矢量母版（512 viewBox，可无限缩放）
- `logo-horizontal.svg` — 横版字标（Web 顶栏 / 文档）
- `icon-{16..512}.png` — 全尺寸位图
- `favicon.ico` — 16+32+48 合成
- `../client/branding/android/` — Android 启动器图标（48~192，对应 mipmap 五密度）
- `../client/installer/branding/nodebyte.ico` — Windows 安装器图标

## 再生成

```bash
python3 scripts/gen_nodebyte_icon.py   # 依赖 playwright(chromium) + Pillow
```
