import mermaid from "mermaid";
import type { MermaidConfig } from "mermaid";
import type { ImageData } from "./transformer";

let _inited = false;
let _mermaidId = 0;

type MermaidToPngOptions = Readonly<{
  /**
   * 导出 PNG 的倍率（提高倍率可以更清晰，但也会更大、更耗内存）。
   */
  rasterScale?: number;
  /**
   * PNG 背景色（默认白色）。
   */
  backgroundColor?: string;
  /**
   * 内容留白，避免 stroke/阴影被裁切（px）。
   */
  padding?: number;
  /**
   * 限制导出 PNG 的最长边（px），避免 Canvas 过大导致崩溃。
   */
  maxRasterLongSidePx?: number;
}>;

function ensureInitialized(config?: MermaidConfig) {
  if (_inited) return;
  mermaid.initialize(
    config ?? {
      startOnLoad: false,
      theme: "default",
    }
  );
  _inited = true;
}

function nextId() {
  return `md-to-doc-mermaid-${_mermaidId++}`;
}

function ensureSvgNamespaces(svg: SVGSVGElement) {
  if (!svg.getAttribute("xmlns")) {
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!svg.getAttribute("xmlns:xlink")) {
    svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }
}

type Rect = { x: number; y: number; width: number; height: number };

function parseViewBox(svg: SVGSVGElement): Rect | null {
  const vb = svg.getAttribute("viewBox");
  if (!vb) return null;
  const parts = vb
    .trim()
    .split(/[\s,]+/)
    .map((n) => Number(n));
  if (parts.length !== 4) return null;
  const [x, y, width, height] = parts;
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function parseSvgString(svgString: string): SVGSVGElement {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (!svgEl) {
    throw new Error("mermaid.render 未返回有效的 <svg> 内容");
  }
  // importNode 能确保 SVG 元素归属到当前 document，便于后续 getBBox / 序列化
  return document.importNode(svgEl, true) as SVGSVGElement;
}

function measureSvgContentBox(svg: SVGSVGElement): Rect {
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = "-10000px";
  wrapper.style.top = "-10000px";
  wrapper.style.width = "10000px";
  wrapper.style.height = "10000px";
  wrapper.style.overflow = "hidden";
  wrapper.style.opacity = "0";
  wrapper.style.pointerEvents = "none";

  document.body.appendChild(wrapper);
  wrapper.appendChild(svg);
  try {
    // 优先取 svg-pan-zoom 的 viewport（如果存在）；否则取 svg 根节点，让 bbox 尽量覆盖所有内容。
    const target =
      (svg.querySelector("g.svg-pan-zoom_viewport") as SVGGElement | null) ?? svg;
    const bbox = target.getBBox();
    const rect = { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
    if (
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      const vb = parseViewBox(svg);
      if (vb) return vb;
      throw new Error("无法计算 SVG 内容尺寸（bbox/viewBox 都不可用）");
    }
    return rect;
  } finally {
    wrapper.remove();
  }
}

function calcExportSize(
  contentWidth: number,
  contentHeight: number,
  opts: Required<Pick<MermaidToPngOptions, "rasterScale" | "maxRasterLongSidePx">>
) {
  // docx 中的最终展示尺寸由 transformer 再做一次“按页宽/缩进”缩放；
  // 这里仅决定导出 PNG 的像素尺寸，保证清晰度且避免 Canvas 过大。
  let rasterWidth = Math.max(1, Math.round(contentWidth * opts.rasterScale));
  let rasterHeight = Math.max(1, Math.round(contentHeight * opts.rasterScale));

  const longSide = Math.max(rasterWidth, rasterHeight);
  if (longSide > opts.maxRasterLongSidePx) {
    const s = opts.maxRasterLongSidePx / longSide;
    rasterWidth = Math.max(1, Math.round(rasterWidth * s));
    rasterHeight = Math.max(1, Math.round(rasterHeight * s));
  }

  return { rasterWidth, rasterHeight };
}

async function svgToPngArrayBuffer(
  svg: SVGSVGElement,
  rasterWidth: number,
  rasterHeight: number,
  backgroundColor: string
) {
  const svgData = new XMLSerializer().serializeToString(svg);
  const img = new Image();

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("SVG 转 PNG 失败：Image 加载失败"));
    img.src =
      "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  });

  const canvas = document.createElement("canvas");
  canvas.width = rasterWidth;
  canvas.height = rasterHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("SVG 转 PNG 失败：无法获取 Canvas 2D 上下文");

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, rasterWidth, rasterHeight);
  ctx.drawImage(img, 0, 0, rasterWidth, rasterHeight);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("SVG 转 PNG 失败：toBlob 返回空"))),
      "image/png"
    );
  });
  return blob.arrayBuffer();
}

/**
 * 把 mermaid 代码渲染为 PNG（二进制），并返回用于 docx ImageRun 的尺寸信息。
 *
 * 注意：该方法依赖 DOM/Canvas，只能在浏览器环境运行。
 */
export async function renderMermaidToPng(
  code: string,
  options: MermaidToPngOptions = {}
): Promise<ImageData> {
  if (typeof document === "undefined") {
    throw new Error("renderMermaidToPng 需要在浏览器环境（document）中运行");
  }

  const opts = {
    rasterScale: options.rasterScale ?? 2,
    backgroundColor: options.backgroundColor ?? "#ffffff",
    // mermaid 的 marker/filter/stroke 往往会超出 bbox，padding 稍大一点更不容易被裁切
    padding: options.padding ?? 32,
    maxRasterLongSidePx: options.maxRasterLongSidePx ?? 2400,
  } as const;

  // bbox 计算/最终光栅化依赖字体度量，尽量等待字体加载完成，避免导出时文字被裁切或排版变化
  try {
    await (document as any).fonts?.ready;
  } catch {
    // ignore
  }

  ensureInitialized();
  const { svg } = await mermaid.render(nextId(), code);

  const svgRoot = parseSvgString(svg);
  ensureSvgNamespaces(svgRoot);

  // 避免响应式尺寸导致 bbox/viewport 不稳定
  svgRoot.removeAttribute("width");
  svgRoot.removeAttribute("height");
  svgRoot.style.width = "";
  svgRoot.style.height = "";
  svgRoot.style.maxWidth = "";

  // 优先信任 mermaid 生成的 viewBox（更接近“完整内容”），没有的话再用 bbox 兜底
  const baseBox = parseViewBox(svgRoot) ?? measureSvgContentBox(svgRoot);
  const x = baseBox.x - opts.padding;
  const y = baseBox.y - opts.padding;
  const width = baseBox.width + opts.padding * 2;
  const height = baseBox.height + opts.padding * 2;

  svgRoot.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  svgRoot.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const { rasterWidth, rasterHeight } = calcExportSize(width, height, opts);

  // 这里设置的是 PNG 的像素尺寸；docx 里最终显示尺寸会在 transformer 里按页宽/缩进再缩放
  svgRoot.setAttribute("width", String(rasterWidth));
  svgRoot.setAttribute("height", String(rasterHeight));

  const pngArrayBuffer = await svgToPngArrayBuffer(
    svgRoot,
    rasterWidth,
    rasterHeight,
    opts.backgroundColor
  );

  return {
    image: pngArrayBuffer,
    // 先按“内容本身”返回，最终在 transformer 里按页宽/缩进再缩放，避免在 Word 里出现超页被裁切
    width,
    height,
  };
}
